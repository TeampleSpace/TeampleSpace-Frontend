import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { elementSaveResultSchema } from '../../entities/presentation/schema.ts'
import { exampleSnapshot } from '../../mocks/example.ts'
import { createApiClient } from '../../shared/api/client.ts'
import { createMockServer } from '../../mocks/server.ts'
import { createEditorSession } from './session.ts'
import type { EditorSession } from './session.ts'

// 저장, 재시도, 충돌, 이벤트 처리를 모킹 서버로 확인한다

// 계약 예제 둘째 슬라이드의 텍스트 요소. 둘 다 처음 버전이 1이다
const projectId = exampleSnapshot.projectId
const slideId = '0193a000-0000-7000-8000-0000000000a2'
const titleId = '0193a000-0000-7000-8000-00000000e011'
const bodyId = '0193a000-0000-7000-8000-00000000e005'
const actorIds: Record<string, string> = {
  'user-a': '0193a000-0000-7000-8000-0000000000d1',
  'user-b': '0193a000-0000-7000-8000-0000000000d2',
  'user-c': '0193a000-0000-7000-8000-0000000000d3',
}

type Call = {
  actor: string
  method: string
  path: string
  key?: string
  body?: string
  lastEventId?: string
  at: number
}

const text = (value: string) => ({ content: { text: value } })
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms)
// 연결과 응답 처리가 여러 단계에 걸쳐 끝날 때까지 기다린다
async function settle() {
  for (let index = 0; index < 10; index += 1) await tick(1)
}

function setup() {
  const server = createMockServer(exampleSnapshot)
  const calls: Call[] = []
  const control: { failNextPatch: boolean; failNextDelete: boolean; dropNextPostResponse: boolean; snapshotGate?: Promise<void> } = {
    failNextPatch: false,
    failNextDelete: false,
    dropNextPostResponse: false,
  }

  function tracked(actor: string, silentEvents: boolean): typeof fetch {
    const inner = server.fetchAs(actorIds[actor])
    return (input, init = {}) => {
      const headers = new Headers(init.headers)
      const method = init.method ?? 'GET'
      const path = String(input).replace(/^\/v1/, '').replace(/\?.*$/, '')
      calls.push({
        actor,
        method,
        path,
        key: headers.get('Idempotency-Key') ?? undefined,
        body: init.body ? String(init.body) : undefined,
        lastEventId: headers.get('Last-Event-ID') ?? undefined,
        at: Date.now(),
      })
      if (method === 'PATCH' && control.failNextPatch) {
        // 요청이 서버에 닿지 못한 상황
        control.failNextPatch = false
        return Promise.reject(new TypeError('연결 실패'))
      }
      if (silentEvents && path.endsWith('/events')) {
        // 연결은 됐지만 이벤트가 오지 않는 상황
        return Promise.resolve(new Response(new ReadableStream()))
      }
      if (method === 'DELETE' && control.failNextDelete) {
        control.failNextDelete = false
        return Promise.reject(new TypeError('연결 실패'))
      }
      if (method === 'POST' && path.endsWith('/elements') && control.dropNextPostResponse) {
        // 서버는 반영하고 응답만 잃는다
        control.dropNextPostResponse = false
        return inner(input, init).then(() => Promise.reject(new TypeError('응답 유실')))
      }
      if (path.endsWith('/sync-snapshot') && control.snapshotGate) {
        // 지금 시점의 스냅샷을 만들어 두고 응답만 늦춘다
        const gate = control.snapshotGate
        return inner(input, init).then((response) => gate.then(() => response))
      }
      return inner(input, init)
    }
  }

  function open(
    actor: string,
    options: { silentEvents?: boolean } & Partial<Parameters<typeof createEditorSession>[0]> = {},
  ) {
    const { silentEvents = false, ...rest } = options
    const fetchImpl = tracked(actor, silentEvents)
    const session = createEditorSession({
      client: createApiClient(fetchImpl),
      fetchImpl,
      projectId,
      ...rest,
    })
    session.start()
    return session
  }

  // 세션을 거치지 않고 서버에 직접 저장하는 다른 사용자
  async function saveDirectly(actor: string, value: string) {
    const element = serverElement()
    await createApiClient(server.fetchAs(actorIds[actor])).request(
      `/slides/${slideId}/elements/${bodyId}`,
      elementSaveResultSchema,
      {
        method: 'PATCH',
        idempotencyKey: crypto.randomUUID(),
        body: {
          generation: 1,
          baseVersion: element.version,
          editGroupId: crypto.randomUUID(),
          clientMutationId: crypto.randomUUID(),
          patch: text(value),
        },
      },
    )
  }

  const serverElement = (id = bodyId) =>
    server
      .getDocument()
      .slides.flatMap((slide) => slide.elements)
      .find((element) => element.id === id)!
  const serverText = (id = bodyId) => {
    const element = serverElement(id)
    return element.type === 'text' ? element.content.text : undefined
  }
  const patches = (actor = 'user-a') =>
    calls.filter((call) => call.actor === actor && call.method === 'PATCH')
  const eventCount = (type: string) =>
    server.events.filter((event) => event.type === type).length

  return { server, calls, control, open, saveDirectly, serverElement, serverText, patches, eventCount }
}

