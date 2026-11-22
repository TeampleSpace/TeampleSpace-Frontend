import { z } from 'zod'
import { api } from '../../entities/session/api.ts'
import { jobSchema } from '../../entities/material/model.ts'
import type { Job } from '../../entities/material/model.ts'

const jobPage = z.object({ items: z.array(jobSchema), nextCursor: z.string().nullable() })
export const presentationResultSchema = z.object({
  type: z.literal('presentation'),
  projectId: z.string(),
  presentationId: z.string(),
  presentationVersion: z.number().int().positive(),
})

export type GenerationRequest = { outlineVersion: number; designVersion: number; sourceIds: string[] }

const projectPath = (projectId: string) => `/projects/${encodeURIComponent(projectId)}`

export const presentationGenerationApi = {
  create: (projectId: string, body: GenerationRequest, key: string) =>
    api.request(`${projectPath(projectId)}/presentation-jobs`, jobSchema, {
      method: 'POST', body, idempotencyKey: key, timeoutMs: 15000,
    }),
  latest: async (projectId: string, signal?: AbortSignal): Promise<Job | undefined> => {
    const params = new URLSearchParams({ type: 'presentation_generation', limit: '1' })
    const { items } = await api.request(`${projectPath(projectId)}/jobs?${params}`, jobPage, { timeoutMs: 10000, signal })
    return items[0]
  },
}
