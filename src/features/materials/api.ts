import type { ApiClient } from '../../shared/api/client.ts'
import { api } from '../auth/api.ts'
import {
  jobSchema, materialCreatedSchema, materialDeletedSchema, materialListSchema, materialNoteSavedSchema,
  materialNoteSchema, materialSchema,
} from './model.ts'
import type { MaterialKind } from './model.ts'

const segment = encodeURIComponent
export type MaterialQuery = { q?: string; kind?: MaterialKind | ''; cursor?: string }

export function createMaterialsApi(client: ApiClient) {
  return {
    list: (projectId: string, query: MaterialQuery = {}, signal?: AbortSignal) => {
      const params = new URLSearchParams({ limit: '30' })
      if (query.q) params.set('q', query.q)
      if (query.kind) params.set('kind', query.kind)
      if (query.cursor) params.set('cursor', query.cursor)
      return client.request(`/projects/${segment(projectId)}/materials?${params}`, materialListSchema, { timeoutMs: 10000, signal })
    },
    get: (id: string, signal?: AbortSignal) => client.request(`/materials/${segment(id)}`, materialSchema, { timeoutMs: 10000, signal }),
    // 이름, 설명, 마크다운 본문 가운데 보낸 항목만 바꾼다
    update: (id: string, expectedVersion: number, body: { title?: string; description?: string; markdown?: string }) =>
      client.request(`/materials/${segment(id)}`, materialSchema, { method: 'PATCH', body: { ...body, expectedVersion }, timeoutMs: 15000 }),
    remove: (id: string, expectedVersion: number) =>
      client.request(`/materials/${segment(id)}`, materialDeletedSchema, { method: 'DELETE', body: { expectedVersion }, timeoutMs: 15000 }),
    // 보관한 원본으로 분석만 다시 한다. 재시도할 때 같은 키를 다시 보낸다
    reprocess: (id: string, key: string) =>
      client.request(`/materials/${segment(id)}/reprocess`, materialCreatedSchema, { method: 'POST', idempotencyKey: key, timeoutMs: 15000 }),
    note: (id: string, signal?: AbortSignal) => client.request(`/materials/${segment(id)}/note`, materialNoteSchema, { timeoutMs: 10000, signal }),
    saveNote: (id: string, expectedVersion: number, markdown: string) =>
      client.request(`/materials/${segment(id)}/note`, materialNoteSavedSchema, { method: 'PUT', body: { expectedVersion, markdown }, timeoutMs: 15000 }),
    job: (id: string, signal?: AbortSignal) => client.request(`/jobs/${segment(id)}`, jobSchema, { timeoutMs: 10000, signal }),
  }
}
export type MaterialsApi = ReturnType<typeof createMaterialsApi>
export const materialsApi = createMaterialsApi(api)
