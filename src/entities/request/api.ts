import { useEffect, useEffectEvent } from 'react'
import { z } from 'zod'
import { api } from '../session/api.ts'
import { projectsApi } from '../project/api.ts'

const person = z.object({ userId: z.string(), name: z.string() })
export const changeRequestTypes = ['outline_generation', 'presentation_generation', 'design_change'] as const
export type ChangeRequestType = typeof changeRequestTypes[number]
export const changeRequestSchema = z.object({
  id: z.string(), projectId: z.string(), type: z.enum(changeRequestTypes),
  state: z.enum(['pending', 'approved', 'failed', 'rejected', 'canceled']),
  payload: z.record(z.string(), z.unknown()),
  requestedBy: person, decidedBy: person.nullable(),
  result: z.union([z.object({ jobId: z.string() }), z.object({ designVersion: z.number().int() })]).nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdAt: z.string(), decidedAt: z.string().nullable(),
})
export const changeRequestListSchema = z.object({ items: z.array(changeRequestSchema) })
export type ChangeRequest = z.infer<typeof changeRequestSchema>

export const changeRequestLabels: Record<ChangeRequestType, string> = {
  outline_generation: 'AI 구성 만들기', presentation_generation: 'PPT 만들기', design_change: '디자인 변경',
}

const segment = encodeURIComponent
// 요청을 만들면 승인 요청 표시가 바로 다시 읽는다
export const createdEvent = 'teamplespace:request-created'
const decide = (id: string, action: 'approve' | 'reject' | 'cancel') =>
  api.request(`/requests/${segment(id)}/${action}`, changeRequestSchema, { method: 'POST', timeoutMs: 30000 })
export const requestsApi = {
  list: (projectId: string, signal?: AbortSignal) =>
    api.request(`/projects/${segment(projectId)}/requests`, changeRequestListSchema, { timeoutMs: 10000, signal }),
  create: async (projectId: string, type: ChangeRequestType, payload: object, key: string) => {
    const created = await api.request(`/projects/${segment(projectId)}/requests`, changeRequestSchema, { method: 'POST', body: { type, payload }, idempotencyKey: key, timeoutMs: 15000 })
    window.dispatchEvent(new Event(createdEvent))
    return created
  },
  approve: (id: string) => decide(id, 'approve'),
  reject: (id: string) => decide(id, 'reject'),
  cancel: (id: string) => decide(id, 'cancel'),
}

// 팀원이 둘 이상이면 바로 실행하지 않고 다른 팀원의 승인을 받는다. 팀원 수는 누를 때마다 새로 읽는다
export async function needsApproval(projectId: string) {
  return (await projectsApi.get(projectId)).memberCount > 1
}

// 승인이나 거절로 처리된 요청을 같은 프로젝트의 화면에 알린다
const decidedEvent = 'teamplespace:request-decided'
export function announceDecided(request: ChangeRequest) {
  window.dispatchEvent(new CustomEvent<ChangeRequest>(decidedEvent, { detail: request }))
}
export function useRequestApproved(projectId: string, type: ChangeRequestType, handler: (request: ChangeRequest) => void) {
  const onApproved = useEffectEvent(handler)
  useEffect(() => {
    const listener = (event: Event) => {
      const request = (event as CustomEvent<ChangeRequest>).detail
      if (request.state === 'approved' && request.type === type && request.projectId.toLowerCase() === projectId.toLowerCase()) onApproved(request)
    }
    window.addEventListener(decidedEvent, listener)
    return () => window.removeEventListener(decidedEvent, listener)
  }, [projectId, type])
}
