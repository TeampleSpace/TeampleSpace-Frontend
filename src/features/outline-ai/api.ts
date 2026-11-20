import { z } from 'zod'
import { api } from '../auth/api.ts'
import { jobSchema } from '../materials/model.ts'
import type { Job } from '../materials/model.ts'

const jobPage = z.object({ items: z.array(jobSchema), nextCursor: z.string().nullable() })
export const outlineResultSchema = z.object({
  type: z.literal('outline'),
  projectId: z.string(),
  outlineVersion: z.number().int().positive(),
})

export type GenerationInput = { expectedVersion: number; sourceIds: string[]; instructions?: string }

export const outlineGenerationApi = {
  create: (projectId: string, body: GenerationInput, key: string) =>
    api.request(`/projects/${encodeURIComponent(projectId)}/outline-jobs`, jobSchema, {
      method: 'POST', body, idempotencyKey: key, timeoutMs: 15000,
    }),
  latest: async (projectId: string, signal?: AbortSignal): Promise<Job | undefined> => {
    const params = new URLSearchParams({ type: 'outline_generation', limit: '1' })
    const { items } = await api.request(`/projects/${encodeURIComponent(projectId)}/jobs?${params}`, jobPage, {
      timeoutMs: 10000, signal,
    })
    return items[0]
  },
}
