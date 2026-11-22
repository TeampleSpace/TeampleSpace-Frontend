import {
  elementSaveRequestSchema,
  elementSchema,
} from '../entities/presentation/schema.ts'
import type { EditorSnapshot, Element } from '../entities/presentation/schema.ts'
import errorCodes from '../../contracts/error-codes.json'
import { REQUEST_ID_HEADER } from '../shared/api/contract.ts'
import type { EventEnvelope } from '../shared/api/contract.ts'

// 공통 계약의 저장, 멱등, 이력 묶음, 이벤트 규칙을 메모리에서 흉내 내는 가짜 서버다
// 개발 화면과 테스트에서만 쓰며 실제 서버 연동을 대신하지 않는다
// 응답과 이벤트가 계약 스키마를 통과하는지는 contracts.test.ts에서 확인한다
// ponytail: 메모리 모킹. 네트워크 수준 검증이 필요해지면 MSW나 실제 서버로 바꾼다

// 이력 묶음을 닫는 서버 기준 시간
const GROUP_IDLE_MS = 2000
const GROUP_MAX_MS = 30000

type StoredResult = {
  body: string
  pending: boolean
  status?: number
  response?: unknown
}

type Group = {
  changeId: string
  actorId: string
  elementId: string
  openedAt: number
  lastWriteAt: number
  closed: boolean
}

type Stream = { send: (event: EventEnvelope) => void; close: () => void }

export type MockServer = ReturnType<typeof createMockServer>

