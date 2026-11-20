import type { ApiClient } from '../../shared/api/client.ts'
import { api } from '../../entities/session/api.ts'
import { outlineSchema } from './model.ts'
import type { OutlineInput } from './model.ts'

const outlinePath = (id: string) => `/projects/${encodeURIComponent(id)}/outline`

export function createOutlineApi(client: ApiClient) {
  return {
    get: (projectId: string, signal?: AbortSignal) =>
      client.request(outlinePath(projectId), outlineSchema, { timeoutMs: 10000, signal }),
    save: (projectId: string, body: OutlineInput, key: string) =>
      client.request(outlinePath(projectId), outlineSchema, { method: 'PUT', body, idempotencyKey: key, timeoutMs: 15000 }),
    saveSources: (itemId: string, body: { expectedVersion: number; sourceIds: string[] }, key: string) =>
      client.request(`/outline-items/${encodeURIComponent(itemId)}/sources`, outlineSchema, { method: 'PUT', body, idempotencyKey: key, timeoutMs: 15000 }),
  }
}

export const outlineApi = createOutlineApi(api)