function textOf(session: EditorSession, id = bodyId) {
  const element = session
    .getState()
    .view?.slides.flatMap((slide) => slide.elements)
    .find((candidate) => candidate.id === id)
  return element?.type === 'text' ? element.content.text : undefined
}
const statusOf = (session: EditorSession, id = bodyId) =>
  session.getState().elements[id]?.status
const patchOf = (call: Call) => JSON.parse(call.body ?? '{}')

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

test('시작하면 스냅샷으로 문서를 읽고 이벤트 연결을 연다', async () => {
  const { open, calls } = setup()
  const a = open('user-a')
  await tick()

  expect(a.getState().connection).toBe('online')
  expect(textOf(a)).toBe('조사 결과 요약')
  expect(calls.map((call) => call.path)).toEqual([
    `/projects/${projectId}/sync-snapshot`,
    `/projects/${projectId}/events`,
  ])
  // 구독은 스냅샷이 준 커서 뒤에서 시작한다
  expect(calls[1].lastEventId).toBe('0')
})

test('입력이 이어지는 동안은 보내지 않고 600ms 쉬면 한 번 저장한다', async () => {
  const { open, patches, serverText } = setup()
  const a = open('user-a')
  await tick()

  a.edit(bodyId, text('가'))
  await tick(300)
  a.edit(bodyId, text('가나'))
  await tick(300)
  a.edit(bodyId, text('가나다'))
  expect(patches()).toHaveLength(0)
  expect(statusOf(a)).toBe('dirty')

  await tick(600)
  expect(patches()).toHaveLength(1)
  expect(serverText()).toBe('가나다')
  expect(statusOf(a)).toBe('saved')
})

test('한글 조합 중에는 저장하지 않고 조합이 끝난 글자만 저장한다', async () => {
  const { open, patches, serverText } = setup()
  const a = open('user-a')
  await tick()

  a.edit(bodyId, text('ㅎ'), { composing: true })
  await tick(700)
  a.edit(bodyId, text('하'), { composing: true })
  await tick(700)
  a.edit(bodyId, text('한'), { composing: true })
  await tick(5000)
  // 조합 중 멈춰 있어도 중간 글자를 보내지 않는다
  expect(patches()).toHaveLength(0)
  expect(textOf(a)).toBe('한')

  a.edit(bodyId, text('한'))
  await tick(600)
  expect(patches()).toHaveLength(1)
  expect(patchOf(patches()[0]).patch.content.text).toBe('한')
  expect(serverText()).toBe('한')
})

test('저장 중에 새 입력이 생기면 이전 응답이 화면을 덮지 않고 이어서 저장한다', async () => {
  const { server, open, patches, serverText } = setup()
  const a = open('user-a')
  await tick()
  server.faults.delayMs = 1000

  a.edit(bodyId, text('첫 입력'))
  await tick(600)
  expect(patches()).toHaveLength(1)

  a.edit(bodyId, text('첫 입력에 이어 쓴 내용'))
  await tick(700)
  // 같은 요소는 한 번에 한 요청만 보낸다
  expect(patches()).toHaveLength(1)

  await tick(300)
  // 첫 응답이 도착했지만 화면에는 최신 입력이 그대로 있다
  expect(serverText()).toBe('첫 입력')
  expect(textOf(a)).toBe('첫 입력에 이어 쓴 내용')
  expect(statusOf(a)).not.toBe('saved')
  expect(patches()).toHaveLength(2)
  // 다음 요청은 응답으로 받은 버전을 기준으로 하고 새 키를 쓴다
  expect(patchOf(patches()[1]).baseVersion).toBe(2)
  expect(patches()[1].key).not.toBe(patches()[0].key)

  await tick(1000)
  expect(serverText()).toBe('첫 입력에 이어 쓴 내용')
  expect(statusOf(a)).toBe('saved')
})