// 처음 상태는 편집 화면 스냅샷 예제로 준다
export function createMockServer(
  initial: EditorSnapshot,
  options: { now?: () => number; assetUrls?: Record<string, string> } = {},
) {
  const now = options.now ?? Date.now
  const base = structuredClone(initial)
  if (!base.presentation) throw new Error('mock: 문서가 있는 스냅샷이 필요합니다')
  const doc = base.presentation
  const results = new Map<string, StoredResult>()
  const groups = new Map<string, Group>()
  const events: EventEnvelope[] = []
  const streams = new Set<Stream>()
  // 이 순번보다 앞선 이벤트는 보관 범위 밖으로 본다
  let retainedFrom = 1
  let requestSeq = 0
  let offline = false

  // 실패 상황을 일부러 만드는 스위치
  const faults = {
    // 요청 처리 지연
    delayMs: 0,
    // 반영은 하고 응답만 잃는다
    dropNextResponse: false,
    // 다음 저장 요청을 이 오류 코드로 거절한다. 반영하지 않는다
    failNextCode: '',
    // 이벤트를 두 번씩 보낸다
    duplicateEvents: false,
  }

  const nextRequestId = () => `req_mock_${(requestSeq += 1)}`

  // 모든 응답에 요청 식별자 헤더를 싣는다. 오류 본문의 requestId와 같은 값이다
  function json(status: number, body: unknown, headers: Record<string, string> = {}) {
    const inBody = (body as { requestId?: unknown } | null)?.requestId
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json',
        [REQUEST_ID_HEADER]: typeof inBody === 'string' ? inBody : nextRequestId(),
        ...headers,
      },
    })
  }

  // 오류의 상태와 재시도 여부는 계약의 오류 코드 목록에서 읽는다
  function contractOf(code: string) {
    const entry = errorCodes.codes.find((candidate) => candidate.code === code)
    if (!entry || entry.httpStatus === null) {
      throw new Error(`mock: 계약에 없는 오류 코드 ${code}`)
    }
    return { status: entry.httpStatus, retryable: entry.retryable }
  }
  const statusOf = (code: string) => contractOf(code).status

  function errorBody(code: string, message: string, extra: object = {}) {
    return {
      error: { code, message, retryable: contractOf(code).retryable, ...extra },
      requestId: nextRequestId(),
    }
  }

  // 읽기 응답에는 이미지의 임시 주소를 붙인다
  function withAsset(element: Element): Element {
    if (element.type !== 'image') return element
    const assetUrl = options.assetUrls?.[element.content.fileObjectId]
    return assetUrl
      ? { ...element, content: { ...element.content, assetUrl } }
      : element
  }

  function emit(
    type: string,
    actorId: string,
    fields: Partial<EventEnvelope>,
    payload: Record<string, unknown>,
  ): EventEnvelope {
    const event: EventEnvelope = {
      eventId: String(events.length + 1),
      projectId: doc.projectId,
      type,
      actorId,
      occurredAt: new Date(now()).toISOString(),
      presentationVersion: doc.version,
      generation: doc.generation,
      ...fields,
      // 이후 변경이 지난 이벤트 내용을 바꾸지 않게 복사한다
      payload: structuredClone(payload),
    }
    events.push(event)
    for (const stream of streams) {
      stream.send(event)
      if (faults.duplicateEvents) stream.send(event)
    }
    return event
  }

  function closeGroup(group: Group): EventEnvelope {
    group.closed = true
    return emit(
      'change.finalized',
      group.actorId,
      { resourceId: group.changeId },
      { changeId: group.changeId, groupState: 'closed' },
    )
  }

  // 서버 수신 시각 기준으로 2초 무입력 또는 30초가 지난 묶음을 닫는다
  function closeExpiredGroups() {
    for (const group of groups.values()) {
      if (group.closed) continue
      const idle = now() - group.lastWriteAt >= GROUP_IDLE_MS
      const tooLong = now() - group.openedAt >= GROUP_MAX_MS
      if (idle || tooLong) closeGroup(group)
    }
  }

  async function saveElement(
    actorId: string,
    path: string,
    slideId: string,
    elementId: string,
    init: RequestInit,
  ): Promise<Response> {
    const key = new Headers(init.headers).get('Idempotency-Key')
    if (!key) {
      return json(statusOf('IDEMPOTENCY_KEY_REQUIRED'), errorBody('IDEMPOTENCY_KEY_REQUIRED', '멱등 키가 필요해요.'))
    }
    if (faults.failNextCode) {
      const code = faults.failNextCode
      faults.failNextCode = ''
      return json(statusOf(code), errorBody(code, '요청을 처리하지 못했어요.'))
    }
    const body = String(init.body)
    const resultKey = `${actorId} PATCH ${path} ${key}`

    // 멱등 결과를 버전 검사보다 먼저 확인한다
    const stored = results.get(resultKey)
    if (stored) {
      if (stored.body !== body) {
        return json(statusOf('IDEMPOTENCY_KEY_REUSED'), errorBody('IDEMPOTENCY_KEY_REUSED', '같은 키로 다른 요청을 보냈어요.'))
      }
      if (stored.pending) {
        return json(
          statusOf('REQUEST_IN_PROGRESS'),
          errorBody('REQUEST_IN_PROGRESS', '같은 요청을 처리하고 있어요.'),
          { 'Retry-After': '1' },
        )
      }
      return json(stored.status!, stored.response)
    }

    const entry: StoredResult = { body, pending: true }
    results.set(resultKey, entry)
    if (faults.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, faults.delayMs))
    }

    const request = elementSaveRequestSchema.safeParse(JSON.parse(body))
    const slide = doc.slides.find((candidate) => candidate.id === slideId)
    const index = slide?.elements.findIndex((candidate) => candidate.id === elementId) ?? -1
    closeExpiredGroups()

    let status = 200
    let response: unknown
    if (!slide || index < 0) {
      status = statusOf('NOT_FOUND')
      response = errorBody('NOT_FOUND', '대상을 찾을 수 없어요.')
    } else if (!request.success) {
      status = statusOf('VALIDATION_FAILED')
      response = errorBody('VALIDATION_FAILED', '입력을 확인해 주세요.', { fieldErrors: [] })
    } else {
      const element = slide.elements[index]
      const { patch, editGroupId, clientMutationId } = request.data
      // 보낸 항목은 통째로 교체한다
      const next = patch
        ? elementSchema.safeParse({ ...element, ...patch, version: element.version + 1 })
        : undefined
      let group = groups.get(editGroupId)

      if (
        request.data.generation !== doc.generation ||
        // 내용 없이 묶음만 닫는 요청은 요소 버전을 검사하지 않는다
        (patch && request.data.baseVersion !== element.version)
      ) {
        status = statusOf('VERSION_CONFLICT')
        response = errorBody('VERSION_CONFLICT', '이후 수정이 있어요.', {
          fieldErrors: [],
          currentVersions: {
            generation: doc.generation,
            elementVersion: element.version,
            slideVersion: slide.version,
            presentationVersion: doc.version,
          },
        })
      } else if (group && (group.actorId !== actorId || group.elementId !== elementId)) {
        // 묶음 식별자를 다른 작성자나 다른 요소가 쓰면 거절한다
        status = statusOf('VALIDATION_FAILED')
        response = errorBody('VALIDATION_FAILED', '입력을 확인해 주세요.', { fieldErrors: [] })
      } else if (group?.closed || (!group && !patch)) {
        status = statusOf('EDIT_GROUP_CLOSED')
        response = errorBody('EDIT_GROUP_CLOSED', '이미 닫힌 편집 묶음이에요.', {
          currentVersions: { generation: doc.generation, elementVersion: element.version },
        })
      } else if (next && !next.success) {
        status = statusOf('VALIDATION_FAILED')
        response = errorBody('VALIDATION_FAILED', '입력을 확인해 주세요.', { fieldErrors: [] })
      } else {
        // 다른 작성자가 같은 요소를 고치거나 같은 작성자가 다른 요소를 저장하면
        // 열려 있던 묶음을 닫는다. 편집 세션 구분은 인증 단계에서 정해져 지금은 작성자로 본다
        for (const other of groups.values()) {
          if (other.closed || other === group) continue
          const sameElement = other.elementId === elementId
          const sameActor = other.actorId === actorId
          if (sameElement !== sameActor) closeGroup(other)
        }

        let saved = element
        if (next?.success) {
          saved = next.data
          // 임시 주소는 저장하지 않는다
          if (saved.type === 'image') delete saved.content.assetUrl
          slide.elements[index] = saved
          slide.version += 1
          doc.version += 1
        }

        const isFirstSave = !group
        group ??= {
          changeId: crypto.randomUUID(),
          actorId,
          elementId,
          openedAt: now(),
          lastWriteAt: now(),
          closed: false,
        }
        groups.set(editGroupId, group)
        group.lastWriteAt = now()

        const change = {
          resource: withAsset(saved),
          elementVersion: saved.version,
          slideVersion: slide.version,
          presentationVersion: doc.version,
          generation: doc.generation,
          changeId: group.changeId,
        }
        let eventId = ''
        if (patch) {
          eventId = emit(
            'element.updated',
            actorId,
            { clientMutationId, resourceId: elementId, resourceVersion: saved.version },
            change,
          ).eventId
        }
        // 검토 이력은 묶음의 첫 저장에서 한 번만 만든다
        if (isFirstSave) {
          emit(
            'change.created',
            actorId,
            { resourceId: group.changeId },
            { changeId: group.changeId, groupState: 'open' },
          )
        }
        if (request.data.finalizeGroup) {
          const finalized = closeGroup(group)
          eventId ||= finalized.eventId
        }
        response = { clientMutationId, ...change, eventId }
      }
    }

    // 결과는 오류 응답을 포함해 같은 키의 재시도에 그대로 돌려준다
    entry.pending = false
    entry.status = status
    entry.response = structuredClone(response)

    if (faults.dropNextResponse) {
      faults.dropNextResponse = false
      throw new TypeError('mock: 응답 유실')
    }
    return json(status, response)
  }

  // 문서와 이벤트 커서를 같은 시점에서 읽는다
  function snapshot(): EditorSnapshot {
    const presentation = structuredClone(doc)
    for (const slide of presentation.slides) {
      slide.elements = slide.elements.map(withAsset)
    }
    return { ...base, presentation, eventCursor: String(events.length) }
  }

  // 이벤트 스트림의 id는 eventId, event는 type, data는 이벤트 봉투다
  function openStream(cursor: string | null, signal?: AbortSignal | null): Response {
    const encoder = new TextEncoder()
    let stream: Stream | undefined
    let keepAlive: ReturnType<typeof setInterval> | undefined
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const write = (type: string, id: string | undefined, data: unknown) => {
          const idLine = id ? `id: ${id}\n` : ''
          controller.enqueue(
            encoder.encode(`${idLine}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`),
          )
        }
        const after = cursor === null ? events.length : Number(cursor)
        const valid =
          Number.isInteger(after) && after >= retainedFrom - 1 && after <= events.length
        if (!valid) {
          // 보관 범위 밖이거나 잘못된 커서는 다시 동기화하게 한다
          write('snapshot_required', undefined, { projectId: doc.projectId })
          controller.close()
          return
        }
        for (const event of events.slice(after)) write(event.type, event.eventId, event)

        // 실제 서버처럼 이벤트가 없어도 15초마다 주석 줄을 보낸다
        keepAlive = setInterval(
          () => controller.enqueue(encoder.encode(': keep-alive\n\n')),
          15000,
        )
        const current: Stream = {
          send: (event) => write(event.type, event.eventId, event),
          close: () => {
            if (!streams.delete(current)) return
            clearInterval(keepAlive)
            controller.close()
          },
        }
        stream = current
        streams.add(current)
        signal?.addEventListener('abort', current.close, { once: true })
      },
      cancel() {
        clearInterval(keepAlive)
        if (stream) streams.delete(stream)
      },
    })
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
  }

  async function route(
    actorId: string,
    method: string,
    path: string,
    init: RequestInit,
  ): Promise<Response> {
    const project = `/v1/projects/${doc.projectId}`
    if (method === 'GET' && path === '/v1/auth/bootstrap') {
      const member = base.members.find((candidate) => candidate.userId === actorId)
      return json(200, {
        status: 'authenticated',
        csrfToken: `csrf_${actorId}`,
        expiresAt: new Date(now() + 3600_000).toISOString(),
        user: {
          id: actorId,
          displayName: member?.displayName ?? '시험 사용자',
          onboardingStatus: 'completed',
          version: 1,
        },
      })
    }
    if (method === 'GET' && path === `${project}/sync-snapshot`) {
      return json(200, snapshot())
    }
    if (method === 'GET' && path === `${project}/events`) {
      return openStream(new Headers(init.headers).get('Last-Event-ID'), init.signal)
    }
    const save =
      method === 'PATCH' && path.match(/^\/v1\/slides\/([^/]+)\/elements\/([^/]+)$/)
    if (save) return saveElement(actorId, path, save[1], save[2], init)
    return json(statusOf('NOT_FOUND'), errorBody('NOT_FOUND', '대상을 찾을 수 없어요.'))
  }

  // 사용자 한 명의 브라우저 세션이 쓰는 fetch를 만든다
  function fetchAs(actorId: string): typeof fetch {
    return (input, init = {}) => {
      if (offline) return Promise.reject(new TypeError('mock: 연결 끊김'))
      const url = new URL(String(input), 'http://mock.local')
      const work = route(actorId, init.method ?? 'GET', url.pathname, init)
      const signal = init.signal
      if (!signal) return work
      // 클라이언트가 기다리기를 그만둬도 서버 처리는 계속된다
      return new Promise<Response>((resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason)
          return
        }
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        work.then(resolve, reject)
      })
    }
  }

  return {
    fetchAs,
    faults,
    setFaults(next: Partial<typeof faults>) {
      Object.assign(faults, next)
    },
    events,
    getDocument: () => doc,
    // 이 순번보다 앞선 이벤트를 보관 범위 밖으로 만든다
    dropEventsBefore(seq: number) {
      retainedFrom = seq
    },
    // 열려 있는 이벤트 연결을 모두 끊는다
    closeStreams() {
      for (const stream of [...streams]) stream.close()
    },
    // 서버에 닿지 않는 상태를 만든다. 요청은 실패하고 이벤트 연결도 끊긴다
    setOffline(value: boolean) {
      offline = value
      if (value) for (const stream of [...streams]) stream.close()
    },
  }
}
