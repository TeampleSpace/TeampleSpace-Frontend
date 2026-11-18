import { z } from 'zod'

// 백엔드 저장소의 공통 계약을 옮긴 형식이다
// 기준은 contracts/schemas/api.schema.json이며 형식을 따로 만들지 않는다
// 계약 예제가 이 형식을 통과하는지는 contracts.test.ts에서 확인한다

// GET이 아닌 모든 요청에 세션 초기 정보의 csrfToken을 싣는 헤더
export const CSRF_HEADER = 'X-CSRF-Token'

// 모든 응답에 오는 요청 식별자 헤더. 오류 본문의 requestId와 같은 값이다
export const REQUEST_ID_HEADER = 'X-Request-Id'

const version = z.number().int().min(1)

export const fieldErrorSchema = z.object({
  field: z.string(),
  code: z.string(),
  message: z.string(),
})
export type FieldError = z.infer<typeof fieldErrorSchema>

// 충돌 때 서버가 알려 주는 현재 버전. 범위가 다른 값끼리는 비교하지 않는다
export const currentVersionsSchema = z.object({
  userVersion: version.optional(),
  projectVersion: version.optional(),
  membershipVersion: version.optional(),
  materialVersion: version.optional(),
  outlineVersion: version.optional(),
  designVersion: version.optional(),
  generation: version.optional(),
  presentationVersion: version.optional(),
  orderVersion: version.optional(),
  slideVersion: version.optional(),
  elementVersion: version.optional(),
  elementVersions: z.record(z.string(), version).optional(),
})
export type CurrentVersions = z.infer<typeof currentVersionsSchema>

// 공통 오류 응답
export const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
    fieldErrors: z.array(fieldErrorSchema).optional(),
    currentVersions: currentVersionsSchema.optional(),
  }),
  requestId: z.string(),
})
export type ErrorBody = z.infer<typeof errorBodySchema>

// 세션 초기 정보. 로그인한 경우에만 user가 온다
export const sessionBootstrapSchema = z.object({
  status: z.enum(['anonymous', 'authenticated']),
  csrfToken: z.string().min(1),
  expiresAt: z.string(),
  user: z
    .object({
      id: z.string(),
      displayName: z.string(),
      onboardingStatus: z.string(),
      version,
    })
    .optional(),
})
export type SessionBootstrap = z.infer<typeof sessionBootstrapSchema>

// 비밀값 없는 전역 지원 정보
export const capabilitiesSchema = z.object({
  configVersion: z.string(),
  policyRevision: z.string(),
  uploadTypes: z.array(
    z.object({ kind: z.string(), mimeType: z.string(), maxBytes: z.number().int() }),
  ),
  formats: z.array(z.enum(['pptx', 'pdf'])),
  fonts: z.array(z.string()),
  featureFlags: z.record(z.string(), z.boolean()),
  legalDocuments: z.array(
    z.object({ type: z.string(), version: z.string(), url: z.string() }),
  ),
  idempotencyRetentionSeconds: z.number().int(),
  listLimit: z.object({ default: z.number().int(), max: z.number().int() }),
})
export type Capabilities = z.infer<typeof capabilitiesSchema>

// 실시간 이벤트 봉투. 이벤트 스트림의 id는 eventId, event는 type이다
export const eventEnvelopeSchema = z.object({
  eventId: z.string(),
  projectId: z.string(),
  type: z.string(),
  actorId: z.string().nullable().optional(),
  clientMutationId: z.string().optional(),
  occurredAt: z.string(),
  resourceId: z.string().optional(),
  resourceVersion: version.optional(),
  presentationVersion: version.optional(),
  generation: version.optional(),
  payload: z.record(z.string(), z.unknown()),
})
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>
