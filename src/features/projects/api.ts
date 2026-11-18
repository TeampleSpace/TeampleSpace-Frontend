import type { ApiClient } from '../../shared/api/client.ts'
import { api } from '../auth/api.ts'
import { emptySchema } from '../auth/model.ts'
import { acceptSchema, invitationLinkSchema, invitationSchema, memberListSchema, projectListSchema, projectSchema, removalSchema } from './model.ts'
import type { ProjectInput } from './model.ts'

const segment = encodeURIComponent
export function createProjectsApi(client: ApiClient) {
  return {
    list: (q = '', cursor?: string, signal?: AbortSignal) => client.request(`/projects?${new URLSearchParams({ q, limit: '20', ...(cursor ? { cursor } : {}) })}`, projectListSchema, { timeoutMs: 10000, signal }),
    get: (id: string, signal?: AbortSignal) => client.request(`/projects/${segment(id)}`, projectSchema, { timeoutMs: 10000, signal }),
    create: (body: ProjectInput, key: string) => client.request('/projects', projectSchema, { method: 'POST', body, idempotencyKey: key, timeoutMs: 15000 }),
    update: (id: string, expectedVersion: number, body: ProjectInput) => client.request(`/projects/${segment(id)}`, projectSchema, { method: 'PATCH', body: { ...body, expectedVersion }, timeoutMs: 15000 }),
    remove: (id: string, expectedVersion: number, confirmationName: string) => client.request(`/projects/${segment(id)}`, emptySchema, { method: 'DELETE', body: { expectedVersion, confirmationName }, timeoutMs: 15000 }),
    members: (id: string, cursor?: string, signal?: AbortSignal) => client.request(`/projects/${segment(id)}/members?${new URLSearchParams({ limit: '100', ...(cursor ? { cursor } : {}) })}`, memberListSchema, { timeoutMs: 10000, signal }),
    removeMember: (id: string, userId: string, expectedMembershipVersion: number, clientMutationId: string, key: string) => client.request(`/projects/${segment(id)}/members/${segment(userId)}`, removalSchema, { method: 'DELETE', body: { expectedMembershipVersion, clientMutationId }, idempotencyKey: key, timeoutMs: 15000 }),
    invite: (id: string, rotate = false) => client.request(`/projects/${segment(id)}/invitations`, invitationLinkSchema, { method: 'POST', body: { rotate }, timeoutMs: 15000 }),
    invitation: (token: string, signal?: AbortSignal) => client.request(`/invitations/${segment(token)}`, invitationSchema, { timeoutMs: 10000, signal }),
    accept: (token: string) => client.request(`/invitations/${segment(token)}/accept`, acceptSchema, { method: 'POST', timeoutMs: 15000 }),
    transfer: (id: string, targetUserId: string, expectedVersion: number) => client.request(`/projects/${segment(id)}/ownership`, projectSchema, { method: 'POST', body: { targetUserId, expectedVersion }, timeoutMs: 15000 }),
  }
}
export const projectsApi = createProjectsApi(api)

export async function allMembers(id: string, signal?: AbortSignal) {
  const first = await projectsApi.members(id, undefined, signal)
  const items = new Map(first.items.map((item) => [item.userId, item]))
  const seen = new Set<string>()
  let cursor = first.nextCursor
  while (cursor) {
    if (seen.has(cursor)) throw new Error('팀원 목록의 다음 페이지를 확인하지 못했습니다')
    seen.add(cursor)
    const next = await projectsApi.members(id, cursor, signal)
    for (const item of next.items) items.set(item.userId, item)
    cursor = next.nextCursor
  }
  return [...items.values()]
}
