import { ApiError, TransportError } from '../../shared/api/client.ts'
import type { ApiClient } from '../../shared/api/client.ts'
import { errorBodySchema } from '../../shared/api/contract.ts'
import { api } from '../auth/api.ts'
import {
  jobSchema, materialCreatedSchema, materialDeletedSchema, materialListSchema, materialNoteSavedSchema,
  materialNoteSchema, materialSchema, materialSourceSchema, uploadTicketSchema,
} from './model.ts'
import type { MaterialKind, MaterialSummary, UploadTicket } from './model.ts'

const segment = encodeURIComponent
export type MaterialQuery = { q?: string; kind?: MaterialKind | ''; status?: MaterialSummary['status']; cursor?: string; limit?: number }

export function createMaterialsApi(client: ApiClient, fetchImpl: typeof fetch = (input, init) => fetch(input, init)) {
  const created = (path: string, body: unknown, key: string) =>
    client.request(path, materialCreatedSchema, { method: 'POST', body, idempotencyKey: key, timeoutMs: 20000 })
  return {
    list: (projectId: string, query: MaterialQuery = {}, signal?: AbortSignal) => {
      const params = new URLSearchParams({ limit: String(query.limit ?? 30) })
      if (query.q) params.set('q', query.q)
      if (query.kind) params.set('kind', query.kind)
      if (query.status) params.set('status', query.status)
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
    // 한 개정의 원문. 개정을 주지 않으면 현재 개정이다
    source: (id: string, revisionId?: string, signal?: AbortSignal) =>
      client.request(`/materials/${segment(id)}/source${revisionId ? `?${new URLSearchParams({ revisionId })}` : ''}`, materialSourceSchema, { timeoutMs: 10000, signal }),
    prepareUpload: (projectId: string, body: { fileName: string; mimeType: string; sizeBytes: number; checksumSha256: string }, signal?: AbortSignal) =>
      client.request(`/projects/${segment(projectId)}/uploads`, uploadTicketSchema, { method: 'POST', body: { kind: 'material_pdf', ...body }, timeoutMs: 15000, signal }),
    // 파일 전송에는 발급받은 헤더만 싣는다. CSRF 헤더는 싣지 않는다
    sendFile: async (ticket: UploadTicket, file: Blob, signal?: AbortSignal) => {
      let response: Response
      try {
        response = await fetchImpl(ticket.uploadUrl, { method: ticket.uploadMethod, headers: ticket.uploadHeaders, body: file, signal })
      } catch (cause) {
        if (signal?.aborted) throw cause
        throw new TransportError('network', { cause })
      }
      if (response.ok) return
      const error = errorBodySchema.safeParse(await response.json().catch(() => undefined))
      if (error.success) throw new ApiError(response.status, error.data)
      throw new TransportError('invalid_response', { status: response.status })
    },
    // 등록 요청은 응답을 받지 못하면 같은 키와 본문으로 다시 보낸다
    createFile: (projectId: string, body: { uploadId: string; title?: string }, key: string) => created(`/projects/${segment(projectId)}/materials/file`, body, key),
    createLink: (projectId: string, body: { url: string; title?: string; description?: string }, key: string) => created(`/projects/${segment(projectId)}/materials/link`, body, key),
    createMemo: (projectId: string, body: { title: string; markdown: string }, key: string) => created(`/projects/${segment(projectId)}/materials/memo`, body, key),
    cancelJob: (id: string) => client.request(`/jobs/${segment(id)}/cancel`, jobSchema, { method: 'POST', timeoutMs: 15000 }),
  }
}
export type MaterialsApi = ReturnType<typeof createMaterialsApi>
export const materialsApi = createMaterialsApi(api)