test('응답을 잃으면 같은 키, 같은 식별자, 같은 본문으로 다시 보내고 한 번만 반영된다', async () => {
  const { server, open, patches, serverElement } = setup()
  const a = open('user-a', { silentEvents: true })
  await tick()
  server.faults.dropNextResponse = true

  a.edit(bodyId, text('유실 시험'))
  await tick(600)
  expect(serverElement().version).toBe(2)
  expect(statusOf(a)).toBe('saving')

  await tick(1000)
  const [first, second] = patches()
  expect(second.key).toBe(first.key)
  expect(second.body).toBe(first.body)
  // 자기 저장의 재시도가 충돌로 처리되지 않는다
  expect(serverElement().version).toBe(2)
  expect(statusOf(a)).toBe('saved')
})

test('응답을 잃어도 내 저장의 이벤트가 먼저 오면 그것으로 확인 처리한다', async () => {
  const { server, open, patches } = setup()
  const a = open('user-a')
  await tick()
  server.faults.dropNextResponse = true

  a.edit(bodyId, text('이벤트로 확인'))
  await tick(600)
  expect(statusOf(a)).toBe('saved')

  await tick(5000)
  // 이미 확인됐으므로 같은 내용을 다시 보내지 않는다
  expect(patches().filter((call) => patchOf(call).patch)).toHaveLength(1)
})

test('요청이 서버에 닿지 못했을 때도 같은 요청으로 다시 보낸다', async () => {
  const { control, open, patches, serverElement } = setup()
  const a = open('user-a')
  await tick()
  control.failNextPatch = true

  a.edit(bodyId, text('닿지 못한 요청'))
  await tick(600)
  expect(serverElement().version).toBe(1)

  await tick(1000)
  expect(patches()[1].key).toBe(patches()[0].key)
  expect(serverElement().version).toBe(2)
  expect(statusOf(a)).toBe('saved')
})

test('서버 내부 오류는 자동으로 다시 보내지 않고 입력을 남기며 다시 시도하면 같은 요청을 보낸다', async () => {
  const { server, open, patches, serverText } = setup()
  const a = open('user-a')
  await tick()
  server.faults.failNextCode = 'INTERNAL_ERROR'

  a.edit(bodyId, text('서버 오류 시험'))
  await tick(600)
  expect(statusOf(a)).toBe('failed')
  expect(textOf(a)).toBe('서버 오류 시험')
  expect(serverText()).not.toBe('서버 오류 시험')

  await tick(10000)
  expect(patches()).toHaveLength(1)

  a.retry(bodyId)
  await tick()
  expect(patches()[1].key).toBe(patches()[0].key)
  expect(patches()[1].body).toBe(patches()[0].body)
  expect(serverText()).toBe('서버 오류 시험')
  expect(statusOf(a)).toBe('saved')
})

test('다른 사람이 먼저 저장했으면 덮어쓰지 않고 두 내용을 함께 남긴다', async () => {
  const { open, patches, saveDirectly, serverText } = setup()
  // 다른 사람의 변경 이벤트를 받기 전에 저장을 시도하는 상황
  const a = open('user-a', { silentEvents: true })
  await tick()
  await saveDirectly('user-b', 'B가 먼저 저장')

  a.edit(bodyId, text('A의 입력'))
  await tick(600)
  await tick()
  expect(statusOf(a)).toBe('conflict')
  expect(serverText()).toBe('B가 먼저 저장')
  expect(textOf(a)).toBe('A의 입력')
  expect(a.getState().elements[bodyId].serverLatest).toMatchObject({
    version: 2,
    content: { text: 'B가 먼저 저장' },
  })

  // 충돌한 요청을 자동으로 다시 보내지 않는다
  const sent = patches().length
  await tick(10000)
  expect(patches()).toHaveLength(sent)

  // 내 입력으로 다시 편집을 골라도 바로 강제 저장하지 않는다
  a.resolveConflict(bodyId, 'mine')
  await tick(5000)
  expect(patches()).toHaveLength(sent)
  expect(textOf(a)).toBe('A의 입력')

  a.edit(bodyId, text('A의 입력을 고쳐 다시 저장'))
  await tick(600)
  expect(patchOf(patches().at(-1)!).baseVersion).toBe(2)
  expect(serverText()).toBe('A의 입력을 고쳐 다시 저장')
})

