import { afterEach, expect, test, vi } from 'vitest'
import example from '../entities/presentation/example.json'
import {
  editorSnapshotSchema,
  elementSaveResultSchema,
  presentationSchema,
} from '../entities/presentation/schema.ts'
import type { ElementSaveRequest } from '../entities/presentation/schema.ts'
import { ApiError, TransportError, createApiClient } from '../shared/api/client.ts'
import { createMockServer } from './server.ts'

// 계약 문서의 저장 규칙을 예제와 시험으로 고정한다

const doc = presentationSchema.parse(example)
const slideId = doc.slideIds[0]
const bodyId = 'a1000000-0000-4000-8000-000000000003'
const savePath = `/slides/${slideId}/elements/${bodyId}`

afterEach(() => {
  vi.useRealTimers()
})

function setup() {
  let time = 1_000_000
  const server = createMockServer(doc, {
    now: () => time,
    assetUrls: { 'c3000000-0000-4000-8000-000000000001': '/example-image.png' },
  })
  const client = createApiClient(server.fetchAs('user-a'))
  const other = createApiClient(server.fetchAs('user-b'))
  const element = () => server.getDocument().slides[slideId].elements[bodyId]
  return { server, client, other, element, advance: (ms: number) => (time += ms) }
}

function saveRequest(overrides: Partial<ElementSaveRequest> = {}): ElementSaveRequest {
  return {
    generation: 1,
    baseVersion: 1,
    editGroupId: 'group-1',
    clientMutationId: 'mutation-1',
    patch: { content: { text: '새 본문' } },
    ...overrides,
  }
}

function save(
  client: ReturnType<typeof createApiClient>,
  key: string,
  body: ElementSaveRequest,
) {
  return client.request(savePath, elementSaveResultSchema, {
    method: 'PATCH',
    body,
    idempotencyKey: key,
  })
}

const eventTypes = (server: ReturnType<typeof createMockServer>) =>
  server.events.map((event) => event.type)

test('스냅샷은 문서와 이벤트 커서를 함께 주고 이미지에 임시 주소를 붙인다', async () => {
  const { server, client } = setup()
  const snapshot = await client.request(
    `/projects/${doc.projectId}/sync-snapshot?scope=editor`,
    editorSnapshotSchema,
  )
  expect(snapshot.eventCursor).toBe('0')
  const image = Object.values(snapshot.presentation.slides[slideId].elements).find(
    (el) => el.type === 'image',
  )
  expect(image?.content).toMatchObject({ assetUrl: '/example-image.png' })
  // 저장된 문서에는 임시 주소를 남기지 않는다
  expect(JSON.stringify(server.getDocument())).not.toContain('assetUrl')
})

test('저장하면 요소, 슬라이드, 문서 버전이 오르고 결과를 돌려준다', async () => {
  const { client, element } = setup()
  const result = await save(client, 'key-1', saveRequest())

  expect(result).toMatchObject({
    clientMutationId: 'mutation-1',
    elementVersion: 2,
    slideVersion: 2,
    presentationVersion: 2,
    generation: 1,
  })
  expect(result.resource.version).toBe(2)
  expect(element().content).toEqual({ text: '새 본문' })
})

test('같은 키와 같은 본문의 재시도는 버전 검사보다 먼저 기존 결과를 돌려준다', async () => {
  const { client, element } = setup()
  const first = await save(client, 'key-1', saveRequest())
  // 이미 버전이 올랐으므로 새 요청이라면 충돌이지만 같은 키라서 같은 결과를 받는다
  const retry = await save(client, 'key-1', saveRequest())

  expect(retry).toEqual(first)
  expect(element().version).toBe(2)
})

test('응답을 잃어도 같은 요청을 다시 보내면 한 번만 반영된다', async () => {
  const { server, client, element } = setup()
  server.faults.dropNextResponse = true

  await expect(save(client, 'key-1', saveRequest())).rejects.toBeInstanceOf(TransportError)
  expect(element().version).toBe(2)

  const retry = await save(client, 'key-1', saveRequest())
  expect(retry.elementVersion).toBe(2)
  expect(element().version).toBe(2)
  expect(eventTypes(server).filter((type) => type === 'element.updated')).toHaveLength(1)
})

test('같은 키로 다른 본문을 보내면 거절한다', async () => {
  const { client } = setup()
  await save(client, 'key-1', saveRequest())
  const error = await save(
    client,
    'key-1',
    saveRequest({ patch: { content: { text: '다른 본문' } } }),
  ).catch((e: unknown) => e)

  expect(error).toBeInstanceOf(ApiError)
  expect(error).toMatchObject({ status: 409, code: 'IDEMPOTENCY_KEY_REUSED' })
})

