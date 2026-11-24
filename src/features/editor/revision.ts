import { z } from 'zod'
import { api } from '../../entities/session/api.ts'
import { jobSchema } from '../../entities/material/model.ts'
import { elementSaveResultSchema } from '../../entities/presentation/schema.ts'

// 작업 결과에 담긴 수정 제안. 제안 식별자는 작업 식별자다
export const revisionResultSchema = z.object({
  type: z.literal('slide_revision'),
  slideId: z.string(),
  generation: z.number().int().positive(),
  targets: z.array(z.object({
    elementId: z.string(),
    baseVersion: z.number().int().positive(),
    before: z.string(),
    after: z.string(),
  })).min(1),
})
export type RevisionResult = z.infer<typeof revisionResultSchema>

const appliedSchema = z.object({ proposalId: z.string(), changes: z.array(elementSaveResultSchema).min(1) })

export const revisionApi = {
  create: (slideId: string, body: { generation: number; prompt: string }, key: string) =>
    api.request(`/slides/${encodeURIComponent(slideId)}/ai-revision-jobs`, jobSchema, {
      method: 'POST', body, idempotencyKey: key, timeoutMs: 15000,
    }),
  apply: (proposalId: string, key: string) =>
    api.request(`/ai-proposals/${encodeURIComponent(proposalId)}/apply`, appliedSchema, {
      method: 'POST', body: {}, idempotencyKey: key, timeoutMs: 15000,
    }),
}
