import {
  editorSnapshotSchema,
  elementChangeSchema,
  elementDeletedSchema,
  elementSaveResultSchema,
  presenceUpdatedSchema,
} from '../../entities/presentation/schema.ts'
import type {
  Element,
  ElementChange,
  ElementPatch,
  ElementSaveRequest,
  ElementSaveResult,
  Presentation,
  PresenceCursor,
} from '../../entities/presentation/schema.ts'
import { ApiError, TransportError } from '../../shared/api/client.ts'
import type { ApiClient } from '../../shared/api/client.ts'
import { eventEnvelopeSchema } from '../../shared/api/contract.ts'
import { emptySchema } from '../../entities/session/model.ts'
import { StreamRejectedError, openEventStream } from './sse.ts'
import type { SseMessage } from './sse.ts'

// 편집 세션. 서버 확인본과 아직 보내지 못한 로컬 입력을 따로 들고
// 저장 큐, 이력 묶음, 실시간 이벤트 반영을 한곳에서 처리한다
// 미전송 입력은 현재 탭 메모리에만 둔다

export type SaveStatus = 'clean' | 'dirty' | 'saving' | 'saved' | 'failed' | 'conflict'

export type ElementView = {
  status: SaveStatus
  // 충돌했을 때 내 입력과 함께 보여 줄 서버 최신 내용
  serverLatest?: Element
}

export type SessionState = {
  connection: 'connecting' | 'online' | 'offline'
  // 로그인이 끝났거나 프로젝트에 접근할 수 없어 세션을 멈춘 이유. 다시 연결하지 않는다
  rejected?: ApiError | StreamRejectedError
  // 스냅샷을 한 번이라도 읽었는지. 읽었는데 view가 없으면 아직 문서를 만들기 전이다
  loaded: boolean
  // 서버 확인본 위에 미전송 입력을 얹은 화면용 문서
  view?: Presentation
  // 아직 서버가 확인하지 않은 입력이나 요청이 있는지
  pending: boolean
  memberCount: number
  // 팀원 이름. 다른 팀원의 커서 이름표에 쓴다
  memberNames: Record<string, string>
  // 나를 뺀 팀원의 커서. 연결이 끊기면 비운다
  cursors: PresenceCursor[]
  elements: Record<string, ElementView>
  stats: { duplicateEvents: number; staleEvents: number; snapshots: number }
}

type Timer = ReturnType<typeof setTimeout>

// 보낸 요청 한 건. 응답이 불확실하면 이 값을 그대로 다시 보낸다
type Flight = { key: string; body: ElementSaveRequest; seq: number; attempt: number }

// 검토 이력 한 건으로 묶이는 연속 편집
// lastAckAt은 이 묶음의 저장을 서버가 마지막으로 확인해 준 시각이다
type Group = { id: string; openedAt: number; saved: boolean; closing: boolean; lastAckAt?: number }

type Entry = {
  status: SaveStatus
  draft?: ElementPatch
  // 입력이 생길 때마다 올라가는 순번. 응답이 어느 입력까지 담았는지 가린다
  seq: number
  composing: boolean
  flight?: Flight
  group?: Group
  saveTimer?: Timer
  retryTimer?: Timer
  serverLatest?: Element
  // 내 요청 결과가 정해질 때까지 미뤄 둔 서버 변경
  deferred?: Element
}

// 실행 취소 한 단계. 수정은 바꾸기 전과 뒤의 항목 값을, 추가와 삭제는 요소 전체를 든다
type Op =
  | { kind: 'edit'; id: string; before: ElementPatch; after: ElementPatch }
  | { kind: 'create' | 'delete'; element: Element; retry?: AddAttempt }

// 요소 추가 요청 한 건의 식별자들. 결과가 불확실하면 같은 값으로 다시 보낸다
type AddAttempt = { id: string; key: string; mutationId: string }
const newAttempt = (): AddAttempt => ({ id: crypto.randomUUID(), key: crypto.randomUUID(), mutationId: crypto.randomUUID() })

const historyLimit = 100

// 계약에 따라 보낸 항목은 통째로 교체된다
export function applyPatch(element: Element, patch: ElementPatch): Element {
  return { ...element, ...patch } as Element
}

export type EditorSession = ReturnType<typeof createEditorSession>

