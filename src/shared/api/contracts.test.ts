import { Ajv2020 } from 'ajv/dist/2020.js'
import { expect, test, vi } from 'vitest'
import errorCodes from '../../../contracts/error-codes.json'
import manifest from '../../../contracts/examples/manifest.json'
import apiSchema from '../../../contracts/schemas/api.schema.json'
import documentSchema from '../../../contracts/schemas/document.schema.json'
import {
  editorSnapshotSchema,
  elementChangeSchema,
  elementSaveRequestSchema,
  elementSaveResultSchema,
  elementSchema,
  presentationSchema,
} from '../../entities/presentation/schema.ts'
import { createEditorSession } from '../../features/editor/session.ts'
import { exampleSnapshot } from '../../mocks/example.ts'
import { createMockServer } from '../../mocks/server.ts'
import { createApiClient } from './client.ts'
import {
  capabilitiesSchema,
  errorBodySchema,
  eventEnvelopeSchema,
  sessionBootstrapSchema,
} from './contract.ts'

// 백엔드에서 복사한 계약을 기준으로 프론트엔드 형식과 모킹이 어긋나지 않는지 확인한다

const ajv = new Ajv2020({ schemas: [documentSchema, apiSchema] })
const examples = import.meta.glob<unknown>('../../../contracts/examples/**/*.json', {
  eager: true,
  import: 'default',
})
const example = (name: string) => examples[`../../../contracts/examples/${name}`]

function check(schema: string, value: unknown) {
  const validate = ajv.getSchema(schema)
  if (!validate) throw new Error(`스키마를 찾을 수 없습니다 ${schema}`)
  return validate(value) ? [] : (validate.errors ?? [])
}
const api = (name: string) => `api.schema.json#/$defs/${name}`

test('계약의 예제 목록 전체가 기대한 통과 여부와 일치한다', () => {
  expect(manifest.length).toBeGreaterThan(0)
  for (const entry of manifest) {
    const errors = check(entry.schema, example(entry.example))
    expect(errors.length === 0, `${entry.example} ${JSON.stringify(errors)}`).toBe(entry.valid)
  }
})

// 프론트엔드가 다루는 형식. 계약의 올바른 예제는 모두 받아들여야 한다
const frontendSchemas = [
  ['document.schema.json', presentationSchema],
  ['document.schema.json#/$defs/Element', elementSchema],
  [api('ErrorResponse'), errorBodySchema],
  [api('ElementPatchRequest'), elementSaveRequestSchema],
  [api('Event'), eventEnvelopeSchema],
  [api('AuthBootstrap'), sessionBootstrapSchema],
  [api('Capabilities'), capabilitiesSchema],
  [api('SyncSnapshot'), editorSnapshotSchema],
] as const

test('프론트엔드 형식이 계약의 올바른 예제를 모두 받아들인다', () => {
  let checked = 0
  for (const entry of manifest.filter((item) => item.valid)) {
    const schema = frontendSchemas.find(([name]) => name === entry.schema)?.[1]
    if (!schema) continue
    const result = schema.safeParse(example(entry.example))
    expect(result.success, `${entry.example} ${JSON.stringify(result.error?.issues)}`).toBe(true)
    checked += 1
  }
  expect(checked).toBeGreaterThanOrEqual(15)

  // 요소 수정 응답과 요소 변경 이벤트의 내용
  expect(elementSaveResultSchema.safeParse(example('element-patch-response.json')).success).toBe(true)
  const updated = eventEnvelopeSchema.parse(example('event-element-updated.json'))
  expect(elementChangeSchema.safeParse(updated.payload).success).toBe(true)
})

