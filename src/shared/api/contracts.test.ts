import { Ajv2020 } from 'ajv/dist/2020.js'
import { expect, test, vi } from 'vitest'
import errorCodes from '../../../contracts/error-codes.json'
import manifest from '../../../contracts/examples/manifest.json'
import apiSchema from '../../../contracts/schemas/api.schema.json'
import documentSchema from '../../../contracts/schemas/document.schema.json'
import stageSchema from '../../../contracts/schemas/stage-1.schema.json'
import materialStageSchema from '../../../contracts/schemas/stage-2.schema.json'
import { authCapabilitiesSchema, userSchema, challengeSchema, loginSchema } from '../../features/auth/model.ts'
import { projectSchema, projectListSchema, memberListSchema, invitationSchema, acceptSchema, removalSchema } from '../../features/projects/model.ts'
import {
  editorSnapshotSchema,
  elementChangeSchema,
  elementSaveRequestSchema,
  elementSaveResultSchema,
  elementSchema,
  presentationSchema,
} from '../../entities/presentation/schema.ts'
import { createEditorSession } from '../../features/editor/session.ts'
import { createMaterialsApi } from '../../features/materials/api.ts'
import {
  jobSchema, materialCreatedSchema, materialDeletedSchema, materialListSchema, materialNoteSavedSchema, materialNoteSchema,
  materialSchema, materialSourceSchema, materialSummarySchema, uploadTicketSchema,
} from '../../features/materials/model.ts'
import { createMaterialsMock } from '../../mocks/materials.ts'
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

const ajv = new Ajv2020({ schemas: [documentSchema, apiSchema, stageSchema, materialStageSchema] })
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
const stage2 = (name: string) => `stage-2.schema.json#/$defs/${name}`

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
  ['stage-1.schema.json#/$defs/User', userSchema],
  ['stage-1.schema.json#/$defs/ChallengeResponse', challengeSchema],
  ['stage-1.schema.json#/$defs/LoginResponse', loginSchema],
  ['stage-1.schema.json#/$defs/Project', projectSchema],
  ['stage-1.schema.json#/$defs/ProjectList', projectListSchema],
  ['stage-1.schema.json#/$defs/MemberList', memberListSchema],
  ['stage-1.schema.json#/$defs/InvitationPreview', invitationSchema],
  ['stage-1.schema.json#/$defs/InvitationAccepted', acceptSchema],
  ['stage-1.schema.json#/$defs/RemoveMemberResponse', removalSchema],
  [api('SyncSnapshot'), editorSnapshotSchema],
  [api('Job'), jobSchema],
  [api('MaterialNote'), materialNoteSchema],
  [api('MaterialNoteSaveResponse'), materialNoteSavedSchema],
  [stage2('MaterialSummary'), materialSummarySchema],
  [stage2('MaterialList'), materialListSchema],
  [stage2('Material'), materialSchema],
  [stage2('MaterialCreated'), materialCreatedSchema],
  [stage2('MaterialDeleted'), materialDeletedSchema],
  [stage2('MaterialSource'), materialSourceSchema],
  [stage2('UploadTicket'), uploadTicketSchema],
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


test('인증 기능 지원 응답을 화면 계약으로 읽을 수 있다', () => {
  expect(authCapabilitiesSchema.safeParse(example('capabilities.json')).success).toBe(true)
})

test('자료 모킹 서버의 응답이 계약 스키마를 통과한다', async () => {
  const server = createMaterialsMock()
  const bodies: { method: string; path: string; status: number; body: unknown }[] = []
  const inner = server.fetchAs(server.ownerId)
  const recording: typeof fetch = async (input, init = {}) => {
    const response = await inner(input, init)
    const path = new URL(String(input), 'http://mock.local').pathname
    if (response.status !== 204 && !path.startsWith('/v1/storage/')) {
      bodies.push({ method: init.method ?? 'GET', path, status: response.status, body: await response.clone().json() })
    }
    return response
  }
  const materials = createMaterialsApi(createApiClient(recording))
  const fileId = server.seed('file', '조사.pdf')
  server.seed('link', '감축 사례', { status: 'processing' })
  // 대기 중인 분석 작업은 다음 요청 때 이 오류로 끝난다
  server.faults.failAnalysisCode = 'LINK_FETCH_FAILED'
  const memoId = server.seed('memo', '인터뷰', { markdown: '## 요약' })
  await materials.list(server.projectId, { q: '조사' })
  const file = await materials.get(fileId)
  await materials.update(fileId, file.version, { title: '조사 결과.pdf' })
  await materials.update(fileId, file.version, { title: '오래된 요청' }).catch(() => undefined)
  await materials.note(memoId)
  await materials.saveNote(memoId, 0, '함께 확인할 내용')
  await materials.saveNote(memoId, 0, '오래된 저장').catch(() => undefined)
  await materials.note(memoId)
  const failed = (await materials.list(server.projectId, { kind: 'link' })).items[0]
  const retried = await materials.reprocess(failed.id, crypto.randomUUID())
  await materials.job(retried.job!.id)
  await materials.remove(fileId, file.version + 1)
  await materials.get(fileId).catch(() => undefined)

  const schemaOf = ({ method, path, status }: (typeof bodies)[number]) => {
    if (status >= 400) return api('ErrorResponse')
    if (path.endsWith('/auth/bootstrap')) return api('AuthBootstrap')
    if (path.endsWith('/note')) return method === 'GET' ? api('MaterialNote') : api('MaterialNoteSaveResponse')
    if (path.includes('/jobs/')) return api('Job')
    if (path.endsWith('/reprocess')) return stage2('MaterialCreated')
    if (path.endsWith('/materials')) return stage2('MaterialList')
    return method === 'DELETE' ? stage2('MaterialDeleted') : stage2('Material')
  }
  const seenCodes: string[] = []
  for (const entry of bodies) {
    expect(check(schemaOf(entry), entry.body), `${entry.method} ${entry.path}`).toEqual([])
    if (entry.status < 400) continue
    const error = (entry.body as { error: { code: string; retryable: boolean } }).error
    const listed = errorCodes.codes.find((candidate) => candidate.code === error.code)
    expect(listed, error.code).toMatchObject({ httpStatus: entry.status, retryable: error.retryable })
    seenCodes.push(error.code)
  }
  expect(bodies.length).toBeGreaterThanOrEqual(12)
  expect(seenCodes).toEqual(expect.arrayContaining(['VERSION_CONFLICT', 'MATERIAL_DELETED']))
})