export function createEditorSession(options: {
  client: ApiClient
  // 이벤트 스트림 연결에 쓰는 fetch
  fetchImpl: typeof fetch
  projectId: string
  // 텍스트 저장 대기 시간. 설계 제안값 600ms
  saveDelayMs?: number
  // 이력 묶음을 닫는 무입력 시간과 최대 시간
  groupIdleMs?: number
  groupMaxMs?: number
  retryDelaysMs?: number[]
  requestTimeoutMs?: number
  onLog?: (message: string) => void
}) {
  const { client, fetchImpl, projectId } = options
  const saveDelayMs = options.saveDelayMs ?? 600
  const groupIdleMs = options.groupIdleMs ?? 2000
  const groupMaxMs = options.groupMaxMs ?? 30000
  const retryDelaysMs = options.retryDelaysMs ?? [1000, 2000, 4000]
  // 이보다 오래 이어진 구독이 정상 종료되면 서버의 정기 종료로 본다
  const stableStreamMs = 5000
  const requestTimeoutMs = options.requestTimeoutMs ?? 10000
  const log = options.onLog ?? (() => {})

  let doc: Presentation | undefined
  const entries = new Map<string, Entry>()
  let connection: SessionState['connection'] = 'connecting'
  let lastEventId: string | undefined
  // 이벤트 스트림으로 확인한 문서 버전. 건너뛰면 놓친 이벤트가 있다고 본다
  let streamVersion = 0
  const seenEvents = new Set<string>()
  const stats = { duplicateEvents: 0, staleEvents: 0, snapshots: 0 }
  let stream: AbortController | undefined
  let reconnectTimer: Timer | undefined
  let reconnectAttempt = 0
  let running = false
  let snapshotting: Promise<void> | undefined
  let rejected: SessionState['rejected']
  let loaded = false
  let memberCount = 0
  let memberNames: Record<string, string> = {}
  let cursors: PresenceCursor[] = []
  // 스냅샷을 다시 읽으라는 신호를 받아 기다리지 않고 바로 다시 연결한다
  let resyncNow = false
  let state: SessionState = {
    connection,
    loaded,
    pending: false,
    memberCount,
    memberNames,
    cursors,
    elements: {},
    stats: { ...stats },
  }
  const listeners = new Set<() => void>()
  // 내 편집의 실행 취소 기록. 현재 탭에만 둔다
  const undoStack: Op[] = []
  const redoStack: Op[] = []
  // 편집을 끝내기 전까지 바뀐 항목의 처음 값
  const before = new Map<string, Record<string, unknown>>()
  let replaying = false
  let stepping = false
  // 요소를 추가한 순번. 그보다 먼저 읽기 시작한 스냅샷에 없는 요소를 지운 것으로 보지 않는다
  let addSeq = 0
  const addedAt = new Map<string, number>()

  function publish() {
    const elements: Record<string, ElementView> = {}
    let view: Presentation | undefined
    if (doc) {
      // ponytail: 바뀔 때마다 문서 전체를 복사한다. 요소가 많아지면 요소별 구독으로 바꾼다
      view = structuredClone(doc)
      for (const slide of view.slides) {
        slide.elements = slide.elements.map((element) => {
          const entry = entries.get(element.id)
          elements[element.id] = {
            status: entry?.status ?? 'clean',
            serverLatest: entry?.serverLatest,
          }
          return entry?.draft ? applyPatch(element, entry.draft) : element
        })
      }
    }
    state = {
      connection,
      rejected,
      loaded,
      view,
      pending: hasPending(),
      memberCount,
      memberNames,
      cursors,
      elements,
      stats: { ...stats },
    }
    for (const listener of listeners) listener()
  }

  function entryOf(elementId: string): Entry {
    let entry = entries.get(elementId)
    if (!entry) {
      entry = { status: 'clean', seq: 0, composing: false }
      entries.set(elementId, entry)
    }
    return entry
  }

  function find(elementId: string) {
    for (const slide of doc?.slides ?? []) {
      const index = slide.elements.findIndex((element) => element.id === elementId)
      if (index >= 0) return { slide, index, element: slide.elements[index] }
    }
    return undefined
  }

  function locate(elementId: string) {
    const found = find(elementId)
    if (!found) throw new Error(`요소를 찾을 수 없습니다 ${elementId}`)
    return found
  }

  function newGroup(): Group {
    return { id: crypto.randomUUID(), openedAt: Date.now(), saved: false, closing: false }
  }

  function dropGroup(entry: Entry) {
    entry.group = undefined
  }

  // 서버는 2초 동안 저장이 없으면 묶음을 닫는다. 시간에 따른 종료는 서버가 판단하므로
  // 클라이언트는 닫는 요청을 보내지 않고, 닫혔을 묶음을 다시 쓰지 않도록 여기서 가려낸다
  function isExpired(group: Group) {
    return group.lastAckAt !== undefined && Date.now() - group.lastAckAt >= groupIdleMs
  }

  // 입력 반영

  function edit(
    elementId: string,
    patch: ElementPatch,
    input: { composing?: boolean } = {},
  ): boolean {
    // 연결이 끊긴 동안과 충돌을 해결하기 전에는 새 편집을 받지 않는다
    if (!doc || connection !== 'online') return false
    const entry = entryOf(elementId)
    if (entry.status === 'conflict') return false

    if (!replaying) {
      const current = viewOf(elementId) as Record<string, unknown>
      const saved = before.get(elementId) ?? {}
      for (const key of Object.keys(patch)) if (!(key in saved)) saved[key] = structuredClone(current[key])
      before.set(elementId, saved)
    }
    entry.draft = { ...entry.draft, ...patch }
    entry.seq += 1
    entry.composing = input.composing ?? false
    entry.status = entry.flight ? 'saving' : 'dirty'

    // 한글 조합 중에는 저장을 예약하지 않는다. 조합이 끝난 입력부터 대기 시간을 센다
    clearTimeout(entry.saveTimer)
    entry.saveTimer = entry.composing
      ? undefined
      : setTimeout(() => {
          entry.saveTimer = undefined
          send(elementId)
        }, saveDelayMs)

    publish()
    return true
  }

  // 포커스를 잃거나 선택이 다른 요소로 옮겨 가면 남은 입력을 바로 저장하고 묶음을 닫는다
  function endEdit(elementId: string) {
    record(elementId)
    const entry = entries.get(elementId)
    if (!entry) return
    entry.composing = false
    // 충돌 해결 뒤 다시 열어 둔 입력처럼 묶음 없이 남은 입력도 여기서 저장한다
    if (entry.draft && entry.status !== 'conflict') entry.group ??= newGroup()
    closeGroup(elementId)
    publish()
  }

  // 화면을 떠나기 전에 남은 입력을 바로 보낸다. 보내지 못하고 남는 입력이 있으면 true를 돌려준다
  // 이미 보낸 요청은 화면을 떠나도 서버에 반영되므로 남는 입력으로 세지 않는다
  function flush(): boolean {
    for (const [elementId, entry] of entries) if (entry.draft) endEdit(elementId)
    return [...entries.values()].some(
      (entry) =>
        entry.status === 'conflict' ||
        entry.status === 'failed' ||
        (connection !== 'online' && Boolean(entry.draft || entry.flight)) ||
        (entry.draft !== undefined && entry.flight?.seq !== entry.seq),
    )
  }

  // 화면에 보이는 요소. 서버 확인본 위에 아직 보내지 못한 입력을 얹는다
  function viewOf(elementId: string): Element {
    const element = locate(elementId).element
    const draft = entries.get(elementId)?.draft
    return draft ? applyPatch(element, draft) : element
  }

  // 실행 취소 기록

  function push(op: Op) {
    undoStack.push(op)
    if (undoStack.length > historyLimit) undoStack.shift()
    redoStack.length = 0
  }

  // 편집을 끝낼 때 처음 값과 지금 값을 한 단계로 남긴다
  function record(elementId: string) {
    const saved = before.get(elementId)
    if (!saved) return
    before.delete(elementId)
    if (!find(elementId)) return
    const current = viewOf(elementId) as Record<string, unknown>
    const after = Object.fromEntries(Object.keys(saved).map((key) => [key, structuredClone(current[key])]))
    if (JSON.stringify(after) === JSON.stringify(saved)) return
    push({ kind: 'edit', id: elementId, before: saved as ElementPatch, after: after as ElementPatch })
  }

  // 지운 요소를 되살리면 새 식별자를 받는다. 남은 기록이 새 요소를 가리키게 한다
  function remap(from: string, to: Element) {
    for (const op of [...undoStack, ...redoStack]) {
      if (op.kind === 'edit' && op.id === from) op.id = to.id
      if (op.kind !== 'edit' && op.element.id === from) op.element = { ...op.element, id: to.id }
    }
  }

  async function step(from: Op[], to: Op[], forward: boolean): Promise<boolean> {
    if (stepping || !doc || connection !== 'online') return false
    recordAll()
    const op = from.pop()
    if (!op) return false
    stepping = true
    try {
      if (op.kind === 'edit') {
        const target = find(op.id)
        if (!target || target.element.deletedAt) return false
        replaying = true
        const applied = edit(op.id, forward ? op.after : op.before)
        replaying = false
        if (!applied) {
          // 충돌이나 연결 끊김으로 지금 적용하지 못했다. 해결한 뒤 다시 되돌릴 수 있게 남긴다
          from.push(op)
          return false
        }
        endEdit(op.id)
      } else {
        try {
          if ((op.kind === 'create') !== forward) {
            // 추가를 되돌리거나 삭제를 다시 한다
            await remove(op.element.id)
          } else {
            op.retry ??= newAttempt()
            const created = await add(op.element.slideId, op.element, op.retry)
            op.retry = undefined
            remap(op.element.id, created)
            op.element = created
          }
        } catch (error) {
          // 요청이 실패하면 기록을 남겨 두고 다시 시도할 수 있게 한다
          // 서버가 거절한 추가는 새 요청으로, 결과를 모르는 추가는 같은 요청으로 다시 보낸다
          if (error instanceof ApiError && error.status < 500) op.retry = undefined
          from.push(op)
          throw error
        }
      }
      to.push(op)
      return true
    } finally {
      stepping = false
      publish()
    }
  }

  // 요소 추가와 삭제

  function insert(element: Element) {
    if (find(element.id)) return
    const slide = doc?.slides.find((candidate) => candidate.id === element.slideId)
    if (!slide) return
    slide.elements.push(element)
    slide.elementIds.push(element.id)
  }

  function markDeleted(elementId: string, version: number, deletedAt: string) {
    const found = find(elementId)
    if (!found || found.element.deletedAt) return
    found.slide.elements[found.index] = { ...found.element, version: Math.max(version, found.element.version), deletedAt }
    const entry = entries.get(elementId)
    clearTimeout(entry?.saveTimer)
    clearTimeout(entry?.retryTimer)
    entries.delete(elementId)
    before.delete(elementId)
  }

  function requireOnline() {
    if (!doc || connection !== 'online') throw new Error('연결이 복구된 뒤 다시 시도해 주세요')
    return doc
  }

  // 같은 내용으로 새 요소를 만든다. 이미지는 파일 연결 경로가 생길 때 연다
  async function add(slideId: string, source: Element, attempt = newAttempt()): Promise<Element> {
    const current = requireOnline()
    if (source.type === 'image') throw new Error('이미지는 아직 복사할 수 없어요')
    const { type, geometry, content, style } = source
    const request = () =>
      client.request(`/slides/${slideId}/elements`, elementSaveResultSchema, {
        method: 'POST',
        body: {
          generation: current.generation,
          clientMutationId: attempt.mutationId,
          element: { id: attempt.id, type, geometry, content, style },
        },
        idempotencyKey: attempt.key,
        timeoutMs: requestTimeoutMs,
      })
    // 응답을 잃으면 같은 키로 한 번 더 보내 중복 없이 결과를 받는다
    const result = await request().catch((error: unknown) => {
      if (error instanceof TransportError) return request()
      throw error
    })
    addedAt.set(result.resource.id, (addSeq += 1))
    insert(result.resource)
    bumpVersions(result.resource.id, result)
    publish()
    return result.resource
  }

  async function remove(elementId: string) {
    const current = requireOnline()
    const entry = entries.get(elementId)
    if (entry?.flight || entry?.status === 'conflict') throw new Error('저장이 끝난 뒤 다시 시도해 주세요')
    const { slide, element } = locate(elementId)
    if (element.type === 'image') throw new Error('이미지는 아직 삭제할 수 없어요')
    // 지우는 동안 남은 입력을 보내지 않는다. 실패하면 이어서 보낸다
    clearTimeout(entry?.saveTimer)
    if (entry) entry.saveTimer = undefined
    const key = crypto.randomUUID()
    const body = { generation: current.generation, baseVersion: element.version, clientMutationId: crypto.randomUUID() }
    const request = () =>
      client.request(`/slides/${slide.id}/elements/${elementId}`, elementDeletedSchema, {
        method: 'DELETE',
        body,
        idempotencyKey: key,
        timeoutMs: requestTimeoutMs,
      })
    try {
      // 응답을 잃으면 같은 키로 한 번 더 물어 결과를 확인한다
      const result = await request().catch((error: unknown) => {
        if (error instanceof TransportError) return request()
        throw error
      })
      bumpVersions(elementId, result)
      markDeleted(elementId, result.tombstone.version, result.tombstone.deletedAt)
    } catch (error) {
      // 삭제 이벤트로 이미 지워진 것을 확인했으면 성공으로 본다
      if (find(elementId)?.element.deletedAt) return
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') resync()
      if (entry?.draft) send(elementId)
      throw error
    } finally {
      publish()
    }
  }

  // 사용자가 직접 한 추가와 삭제. 실행 취소 기록에 남긴다
  // 아직 끝내지 않은 편집을 먼저 기록해 되돌리는 순서를 지킨다
  function recordAll() {
    for (const elementId of [...before.keys()]) record(elementId)
  }

  async function createElement(slideId: string, source: Element): Promise<Element> {
    recordAll()
    const created = await add(slideId, source)
    push({ kind: 'create', element: created })
    return created
  }

  // 같은 요소를 지우는 중이면 새로 보내지 않고 그 결과를 기다린다
  const deleting = new Map<string, Promise<void>>()

  function deleteElement(elementId: string): Promise<void> {
    const running = deleting.get(elementId)
    if (running) return running
    if (find(elementId)?.element.deletedAt) return Promise.resolve()
    recordAll()
    const shown = viewOf(elementId)
    const work = remove(elementId)
      .then(() => push({ kind: 'delete', element: shown }))
      .finally(() => deleting.delete(elementId))
    deleting.set(elementId, work)
    return work
  }

  // 편집 종료와 이동처럼 화면에서만 알 수 있는 종료를 서버에 알린다
  function closeGroup(elementId: string) {
    const entry = entries.get(elementId)
    const group = entry?.group
    if (!entry || !group) return

    if (entry.draft || (entry.flight && entry.flight.body.editGroupId === group.id)) {
      // 남은 입력을 저장하는 요청에 종료 표시를 함께 싣는다
      group.closing = true
      if (entry.draft && !entry.flight) {
        clearTimeout(entry.saveTimer)
        entry.saveTimer = undefined
        send(elementId)
      }
    } else if (group.saved && !isExpired(group)) {
      sendFinalizeOnly(elementId, group)
    } else {
      // 저장한 적이 없거나 서버가 이미 시간 기준으로 닫았을 묶음이다
      entry.group = undefined
    }
  }

  // 저장 큐

  function send(elementId: string) {
    const entry = entries.get(elementId)
    // 같은 요소는 한 번에 한 요청만 보낸다. 진행 중 새 입력은 다음 요청으로 남긴다
    if (!entry?.draft || entry.flight || !doc) return
    if (connection !== 'online' || entry.status === 'conflict') return

    const { element } = locate(elementId)
    if (entry.group && isExpired(entry.group)) {
      // 닫혔을 묶음 대신 새 묶음을 연다. 편집을 끝내는 중이었다면 새 묶음도 이 저장으로 닫는다
      const closing = entry.group.closing
      entry.group = { ...newGroup(), closing }
    }
    const group = (entry.group ??= newGroup())
    const finalize = group.closing || Date.now() - group.openedAt >= groupMaxMs

    entry.flight = {
      // 실제 편집마다 새 멱등 키와 새 식별자를 만든다
      key: crypto.randomUUID(),
      seq: entry.seq,
      attempt: 0,
      body: {
        generation: doc.generation,
        baseVersion: element.version,
        editGroupId: group.id,
        clientMutationId: crypto.randomUUID(),
        patch: entry.draft,
        ...(finalize ? { finalizeGroup: true } : {}),
      },
    }
    // 닫는 요청을 보낸 뒤의 입력은 새 묶음에 담는다
    if (finalize) dropGroup(entry)
    entry.status = 'saving'
    publish()
    void transmit(elementId, entry.flight)
  }

  // 내용 없이 묶음만 닫는다. 저장 요청과 다른 멱등 키와 식별자를 쓴다
  function sendFinalizeOnly(elementId: string, group: Group) {
    const entry = entryOf(elementId)
    if (!doc || entry.flight || connection !== 'online') return
    if (entry.group === group) dropGroup(entry)
    entry.flight = {
      key: crypto.randomUUID(),
      seq: entry.seq,
      attempt: 0,
      body: {
        generation: doc.generation,
        baseVersion: locate(elementId).element.version,
        editGroupId: group.id,
        clientMutationId: crypto.randomUUID(),
        finalizeGroup: true,
      },
    }
    void transmit(elementId, entry.flight)
  }

  async function transmit(elementId: string, flight: Flight) {
    const { slide } = locate(elementId)
    flight.attempt += 1
    log(
      `저장 요청 ${flight.attempt}회차 키 ${flight.key.slice(0, 8)} 기준 버전 ${flight.body.baseVersion}` +
        (flight.body.patch ? '' : ' 묶음 종료만'),
    )
    try {
      const result = await client.request(
        `/slides/${slide.id}/elements/${elementId}`,
        elementSaveResultSchema,
        {
          method: 'PATCH',
          body: flight.body,
          idempotencyKey: flight.key,
          timeoutMs: requestTimeoutMs,
        },
      )
      acknowledge(elementId, flight, result)
    } catch (error) {
      handleSaveError(elementId, flight, error)
    }
    publish()
  }

  // 서버 확인본은 더 높은 버전으로만 바꾼다
  function setConfirmed(element: Element) {
    const { slide, index, element: current } = locate(element.id)
    // 지운 요소는 되살리지 않는다. 늦게 온 저장 응답이 삭제를 덮지 않게 한다
    if (current.deletedAt) return
    if (element.version > current.version) slide.elements[index] = element
  }

  // 버전은 리소스별로 따로 올린다
  function bumpVersions(
    elementId: string,
    versions: { slideVersion?: number; presentationVersion?: number },
  ) {
    if (!doc) return
    const { slide } = locate(elementId)
    if (versions.slideVersion) slide.version = Math.max(slide.version, versions.slideVersion)
    if (versions.presentationVersion) {
      doc.version = Math.max(doc.version, versions.presentationVersion)
    }
  }

  // 응답과 이벤트 중 먼저 온 쪽에서 한 번만 확인 처리한다
  function acknowledge(elementId: string, flight: Flight, result: ElementSaveResult) {
    setConfirmed(result.resource)
    bumpVersions(elementId, result)
    const entry = entryOf(elementId)
    if (entry.flight !== flight) return
    clearTimeout(entry.retryTimer)
    entry.flight = undefined

    if (flight.body.patch) {
      if (entry.group?.id === flight.body.editGroupId) {
        entry.group.saved = true
        entry.group.lastAckAt = Date.now()
      }
      if (entry.seq === flight.seq) {
        // 이 요청에 담긴 입력까지만 확인됐다
        entry.draft = undefined
        entry.status = 'saved'
      } else {
        // 그사이 새 입력이 있으면 이전 응답으로 화면을 덮지 않고 계속 저장한다
        entry.status = 'dirty'
      }
      log(`저장 확인 요소 버전 ${result.resource.version}`)
    }
    settle(elementId)
  }

  // 요청 하나가 끝난 뒤 미뤄 둔 서버 변경과 남은 입력을 이어서 처리한다
  function settle(elementId: string) {
    const entry = entryOf(elementId)
    if (entry.deferred) {
      const deferred = entry.deferred
      entry.deferred = undefined
      reconcile(deferred)
    }
    if (entry.status === 'conflict') return
    if (entry.draft) {
      // 대기 시간이 이미 지났으면 바로 이어서 보낸다
      if (!entry.saveTimer && !entry.composing) send(elementId)
    } else if (entry.group?.closing && entry.group.saved) {
      sendFinalizeOnly(elementId, entry.group)
    }
  }

  function handleSaveError(elementId: string, flight: Flight, error: unknown) {
    const entry = entryOf(elementId)
    if (entry.flight !== flight) return

    if (error instanceof TransportError) {
      // 응답이 불확실하면 같은 키, 같은 식별자, 같은 본문으로 다시 보낸다
      const delay = retryDelaysMs[flight.attempt - 1]
      log(`응답 확인 실패 (${error.kind})`)
      if (delay === undefined) {
        entry.status = 'failed'
        return
      }
      retryLater(elementId, flight, delay)
      return
    }

    if (!(error instanceof ApiError)) throw error
    log(`서버 거절 ${error.code}`)

    if (error.code === 'REQUEST_IN_PROGRESS' || error.retryable) {
      // 서버가 알려 준 시간 전에는 다시 보내지 않고 새 키도 만들지 않는다
      retryLater(elementId, flight, (error.retryAfterSeconds ?? 1) * 1000)
      return
    }

    // 서버 쪽 실패는 반영 여부를 알 수 없다. 요청을 남겨 두고 다시 시도할 때 같은 키로 보낸다
    if (error.status >= 500) {
      entry.status = 'failed'
      return
    }
    entry.flight = undefined
    if (error.code === 'EDIT_GROUP_CLOSED') {
      // 반영되지 않은 요청이다. 닫힌 묶음을 버리고 새 묶음과 새 요청으로 보낸다
      if (entry.group?.id === flight.body.editGroupId) dropGroup(entry)
      settle(elementId)
      return
    }
    if (error.code === 'VERSION_CONFLICT') {
      // 자동으로 다시 보내 덮어쓰지 않는다. 서버 최신 내용과 내 입력을 함께 남긴다
      entry.status = 'conflict'
      dropGroup(entry)
      if (entry.deferred) {
        entry.serverLatest = entry.deferred
        entry.deferred = undefined
      } else {
        resync()
      }
      return
    }
    entry.status = 'failed'
  }

  function retryLater(elementId: string, flight: Flight, delayMs: number) {
    const entry = entryOf(elementId)
    clearTimeout(entry.retryTimer)
    entry.retryTimer = setTimeout(() => {
      // 연결이 끊겨 있으면 다시 연결된 뒤에 보낸다
      if (entry.flight === flight && connection === 'online') void transmit(elementId, flight)
    }, delayMs)
  }

  // 저장 실패 뒤 사용자가 누르는 다시 시도. 같은 요청을 그대로 보낸다
  function retry(elementId: string) {
    const entry = entries.get(elementId)
    if (!entry || entry.status !== 'failed') return
    if (entry.flight) {
      entry.flight.attempt = 0
      entry.status = 'saving'
      void transmit(elementId, entry.flight)
    } else {
      entry.status = 'dirty'
      send(elementId)
    }
    publish()
  }

  // 서버 변경 반영

  function reconcile(server: Element, clientMutationId?: string) {
    const entry = entryOf(server.id)
    if (server.version <= locate(server.id).element.version) return
    if (entry.flight && clientMutationId === entry.flight.body.clientMutationId) {
      // 내 저장이 응답보다 이벤트로 먼저 도착했다
      acknowledge(server.id, entry.flight, {
        clientMutationId,
        resource: server,
        eventId: '',
      })
      return
    }
    if (entry.flight) {
      entry.deferred = server
      return
    }
    if (entry.draft) {
      entry.serverLatest = server
      entry.status = 'conflict'
      clearTimeout(entry.saveTimer)
      entry.saveTimer = undefined
      dropGroup(entry)
      log('다른 사람의 수정과 내 입력이 겹쳤습니다')
      return
    }
    setConfirmed(server)
  }

  // 다른 경로로 저장한 변경 응답을 이벤트를 기다리지 않고 반영한다. 같은 이벤트가 나중에 와도 버전으로 걸러진다
  function accept(changes: ElementChange[]) {
    for (const change of changes) {
      if (!find(change.resource.id)) continue
      bumpVersions(change.resource.id, change)
      reconcile(change.resource)
    }
    publish()
  }

  function resolveConflict(elementId: string, keep: 'server' | 'mine') {
    const entry = entries.get(elementId)
    if (!entry || entry.status !== 'conflict' || !entry.serverLatest) return
    setConfirmed(entry.serverLatest)
    entry.serverLatest = undefined
    if (keep === 'server') {
      before.delete(elementId)
      entry.draft = undefined
      entry.status = 'clean'
    } else {
      // 최신 버전 위에 내 입력을 다시 열어 둔다. 바로 강제 저장하지 않는다
      entry.status = 'dirty'
    }
    publish()
  }

  function handleMessage(message: SseMessage) {
    // 커서 목록은 이벤트 순번 없이 오고 받을 때마다 통째로 바꾼다
    if (message.event === 'presence.updated') {
      let data: unknown
      try {
        data = JSON.parse(message.data)
      } catch {
        return
      }
      const parsed = presenceUpdatedSchema.safeParse(data)
      if (!parsed.success) return
      cursors = parsed.data.cursors
      publish()
      return
    }
    if (message.event === 'snapshot_required') {
      log('이벤트 보관 범위를 벗어나 다시 동기화합니다')
      lastEventId = undefined
      resyncNow = true
      stream?.abort()
      return
    }
    let json: unknown
    try {
      json = JSON.parse(message.data)
    } catch {
      return
    }
    const parsed = eventEnvelopeSchema.safeParse(json)
    if (!parsed.success) return
    const event = parsed.data

    // ponytail: 본 이벤트 식별자를 계속 쌓는다. 긴 세션이 문제가 되면 최근 것만 남긴다
    if (seenEvents.has(event.eventId)) {
      stats.duplicateEvents += 1
      publish()
      return
    }
    seenEvents.add(event.eventId)
    lastEventId = event.eventId

    if (event.presentationVersion !== undefined) {
      if (event.presentationVersion > streamVersion + 1) {
        // 문서 버전이 건너뛰었으면 놓친 변경이 있으므로 스냅샷을 다시 읽는다
        log('이벤트 사이에 빠진 버전이 있어 다시 동기화합니다')
        resync()
        return
      }
      streamVersion = Math.max(streamVersion, event.presentationVersion)
    }

    // 팀원이 바뀌거나 문서를 새로 만들면 스냅샷을 다시 읽는다
    if (event.type === 'membership.changed' || event.type === 'presentation.replaced') resync()

    if (event.type === 'element.updated') {
      const result = elementChangeSchema.safeParse(event.payload)
      if (result.success && !find(result.data.resource.id)) {
        // 다른 팀원이 추가한 요소다. 슬라이드를 알면 바로 더하고 모르면 스냅샷으로 다시 맞춘다
        const { resource } = result.data
        if (doc?.slides.some((slide) => slide.id === resource.slideId)) {
          addedAt.set(resource.id, (addSeq += 1))
          insert(resource)
          bumpVersions(resource.id, result.data)
        } else {
          resync()
        }
      } else if (result.success) {
        const { resource } = result.data
        // 같은 요소의 오래된 버전이나 이미 반영한 내용은 무시한다
        if (resource.version <= locate(resource.id).element.version) stats.staleEvents += 1
        bumpVersions(resource.id, result.data)
        reconcile(resource, event.clientMutationId)
      } else {
        // 계약과 다른 내용은 조용히 넘기지 않고 스냅샷으로 다시 맞춘다
        resync()
      }
    }
    if (event.type === 'element.deleted') {
      const result = elementDeletedSchema.safeParse(event.payload)
      if (result.success && find(result.data.tombstone.id)) {
        const { tombstone } = result.data
        bumpVersions(tombstone.id, result.data)
        markDeleted(tombstone.id, tombstone.version, tombstone.deletedAt)
      } else if (!result.success) {
        resync()
      }
    }
    publish()
  }

  // 스냅샷과 연결

  // 이벤트로 시작한 스냅샷이 실패하면 커서를 비우고 다시 연결해 스냅샷부터 읽는다
  function resync() {
    snapshot().catch(() => {
      log('스냅샷을 읽지 못해 다시 동기화합니다')
      lastEventId = undefined
      resyncNow = true
      stream?.abort()
    })
  }

  // 문서와 이벤트 커서를 같은 시점에서 읽고 내 입력과 비교한다
  function snapshot(): Promise<void> {
    const since = addSeq
    snapshotting ??= client
      .request(`/projects/${projectId}/sync-snapshot?scope=editor`, editorSnapshotSchema)
      .then((result) => {
        stats.snapshots += 1
        loaded = true
        memberCount = result.members.length
        memberNames = Object.fromEntries(result.members.map((member) => [member.userId, member.displayName]))
        lastEventId = result.eventCursor
        const incoming = result.presentation
        // 아직 발표 자료를 만들기 전이면 문서가 없다
        if (!incoming) {
          publish()
          return
        }
        if (!doc) {
          doc = incoming
        } else {
          doc.version = incoming.version
          doc.orderVersion = incoming.orderVersion
          for (const slide of incoming.slides) {
            const local = doc.slides.find((candidate) => candidate.id === slide.id)
            if (local) local.version = Math.max(local.version, slide.version)
            for (const element of slide.elements) {
              if (find(element.id)) reconcile(element)
              else insert(element)
            }
            // 스냅샷에는 지운 요소가 없다. 보내는 중인 입력이 없는 요소만 지운 것으로 본다
            // 스냅샷을 읽기 시작한 뒤 내가 추가한 요소도 아직 스냅샷에 없을 수 있다
            // 보내지 못한 입력이 남은 요소라도 서버에서 지워졌으면 입력과 함께 지운다
            for (const element of local?.elements ?? []) {
              const kept = slide.elements.some((candidate) => candidate.id === element.id)
              const added = (addedAt.get(element.id) ?? 0) > since
              if (!kept && !added) markDeleted(element.id, element.version, new Date().toISOString())
            }
          }
        }
        streamVersion = incoming.version
        lastEventId = result.eventCursor
        publish()
      })
      .finally(() => {
        snapshotting = undefined
      })
    return snapshotting
  }

  const hasPending = () =>
    [...entries.values()].some((entry) => entry.draft || entry.flight)

  async function connect() {
    if (!running) return
    const controller = new AbortController()
    stream = controller
    let openedAt = 0
    let ended = false
    try {
      // 처음 연결하거나 보내지 못한 입력이 있으면 스냅샷부터 읽어 비교한다
      if (lastEventId === undefined || hasPending()) await snapshot()
      await openEventStream({
        fetchImpl,
        url: `/v1/projects/${projectId}/events`,
        lastEventId,
        signal: controller.signal,
        onOpen: () => {
          openedAt = Date.now()
          connection = 'online'
          reconnectAttempt = 0
          log('연결됨')
          publish()
          resumePending()
        },
        onMessage: handleMessage,
      })
      ended = true
    } catch (error) {
      const denied =
        error instanceof StreamRejectedError ||
        (error instanceof ApiError && [401, 403, 404].includes(error.status))
      if (denied && running && stream === controller) {
        // 로그인이 끝났거나 접근할 수 없으면 자동으로 다시 연결하지 않는다
        rejected = error
        connection = 'offline'
        running = false
        log(error.message)
        publish()
        return
      }
    }
    if (!running || stream !== controller) return

    // 서버는 오래된 구독을 정상 종료한다. 충분히 이어졌던 연결이면 끊김으로 보지 않고 바로 다시 구독한다
    if (ended && openedAt > 0 && Date.now() - openedAt >= stableStreamMs) {
      void connect()
      return
    }

    // 연결이 끊기면 새 편집을 막고 입력은 그대로 둔다. 다른 팀원 커서는 더 믿을 수 없어 숨긴다
    connection = 'offline'
    cursors = []
    log('연결 끊김')
    publish()
    const delay = resyncNow ? 0 : Math.min(1000 * 2 ** reconnectAttempt, 10000)
    resyncNow = false
    reconnectAttempt += 1
    reconnectTimer = setTimeout(() => void connect(), delay)
  }

  // 기다리지 않고 지금 다시 연결한다
  function reconnect() {
    if (!running || connection === 'online') return
    clearTimeout(reconnectTimer)
    reconnectAttempt = 0
    stream?.abort()
    void connect()
  }

  // 다시 연결되면 확인되지 않은 요청은 같은 키로, 남은 입력은 새 요청으로 보낸다
  function resumePending() {
    for (const [elementId, entry] of entries) {
      if (entry.status === 'conflict') continue
      if (entry.flight) {
        clearTimeout(entry.retryTimer)
        void transmit(elementId, entry.flight)
      } else if (entry.draft && !entry.saveTimer && !entry.composing) {
        send(elementId)
      }
    }
  }

  function start() {
    if (running) return
    running = true
    globalThis.addEventListener?.('pagehide', leavePointer)
    connection = 'connecting'
    void connect()
  }

  // 내 커서 위치. 보내는 중이면 마지막 위치만 남겼다가 끝난 뒤 보낸다
  // ponytail: 위치를 일정 간격으로 보낸다. 더 매끄럽게 하려면 웹소켓으로 바꾼다
  const pointerIntervalMs = 100
  // 서버가 10초 동안 소식이 없으면 지우므로 그 전에 같은 위치를 다시 알린다
  const pointerKeepAliveMs = 5000
  let pointer: { slideId: string | null; x?: number; y?: number } | undefined
  let pointerSent: string | undefined
  let pointerBusy = false
  let pointerTimer: Timer | undefined
  let pointerKeepAlive: Timer | undefined

  function movePointer(slideId: string | null, x?: number, y?: number) {
    pointer = slideId ? { slideId, x: Math.round(x ?? 0), y: Math.round(y ?? 0) } : { slideId: null }
    if (!pointerTimer) pointerTimer = setTimeout(sendPointer, pointerBusy ? pointerIntervalMs : 0)
  }

  async function sendPointer(force = false) {
    pointerTimer = undefined
    if (!running || !pointer || pointerBusy || connection !== 'online') return
    const body = pointer
    const key = JSON.stringify(body)
    if (!force && key === pointerSent) return
    pointerBusy = true
    clearTimeout(pointerKeepAlive)
    try {
      await client.request(`/projects/${projectId}/presence`, emptySchema, { method: 'POST', body, timeoutMs: requestTimeoutMs })
      pointerSent = key
    } catch {
      // 커서는 다음 움직임에 다시 보낸다
      pointerSent = undefined
    } finally {
      pointerBusy = false
    }
    if (body.slideId) pointerKeepAlive = setTimeout(() => void sendPointer(true), pointerKeepAliveMs)
    if (pointer && JSON.stringify(pointer) !== pointerSent && !pointerTimer) {
      pointerTimer = setTimeout(sendPointer, pointerIntervalMs)
    }
  }

  // 화면을 떠나면 다른 팀원에게서 내 커서를 바로 지운다. 페이지를 닫아도 끝까지 보낸다
  function leavePointer() {
    if (running && pointerSent && pointer?.slideId) {
      void client
        .request(`/projects/${projectId}/presence`, emptySchema, { method: 'POST', body: { slideId: null }, keepalive: true })
        .catch(() => {})
    }
    pointerSent = undefined
  }

  function stop() {
    leavePointer()
    globalThis.removeEventListener?.('pagehide', leavePointer)
    clearTimeout(pointerTimer)
    clearTimeout(pointerKeepAlive)
    pointer = undefined
    pointerSent = undefined
    running = false
    stream?.abort()
    stream = undefined
    clearTimeout(reconnectTimer)
    for (const entry of entries.values()) {
      clearTimeout(entry.saveTimer)
      clearTimeout(entry.retryTimer)
    }
  }

  return {
    start,
    stop,
    edit,
    endEdit,
    flush,
    createElement,
    deleteElement,
    undo: () => step(undoStack, redoStack, false),
    redo: () => step(redoStack, undoStack, true),
    retry,
    resolveConflict,
    accept,
    reconnect,
    movePointer,
    // 문서가 새로 만들어졌을 때처럼 이벤트 없이 바뀐 내용을 다시 읽는다
    refresh: snapshot,
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
