import { z } from 'zod'

// 1차 출시 기준의 공통 계약을 옮긴 형식이다
// 미확정 표시가 있는 값은 백엔드와 합의되지 않은 임시값이다

// 미확정. CSRF 토큰을 싣는 요청 헤더 이름
export const CSRF_HEADER = 'X-CSRF-Token'

// 미확정. 입력 오류 한 건의 형식
export const fieldErrorSchema = z.looseObject({
  field: z.string().optional(),
  message: z.string().optional(),
})
export type FieldError = z.infer<typeof fieldErrorSchema>

// 공통 오류 응답
export const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
    fieldErrors: z.array(fieldErrorSchema).optional(),
    currentVersions: z.record(z.string(), z.number()).optional(),
  }),
  requestId: z.string(),
})
export type ErrorBody = z.infer<typeof errorBodySchema>

// 세션 컨텍스트. 인증 여부를 담는 필드 이름은 미확정
export const sessionBootstrapSchema = z.looseObject({
  state: z.enum(['anonymous', 'authenticated']),
  csrfToken: z.string(),
  expiresAt: z.string(),
})
export type SessionBootstrap = z.infer<typeof sessionBootstrapSchema>

// 전역 지원값. 필드 이름은 계약을 따르고 값 형식은 미확정
export const capabilitiesSchema = z.looseObject({
  configVersion: z.union([z.string(), z.number()]),
  formats: z.array(z.string()),
  fonts: z.array(z.string()),
  featureFlags: z.record(z.string(), z.boolean()),
  legalDocuments: z.array(
    z.object({ type: z.string(), version: z.string(), url: z.string() }),
  ),
  idempotencyRetentionSeconds: z.number(),
})
export type Capabilities = z.infer<typeof capabilitiesSchema>

// 실시간 이벤트 공통 필드
export const eventEnvelopeSchema = z.object({
  eventId: z.string(),
  projectId: z.string(),
  type: z.string(),
  actorId: z.string().optional(),
  clientMutationId: z.string().optional(),
  occurredAt: z.string(),
  resourceId: z.string().optional(),
  resourceVersion: z.number().optional(),
  presentationVersion: z.number().optional(),
  generation: z.number().optional(),
  payload: z.unknown(),
})
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>