test('처리 중인 키로 다시 보내면 대기 시간과 함께 거절한다', async () => {
  vi.useFakeTimers()
  const { server, client, element } = setup()
  server.faults.delayMs = 500

  const first = save(client, 'key-1', saveRequest())
  await vi.advanceTimersByTimeAsync(10)
  const error = await save(client, 'key-1', saveRequest()).catch((e: unknown) => e)
  expect(error).toMatchObject({
    status: 409,
    code: 'REQUEST_IN_PROGRESS',
    retryAfterSeconds: 1,
  })

  await vi.advanceTimersByTimeAsync(500)
  await expect(first).resolves.toMatchObject({ elementVersion: 2 })
  expect(element().version).toBe(2)
})

test('오래된 버전으로 보낸 새 요청은 현재 버전과 함께 거절하고 저장하지 않는다', async () => {
  const { client, other, element } = setup()
  await save(other, 'key-b', saveRequest({ editGroupId: 'group-b', clientMutationId: 'm-b' }))

  const error = await save(client, 'key-a', saveRequest()).catch((e: unknown) => e)
  expect(error).toMatchObject({
    status: 409,
    code: 'VERSION_CONFLICT',
    currentVersions: { generation: 1, elementVersion: 2 },
  })
  expect(element().version).toBe(2)
})

test('연속 저장은 검토 이력을 하나만 만들고 종료 요청으로 닫는다', async () => {
  const { server, client, element } = setup()
  await save(client, 'key-1', saveRequest())
  await save(client, 'key-2', saveRequest({ baseVersion: 2, clientMutationId: 'm-2' }))
  const closed = await save(
    client,
    'key-3',
    saveRequest({ baseVersion: 3, clientMutationId: 'm-3', finalizeGroup: true, patch: undefined }),
  )

  // 종료만 하는 요청은 내용 버전을 올리지 않는다
  expect(closed.elementVersion).toBe(3)
  expect(element().version).toBe(3)
  expect(eventTypes(server)).toEqual([
    'element.updated',
    'change.created',
    'element.updated',
    'change.finalized',
  ])

  const reuse = await save(
    client,
    'key-4',
    saveRequest({ baseVersion: 3, clientMutationId: 'm-4' }),
  ).catch((e: unknown) => e)
  expect(reuse).toMatchObject({ status: 409, code: 'EDIT_GROUP_CLOSED' })
})

test('2초 동안 입력이 없던 묶음은 다음 쓰기에서 닫힌다', async () => {
  const { server, client, advance } = setup()
  await save(client, 'key-1', saveRequest())
  advance(2000)

  const error = await save(
    client,
    'key-2',
    saveRequest({ baseVersion: 2, clientMutationId: 'm-2' }),
  ).catch((e: unknown) => e)
  expect(error).toMatchObject({ code: 'EDIT_GROUP_CLOSED' })
  expect(eventTypes(server).filter((type) => type === 'change.finalized')).toHaveLength(1)
})

test('다른 작성자가 같은 요소를 고치면 열려 있던 묶음이 닫힌다', async () => {
  const { server, client, other } = setup()
  await save(client, 'key-a', saveRequest())
  await save(
    other,
    'key-b',
    saveRequest({ baseVersion: 2, editGroupId: 'group-b', clientMutationId: 'm-b' }),
  )
  expect(eventTypes(server)).toEqual([
    'element.updated',
    'change.created',
    'change.finalized',
    'element.updated',
    'change.created',
  ])
})

async function readStream(response: Response, untilIncludes: string) {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let text = ''
  while (!text.includes(untilIncludes)) {
    const { value, done } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }
  await reader.cancel()
  return text
}

test('이벤트 연결은 커서 이후부터 재생하고 새 이벤트를 이어서 보낸다', async () => {
  const { server, client } = setup()
  await save(client, 'key-1', saveRequest())

  const response = await server.fetchAs('user-b')(`/v1/projects/${doc.projectId}/events`, {
    headers: { 'Last-Event-ID': '1' },
  })
  const reading = readStream(response, 'id: 3\n')
  await save(client, 'key-2', saveRequest({ baseVersion: 2, clientMutationId: 'm-2' }))
  const text = await reading

  // 커서가 1이므로 첫 이벤트는 다시 보내지 않는다
  expect(text).not.toContain('id: 1\n')
  expect(text).toContain('id: 2\nevent: change.created')
  expect(text).toContain('id: 3\nevent: element.updated')
})

test('보관 범위를 벗어난 커서에는 다시 동기화하라고 알린다', async () => {
  const { server, client } = setup()
  await save(client, 'key-1', saveRequest())
  server.dropEventsBefore(2)

  const response = await server.fetchAs('user-b')(`/v1/projects/${doc.projectId}/events`, {
    headers: { 'Last-Event-ID': '0' },
  })
  expect(await readStream(response, '\n\n')).toContain('event: snapshot_required')
})