test('충돌에서 최신 내용으로 계속을 고르면 내 입력을 버리고 서버 내용을 쓴다', async () => {
  const { open, saveDirectly } = setup()
  const a = open('user-a', { silentEvents: true })
  await tick()
  await saveDirectly('user-b', 'B가 먼저 저장')
  a.edit(bodyId, text('A의 입력'))
  await tick(600)
  await tick()

  a.resolveConflict(bodyId, 'server')
  expect(textOf(a)).toBe('B가 먼저 저장')
  expect(statusOf(a)).toBe('clean')
})

test('입력 중인 요소에 다른 사람의 변경이 오면 보내기 전에 충돌로 표시한다', async () => {
  const { open, patches } = setup()
  const a = open('user-a')
  const b = open('user-b')
  await tick()

  a.edit(bodyId, text('A 작성 중'))
  await tick(100)
  b.edit(bodyId, text('B 저장'))
  b.endEdit(bodyId)
  await tick()

  expect(statusOf(a)).toBe('conflict')
  expect(textOf(a)).toBe('A 작성 중')
  await tick(3000)
  expect(patches('user-a')).toHaveLength(0)
})

test('두 세션이 서로 다른 요소를 고치면 충돌 없이 각각 저장되고 서로에게 보인다', async () => {
  const { open, serverText } = setup()
  const a = open('user-a')
  const b = open('user-b')
  await tick()

  a.edit(titleId, text('A가 고친 제목'))
  b.edit(bodyId, text('B가 고친 본문'))
  await tick(600)

  expect(serverText(titleId)).toBe('A가 고친 제목')
  expect(serverText(bodyId)).toBe('B가 고친 본문')
  expect(textOf(a, bodyId)).toBe('B가 고친 본문')
  expect(textOf(b, titleId)).toBe('A가 고친 제목')
  expect(statusOf(a, titleId)).toBe('saved')
  expect(statusOf(b, bodyId)).toBe('saved')
})

test('같은 이벤트가 두 번 와도 한 번만 반영한다', async () => {
  const { server, open } = setup()
  const a = open('user-a')
  const b = open('user-b')
  await tick()
  server.faults.duplicateEvents = true

  b.edit(bodyId, text('중복 시험'))
  b.endEdit(bodyId)
  await tick()

  expect(textOf(a)).toBe('중복 시험')
  expect(statusOf(a)).toBe('clean')
  expect(a.getState().stats.duplicateEvents).toBeGreaterThan(0)
})

test('연결이 끊기면 새 편집을 막고 다시 연결되면 놓친 이벤트를 커서 이후부터 받는다', async () => {
  const { server, calls, open, saveDirectly } = setup()
  const a = open('user-a')
  await tick()

  server.closeStreams()
  await tick()
  expect(a.getState().connection).toBe('offline')
  expect(a.edit(bodyId, text('끊긴 동안의 입력'))).toBe(false)

  await saveDirectly('user-c', '끊긴 동안 C가 저장')
  await tick(1000)

  expect(a.getState().connection).toBe('online')
  expect(textOf(a)).toBe('끊긴 동안 C가 저장')
  // 보낼 입력이 없으면 스냅샷을 다시 읽지 않고 마지막 이벤트 뒤부터 재생받는다
  expect(a.getState().stats.snapshots).toBe(1)
  const reconnect = calls.filter((call) => call.actor === 'user-a').at(-1)
  expect(reconnect).toMatchObject({ path: `/projects/${projectId}/events`, lastEventId: '0' })
})

test('끊기기 전 입력은 현재 탭에 남기고 다시 연결되면 스냅샷과 비교한 뒤 저장한다', async () => {
  const { server, calls, open, serverText } = setup()
  const a = open('user-a')
  await tick()

  a.edit(bodyId, text('끊기기 전 입력'))
  await tick(100)
  server.setOffline(true)
  await tick(1900)
  expect(a.getState().connection).toBe('offline')
  expect(textOf(a)).toBe('끊기기 전 입력')
  expect(serverText()).not.toBe('끊기기 전 입력')

  server.setOffline(false)
  await tick(2000)
  expect(a.getState().connection).toBe('online')
  expect(serverText()).toBe('끊기기 전 입력')
  expect(statusOf(a)).toBe('saved')

  // 스냅샷, 이벤트 연결, 저장 순서로 진행한다
  const order = calls
    .filter((call) => call.actor === 'user-a' && call.path !== '/auth/bootstrap')
    .slice(-3)
    .map((call) => `${call.method} ${call.path.split('/').at(-1)}`)
  expect(order).toEqual(['GET sync-snapshot', 'GET events', `PATCH ${bodyId}`])
})

