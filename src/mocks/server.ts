import { elementSaveRequestSchema } from '../entities/presentation/schema.ts'
import type { Element, Presentation } from '../entities/presentation/schema.ts'
import type { EventEnvelope } from '../shared/api/contract.ts'

// 계약 문서의 저장, 멱등, 이력 묶음, 이벤트 규칙을 메모리에서 흉내 내는 가짜 서버다
// 개발 화면과 테스트에서만 쓰며 실제 서버 연동을 대신하지 않는다
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

export function createMockServer(
  initial: Presentation,
  options: { now?: () => number; assetUrls?: Record<string, string> } = {},
) {
  const now = options.now ?? Date.now
  const doc = structuredClone(initial)
  const results = new Map<string, StoredResult>()
  const groups = new Map<string, Group>()
  const events: EventEnvelope[] = []
  const streams = new Set<Stream>()
  // 이 순번보다 앞선 이벤트는 보관 범위 밖으로 본다
  let retainedFrom = 1
  let requestSeq = 0
  let changeSeq = 0

  // 실패 상황을 일부러 만드는 스위치
  const faults = {
    // 요청 처리 지연
    delayMs: 0,
    // 반영은 하고 응답만 잃는다
    dropNextResponse: false,
    // 이벤트를 두 번씩 보낸다
    duplicateEvents: false,
  }

  function json(status: number, body: unknown, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    })
  }

  function errorBody(code: string, message: string, extra: object = {}) {
    requestSeq += 1
    return {
      error: { code, message, retryable: false, fieldErrors: [], ...extra },
      requestId: `req_mock_${requestSeq}`,
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
    payload: unknown,
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

  function closeGroup(editGroupId: string, group: Group): EventEnvelope {
    group.closed = true
    return emit(
      'change.finalized',
      group.actorId,
      { resourceId: group.changeId },
      { changeId: group.changeId, editGroupId },
    )
  }

  // 서버 수신 시각 기준으로 2초 무입력 또는 30초가 지난 묶음을 닫는다
  function closeExpiredGroups() {
    for (const [editGroupId, group] of groups) {
      if (group.closed) continue
      const idle = now() - group.lastWriteAt >= GROUP_IDLE_MS
      const tooLong = now() - group.openedAt >= GROUP_MAX_MS
      if (idle || tooLong) closeGroup(editGroupId, group)
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
    if (!key) throw new Error('mock: Idempotency-Key가 없습니다')
    const body = String(init.body)
    const resultKey = `${actorId} PATCH ${path} ${key}`

    // 멱등 결과를 버전 검사보다 먼저 확인한다
    const stored = results.get(resultKey)
    if (stored) {
      if (stored.body !== body) {
        return json(409, errorBody('IDEMPOTENCY_KEY_REUSED', '같은 키로 다른 요청을 보냈어요.'))
      }
      if (stored.pending) {
        return json(
          409,
          errorBody('REQUEST_IN_PROGRESS', '처리 중인 요청이에요.', { retryable: true }),
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

    const request = elementSaveRequestSchema.parse(JSON.parse(body))
    const slide = doc.slides[slideId]
    const element = slide?.elements[elementId]
    if (!slide || !element) throw new Error('mock: 요소가 없습니다')
    closeExpiredGroups()

    let group = groups.get(request.editGroupId)
    if (!group && !request.patch) throw new Error('mock: 저장한 적 없는 묶음의 종료 요청')

    let status = 200
    let response: unknown
    if (
      request.generation !== doc.generation ||
      // 내용 없이 묶음만 닫는 요청은 요소 버전을 검사하지 않는다
      (request.patch && request.baseVersion !== element.version)
    ) {
      status = 409
      response = errorBody('VERSION_CONFLICT', '이후 수정이 있어요.', {
        currentVersions: { generation: doc.generation, elementVersion: element.version },
      })
    } else if (group?.closed) {
      status = 409
      response = errorBody('EDIT_GROUP_CLOSED', '이미 닫힌 편집 묶음이에요.')
    } else {
      // 다른 작성자가 같은 요소를 고치면 열려 있던 묶음을 닫는다
      for (const [otherId, other] of groups) {
        if (!other.closed && other.elementId === elementId && other.actorId !== actorId) {
          closeGroup(otherId, other)
        }
      }

      let eventId = ''
      if (request.patch) {
        if (request.patch.content && element.type === 'text') {
          element.content = { ...element.content, ...request.patch.content }
        }
        if (request.patch.geometry) {
          element.geometry = { ...element.geometry, ...request.patch.geometry }
        }
        element.version += 1
        slide.version += 1
        doc.version += 1
      }

      const isFirstSave = !group
      group ??= {
        changeId: `change_${(changeSeq += 1)}`,
        actorId,
        elementId,
        openedAt: now(),
        lastWriteAt: now(),
        closed: false,
      }
      groups.set(request.editGroupId, group)
      group.lastWriteAt = now()

      const result = {
        clientMutationId: request.clientMutationId,
        resource: withAsset(element),
        elementVersion: element.version,
        slideVersion: slide.version,
        presentationVersion: doc.version,
        generation: doc.generation,
        changeId: group.changeId,
      }
      if (request.patch) {
        eventId = emit(
          'element.updated',
          actorId,
          {
            clientMutationId: request.clientMutationId,
            resourceId: elementId,
            resourceVersion: element.version,
          },
          result,
        ).eventId
      }
      // 검토 이력은 묶음의 첫 저장에서 한 번만 만든다
      if (isFirstSave) {
        emit(
          'change.created',
          actorId,
          { resourceId: group.changeId },
          { changeId: group.changeId, editGroupId: request.editGroupId },
        )
      }
      if (request.finalizeGroup) {
        const finalized = closeGroup(request.editGroupId, group)
        eventId ||= finalized.eventId
      }
      response = { ...result, eventId }
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

  function snapshot() {
    const presentation = structuredClone(doc)
    for (const slide of Object.values(presentation.slides)) {
      for (const [id, element] of Object.entries(slide.elements)) {
        slide.elements[id] = withAsset(element)
      }
    }
    // 문서와 이벤트 커서를 같은 시점에서 읽는다
    return { scope: 'editor', presentation, eventCursor: String(events.length) }
  }

  // 미확정. 이벤트 스트림의 줄 형식은 id, event, data를 쓴다고 가정했다
  function openStream(cursor: string | null, signal?: AbortSignal | null): Response {
    const encoder = new TextEncoder()
    let stream: Stream | undefined
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
          write('snapshot_required', undefined, {})
          controller.close()
          return
        }
        for (const event of events.slice(after)) write(event.type, event.eventId, event)

        const current: Stream = {
          send: (event) => write(event.type, event.eventId, event),
          close: () => {
            if (!streams.delete(current)) return
            controller.close()
          },
        }
        stream = current
        streams.add(current)
        signal?.addEventListener('abort', current.close, { once: true })
      },
      cancel() {
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
      return json(200, {
        state: 'authenticated',
        csrfToken: `csrf_${actorId}`,
        expiresAt: new Date(now() + 3600_000).toISOString(),
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
    throw new Error(`mock: 지원하지 않는 요청 ${method} ${path}`)
  }

  // 사용자 한 명의 브라우저 세션이 쓰는 fetch를 만든다
  function fetchAs(actorId: string): typeof fetch {
    return (input, init = {}) => {
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
  }
}