test('모킹 서버의 응답과 이벤트, 편집 세션이 보내는 요청이 계약 스키마를 통과한다', async () => {
  const server = createMockServer(exampleSnapshot)
  const [userA, userB] = exampleSnapshot.members.map((member) => member.userId)
  const requests: unknown[] = []
  const responses: { status: number; body: unknown }[] = []

  // 주고받는 내용을 모두 기록한다
  const recording = (actor: string): typeof fetch => {
    const inner = server.fetchAs(actor)
    return async (input, init = {}) => {
      if (init.method === 'PATCH') requests.push(JSON.parse(String(init.body)))
      const response = await inner(input, init)
      if (!String(input).endsWith('/events')) {
        responses.push({ status: response.status, body: await response.clone().json() })
      }
      return response
    }
  }
  const open = (actor: string) => {
    const fetchImpl = recording(actor)
    const session = createEditorSession({
      client: createApiClient(fetchImpl),
      fetchImpl,
      projectId: exampleSnapshot.projectId,
      saveDelayMs: 5,
    })
    session.start()
    return session
  }
  const online = (session: ReturnType<typeof open>) =>
    vi.waitFor(() => expect(session.getState().connection).toBe('online'))
  const statusOf = (session: ReturnType<typeof open>, id: string) =>
    session.getState().elements[id]?.status

  const textId = '0193a000-0000-7000-8000-00000000e005'
  const a = open(userA)
  const b = open(userB)
  await online(a)
  await online(b)

  // 저장, 묶음 종료, 끌어서 옮기기
  a.edit(textId, { content: { text: '계약 확인용 입력' } })
  await vi.waitFor(() => expect(statusOf(a, textId)).toBe('saved'))
  const moved = server.getDocument().slides[1].elements[0].geometry
  a.edit(textId, { geometry: { ...moved, x: 96 } })
  a.endEdit(textId)
  await vi.waitFor(() => expect(statusOf(a, textId)).toBe('saved'))
  // 편집을 끝내면 묶음이 닫힌다
  await vi.waitFor(() =>
    expect(server.events.some((event) => event.type === 'change.finalized')).toBe(true),
  )

  // 오래된 버전으로 보낸 요청과 닫힌 묶음을 다시 쓴 요청
  const stale = requests.find((request) => (request as { patch?: unknown }).patch)
  // 같은 작성자가 보내야 묶음 식별자 검사에 걸리지 않는다
  const direct = createApiClient(recording(userA))
  const send = (key: string, body: unknown) =>
    direct
      .request(`/slides/${exampleSnapshot.presentation!.slideIds[1]}/elements/${textId}`, elementSaveResultSchema, {
        method: 'PATCH',
        idempotencyKey: key,
        body,
      })
      .catch(() => undefined)
  await send(crypto.randomUUID(), { ...(stale as object), clientMutationId: 'stale-request' })
  await send(crypto.randomUUID(), {
    ...(stale as object),
    baseVersion: server.getDocument().slides[1].elements[0].version,
    clientMutationId: 'closed-group',
  })
  a.stop()
  b.stop()

  expect(requests.length).toBeGreaterThanOrEqual(3)
  for (const request of requests) {
    expect(check(api('ElementPatchRequest'), request)).toEqual([])
  }

  const seenCodes: string[] = []
  for (const { status, body } of responses) {
    const record = body as Record<string, unknown>
    if (status >= 400) {
      expect(check(api('ErrorResponse'), body)).toEqual([])
      // 상태와 재시도 여부가 계약의 오류 코드 목록과 같다
      const error = record.error as { code: string; retryable: boolean }
      const listed = errorCodes.codes.find((entry) => entry.code === error.code)
      expect(listed, error.code).toMatchObject({ httpStatus: status, retryable: error.retryable })
      seenCodes.push(error.code)
    } else if ('scope' in record) {
      expect(check(api('SyncSnapshot'), body)).toEqual([])
    } else if ('csrfToken' in record) {
      expect(check(api('AuthBootstrap'), body)).toEqual([])
    } else {
      expect(check(api('MutationResponse'), body)).toEqual([])
    }
  }
  expect(seenCodes).toEqual(expect.arrayContaining(['VERSION_CONFLICT', 'EDIT_GROUP_CLOSED']))

  expect(server.events.length).toBeGreaterThanOrEqual(4)
  for (const event of server.events) {
    expect(check(api('Event'), event), event.type).toEqual([])
  }
  // 저장된 문서도 문서 스키마를 지킨다
  expect(check('document.schema.json', server.getDocument())).toEqual([])
})