test('커서가 보관 범위를 벗어나면 스냅샷을 다시 읽어 맞춘다', async () => {
  const { server, open, saveDirectly } = setup()
  const a = open('user-a')
  await tick()

  server.closeStreams()
  await tick()
  await saveDirectly('user-c', '첫 변경')
  await saveDirectly('user-c', '둘째 변경')
  server.dropEventsBefore(3)

  await tick(1000)
  await settle()
  expect(a.getState().stats.snapshots).toBe(2)
  expect(a.getState().connection).toBe('online')
  expect(textOf(a)).toBe('둘째 변경')
})

test('여러 번 저장해도 검토 이력은 하나로 묶이고 2초 쉰 뒤의 입력은 새 묶음이 된다', async () => {
  const { open, eventCount, patches } = setup()
  const a = open('user-a')
  await tick()

  for (let index = 1; index <= 5; index += 1) {
    a.edit(bodyId, text(`입력 ${index}`))
    await tick(700)
  }
  expect(eventCount('element.updated')).toBe(5)
  expect(eventCount('change.created')).toBe(1)
  expect(eventCount('change.finalized')).toBe(0)

  // 시간에 따른 종료는 서버가 판단한다. 클라이언트는 닫는 요청을 보내지 않는다
  await tick(2000)
  expect(patches()).toHaveLength(5)
  expect(eventCount('change.finalized')).toBe(0)

  // 다음 저장에서 서버가 이전 묶음을 닫고 새 묶음이 열린다. 닫힌 묶음을 다시 써서 거절당하지 않는다
  a.edit(bodyId, text('쉰 뒤의 입력'))
  await tick(700)
  expect(patches()).toHaveLength(6)
  expect(eventCount('change.finalized')).toBe(1)
  expect(eventCount('change.created')).toBe(2)
  expect(statusOf(a)).toBe('saved')
})

test('다른 요소로 옮겨 가면 이전 요소의 묶음을 닫는다', async () => {
  const { open, eventCount, patches } = setup()
  const a = open('user-a')
  await tick()

  a.edit(bodyId, text('먼저 고친 요소'))
  await tick(700)
  a.endEdit(bodyId)
  await tick()
  // 내용 없이 묶음만 닫는 요청이 한 번 간다
  expect(patches().filter((call) => !patchOf(call).patch)).toHaveLength(1)
  expect(eventCount('change.finalized')).toBe(1)

  a.edit(titleId, text('다음에 고친 요소'))
  await tick(700)
  expect(eventCount('change.created')).toBe(2)
  expect(eventCount('change.finalized')).toBe(1)
})

test('30초 넘게 이어 쓰면 묶음을 닫고 새 묶음으로 이어 간다', async () => {
  const { open, eventCount, serverText } = setup()
  const a = open('user-a')
  await tick()

  for (let index = 1; index <= 45; index += 1) {
    a.edit(bodyId, text(`입력 ${index}`))
    await tick(700)
  }
  expect(serverText()).toBe('입력 45')
  expect(eventCount('change.created')).toBe(2)
  expect(eventCount('change.finalized')).toBe(1)
})

test('편집을 끝내면 남은 입력을 바로 저장하면서 묶음을 닫는다', async () => {
  const { server, open, patches, serverElement } = setup()
  const a = open('user-a')
  await tick()

  // 끌어서 옮긴 뒤 놓는 동작
  a.edit(bodyId, { geometry: { ...serverElement().geometry, x: 120, y: 200 } })
  a.endEdit(bodyId)
  await tick()

  expect(patches()).toHaveLength(1)
  expect(patchOf(patches()[0]).finalizeGroup).toBe(true)
  expect(serverElement().geometry).toMatchObject({ x: 120, y: 200, width: 1000 })
  expect(server.events.map((event) => event.type)).toEqual([
    'element.updated',
    'change.created',
    'change.finalized',
  ])
})

test('처리 중이라는 응답을 받으면 알려 준 시간 뒤에 같은 요청을 다시 보낸다', async () => {
  // 요청 제한 시간은 실제 시계를 쓰므로 이 시험만 실제 시간으로 돌린다
  vi.useRealTimers()
  const { server, open, patches, serverElement } = setup()
  const a = open('user-a', {
    silentEvents: true,
    saveDelayMs: 10,
    requestTimeoutMs: 40,
    retryDelaysMs: [10],
  })
  await vi.waitFor(() => expect(a.getState().connection).toBe('online'))
  server.faults.delayMs = 200

  a.edit(bodyId, text('느린 서버'))
  await vi.waitFor(() => expect(statusOf(a)).toBe('saved'), { timeout: 4000 })

  const sent = patches()
  expect(sent).toHaveLength(3)
  expect(new Set(sent.map((call) => call.key)).size).toBe(1)
  expect(new Set(sent.map((call) => call.body)).size).toBe(1)
  // 서버가 알려 준 1초가 지나기 전에는 다시 보내지 않는다
  expect(sent[2].at - sent[1].at).toBeGreaterThanOrEqual(990)
  expect(serverElement().version).toBe(2)
  a.stop()
})

test('첫 스냅샷을 읽지 못하면 바로 되풀이하지 않고 간격을 두고 다시 시도한다', async () => {
  const { server, calls, open } = setup()
  server.setOffline(true)
  const a = open('user-a')
  await settle()
  await tick(500)

  const snapshots = () => calls.filter((call) => call.path.endsWith('/sync-snapshot')).length
  expect(snapshots()).toBe(1)
  expect(a.getState()).toMatchObject({ connection: 'offline', loaded: false })

  server.setOffline(false)
  await tick(1000)
  await settle()
  expect(snapshots()).toBe(2)
  expect(a.getState()).toMatchObject({ connection: 'online', loaded: true })
})

test('프로젝트에 접근할 수 없으면 세션을 멈추고 다시 연결하지 않는다', async () => {
  let requests = 0
  const denied: typeof fetch = () => {
    requests += 1
    return Promise.resolve(
      new Response(
        JSON.stringify({
          error: { code: 'ACCESS_DENIED', message: '프로젝트 접근 권한이 없어요.', retryable: false },
          requestId: 'req_denied',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    )
  }
  const session = createEditorSession({
    client: createApiClient(denied),
    fetchImpl: denied,
    projectId,
  })
  session.start()
  await settle()
  await tick(20000)

  expect(requests).toBe(1)
  expect(session.getState().rejected).toMatchObject({ status: 403, code: 'ACCESS_DENIED' })
  expect(session.getState().connection).toBe('offline')
})

test('오래 이어진 구독을 서버가 끝내면 끊김으로 보지 않고 바로 다시 구독한다', async () => {
  const { server, open, saveDirectly } = setup()
  const a = open('user-a')
  await tick(6000)
  const seen: string[] = []
  a.subscribe(() => seen.push(a.getState().connection))

  server.closeStreams()
  await settle()
  expect(seen).not.toContain('offline')
  expect(a.getState().connection).toBe('online')
  expect(a.edit(bodyId, text('이어서 입력'))).toBe(true)

  await saveDirectly('user-c', '다시 구독한 뒤의 변경')
  await settle()
  expect(a.getState().elements[bodyId].status).toBe('conflict')
})

test('문서를 만들기 전에는 읽었다는 표시만 남기고 팀원 수를 알려 준다', async () => {
  const fetchImpl: typeof fetch = (input) =>
    Promise.resolve(
      String(input).includes('/sync-snapshot')
        ? Response.json({ ...exampleSnapshot, presentation: null })
        : new Response(new ReadableStream()),
    )
  const session = createEditorSession({ client: createApiClient(fetchImpl), fetchImpl, projectId })
  session.start()
  await settle()

  expect(session.getState()).toMatchObject({
    loaded: true,
    view: undefined,
    pending: false,
    memberCount: exampleSnapshot.members.length,
  })
  session.stop()
})

test('남은 입력을 바로 보내면 보낸 요청은 남는 입력으로 세지 않고 끊긴 동안의 입력은 남는다', async () => {
  const { server, open, patches, serverText } = setup()
  const a = open('user-a')
  await tick()

  a.edit(bodyId, text('떠나기 전 입력'))
  // 저장 대기 시간을 기다리지 않고 바로 보낸다
  expect(a.flush()).toBe(false)
  await settle()
  expect(patches()).toHaveLength(1)
  expect(serverText()).toBe('떠나기 전 입력')

  a.edit(bodyId, text('끊기기 직전 입력'))
  server.setOffline(true)
  await tick()
  expect(a.flush()).toBe(true)
})

test('문서 교체 이벤트 뒤 스냅샷을 읽지 못하면 다시 연결해 스냅샷부터 읽는다', async () => {
  const encoder = new TextEncoder()
  let push: ((chunk: string) => void) | undefined
  let snapshots = 0
  const fetchImpl: typeof fetch = (input, init) => {
    if (String(input).includes('/sync-snapshot')) {
      snapshots += 1
      // 처음에는 문서가 없고, 이벤트 뒤 첫 조회는 실패하고, 그다음 조회에서 만든 문서를 받는다
      if (snapshots === 1) return Promise.resolve(Response.json({ ...exampleSnapshot, presentation: null, eventCursor: '1' }))
      if (snapshots === 2) return Promise.reject(new TypeError('network'))
      return Promise.resolve(Response.json({ ...exampleSnapshot, eventCursor: '2' }))
    }
    return Promise.resolve(new Response(new ReadableStream({
      // 실제 fetch처럼 연결을 끊으면 스트림도 끝난다
      start(controller) {
        push = (chunk) => controller.enqueue(encoder.encode(chunk))
        init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason))
      },
    })))
  }
  const session = createEditorSession({ client: createApiClient(fetchImpl), fetchImpl, projectId })
  session.start()
  await settle()
  expect(session.getState().view).toBeUndefined()

  push?.(`id: 2\nevent: presentation.replaced\ndata: ${JSON.stringify({
    eventId: '2', projectId, type: 'presentation.replaced', occurredAt: '2026-11-22T00:00:00Z',
    presentationVersion: 1, generation: 1, payload: { presentationId: exampleSnapshot.presentation?.id },
  })}\n\n`)
  await settle()
  await tick(0)
  await settle()

  expect(snapshots).toBe(3)
  expect(session.getState().view?.slides.length).toBe(exampleSnapshot.presentation?.slides.length)
  session.stop()
})

test('내 커서를 짧은 간격으로 모아 보내고 다른 팀원의 커서만 이름과 함께 받는다', async () => {
  const { open, calls } = setup()
  const a = open('user-a')
  const b = open('user-b')
  await settle()
  const presence = () => calls.filter((call) => call.actor === 'user-a' && call.path.endsWith('/presence'))

  // 한꺼번에 움직이면 마지막 위치 하나만 정수로 보낸다
  a.movePointer(slideId, 10.4, 20.6)
  a.movePointer(slideId, 30, 40)
  a.movePointer(slideId, 50.4, 59.6)
  await settle()
  await tick(150)
  expect(presence().map((call) => JSON.parse(call.body!))).toEqual([{ slideId, x: 50, y: 60 }])
  expect(b.getState().cursors).toEqual([{ userId: actorIds['user-a'], slideId, x: 50, y: 60 }])
  expect(b.getState().memberNames[actorIds['user-a']]).toBeTruthy()
  // 내 커서는 내게 오지 않는다
  expect(a.getState().cursors).toEqual([])

  // 움직이지 않아도 서버가 지우기 전에 같은 위치를 다시 알린다
  await tick(5000)
  expect(presence()).toHaveLength(2)

  // 캔버스를 벗어나면 다른 팀원에게서 사라진다
  a.movePointer(null)
  await settle()
  expect(b.getState().cursors).toEqual([])

  // 화면을 떠날 때도 지운다
  a.movePointer(slideId, 5, 5)
  await settle()
  expect(b.getState().cursors).toHaveLength(1)
  a.stop()
  await settle()
  expect(b.getState().cursors).toEqual([])
  b.stop()
})

test('요소를 지우고 되돌리면 같은 내용의 새 요소가 생기고 다시 실행하면 다시 지운다', async () => {
  const { open, server, eventCount } = setup()
  const a = open('user-a')
  const b = open('user-b')
  await tick()
  const liveIds = (session: EditorSession) =>
    session.getState().view!.slides.find((slide) => slide.id === slideId)!.elements
      .filter((element) => !element.deletedAt).map((element) => element.id)

  await a.deleteElement(bodyId)
  await settle()
  expect(liveIds(a)).not.toContain(bodyId)
  // 다른 팀원 화면에서도 지워진다
  expect(liveIds(b)).not.toContain(bodyId)
  expect(eventCount('element.deleted')).toBe(1)

  expect(await a.undo()).toBe(true)
  await settle()
  const restored = server.getDocument().slides.find((slide) => slide.id === slideId)!.elements.at(-1)!
  expect(restored.id).not.toBe(bodyId)
  expect(restored.type === 'text' && restored.content.text).toBe('조사 결과 요약')
  expect(liveIds(a)).toContain(restored.id)
  // 모르는 요소 추가는 다른 화면에서 스냅샷으로 맞춘다
  expect(liveIds(b)).toContain(restored.id)

  expect(await a.redo()).toBe(true)
  await settle()
  expect(liveIds(a)).not.toContain(restored.id)
  expect(await a.redo()).toBe(false)
})

test('편집을 끝낸 단위로 되돌리고 다시 실행한다', async () => {
  const { open, serverText } = setup()
  const a = open('user-a')
  await tick()

  a.edit(bodyId, text('가'))
  a.edit(bodyId, text('가나'))
  a.endEdit(bodyId)
  await settle()
  expect(serverText()).toBe('가나')

  expect(await a.undo()).toBe(true)
  await settle()
  expect(serverText()).toBe('조사 결과 요약')
  expect(await a.undo()).toBe(false)

  expect(await a.redo()).toBe(true)
  await settle()
  expect(serverText()).toBe('가나')
})

test('붙여넣은 요소를 되돌리면 지운다', async () => {
  const { open, serverElement } = setup()
  const a = open('user-a')
  await tick()

  const source = serverElement()
  const created = await a.createElement(slideId, { ...source, geometry: { ...source.geometry, x: source.geometry.x + 20 } })
  await settle()
  expect(serverElement(created.id).geometry.x).toBe(source.geometry.x + 20)

  expect(await a.undo()).toBe(true)
  await settle()
  expect(serverElement(created.id)).toBeUndefined()
})

test('되돌리기 요청이 실패하면 기록을 남겨 다시 시도할 수 있다', async () => {
  const { open, control, serverElement } = setup()
  const a = open('user-a')
  await tick()

  const created = await a.createElement(slideId, serverElement())
  await settle()
  control.failNextDelete = true
  await expect(a.undo()).rejects.toThrow()
  expect(serverElement(created.id)).toBeDefined()

  expect(await a.undo()).toBe(true)
  await settle()
  expect(serverElement(created.id)).toBeUndefined()
})

test('늦게 도착한 스냅샷이 그사이 추가한 요소를 지우지 않는다', async () => {
  const { open, control, serverElement } = setup()
  const a = open('user-a')
  await tick()

  let release = () => {}
  control.snapshotGate = new Promise((resolve) => {
    release = resolve
  })
  const stale = a.refresh()
  await settle()
  const created = await a.createElement(slideId, serverElement())
  control.snapshotGate = undefined
  release()
  await stale
  await settle()

  const live = a.getState().view!.slides.flatMap((slide) => slide.elements).find((element) => element.id === created.id)
  expect(live?.deletedAt).toBeUndefined()
})

test('방향키로 옮긴 뒤 복제하면 복제부터 되돌린다', async () => {
  const { open, serverElement } = setup()
  const a = open('user-a')
  await tick()

  const original = serverElement()
  a.edit(bodyId, { geometry: { ...original.geometry, x: original.geometry.x + 10 } })
  const created = await a.createElement(slideId, { ...original, geometry: { ...original.geometry, x: original.geometry.x + 30 } })
  // 옮긴 위치는 저장 대기 시간이 지나면 저장된다
  await tick(700)
  await settle()
  expect(serverElement().geometry.x).toBe(original.geometry.x + 10)

  expect(await a.undo()).toBe(true)
  await settle()
  expect(serverElement(created.id)).toBeUndefined()
  expect(serverElement().geometry.x).toBe(original.geometry.x + 10)

  expect(await a.undo()).toBe(true)
  await settle()
  expect(serverElement().geometry.x).toBe(original.geometry.x)
})

test('되살리기 응답을 잃은 뒤 다시 시도해도 요소가 하나만 생긴다', async () => {
  const { open, control, server } = setup()
  const a = open('user-a')
  await tick()
  const sameText = () =>
    server.getDocument().slides.find((slide) => slide.id === slideId)!.elements
      .filter((element) => element.type === 'text' && element.content.text === '조사 결과 요약')

  await a.deleteElement(bodyId)
  await settle()
  control.dropNextPostResponse = true
  await expect(a.undo()).rejects.toThrow()
  await settle()
  expect(await a.undo()).toBe(true)
  await settle()
  expect(sameText()).toHaveLength(1)

  // 다시 실행하면 그 요소가 지워진다
  expect(await a.redo()).toBe(true)
  await settle()
  expect(sameText()).toHaveLength(0)
})
