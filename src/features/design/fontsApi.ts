import { z } from 'zod'
import { ApiError, TransportError } from '../../shared/api/client.ts'
import { errorBodySchema } from '../../shared/api/contract.ts'
import { api } from '../../entities/session/api.ts'

const fontLimit = 5 * 1024 * 1024
const fontSchema = z.object({
  id: z.uuid(),
  fileName: z.string().min(1),
  format: z.enum(['ttf', 'otf']),
  sizeBytes: z.number().int().positive().max(fontLimit),
  contentUrl: z.string(),
})
const fontListSchema = z.object({ items: z.array(fontSchema) })
export type ProjectFont = z.infer<typeof fontSchema>

function pathFor(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}/design-fonts`
}

export const fontsApi = {
  list: (projectId: string, signal?: AbortSignal) =>
    api.request(pathFor(projectId), fontListSchema, { timeoutMs: 10000, signal }),
  upload: (projectId: string, file: File, signal?: AbortSignal) =>
    api.request(`${pathFor(projectId)}?${new URLSearchParams({ fileName: file.name })}`, fontSchema, {
      method: 'POST', binaryBody: file, timeoutMs: 20000, signal,
    }),
  async content(projectId: string, font: ProjectFont, signal: AbortSignal) {
    const path = `/v1${pathFor(projectId)}/${encodeURIComponent(font.id)}/content`
    if (font.contentUrl !== path) throw new TransportError('invalid_response')
    const response = await fetch(path, { credentials: 'same-origin', redirect: 'error', signal })
    if (!response.ok) {
      const error = errorBodySchema.safeParse(await response.json().catch(() => undefined))
      if (error.success) throw new ApiError(response.status, error.data)
      throw new TransportError('invalid_response', { status: response.status })
    }
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength !== font.sizeBytes) throw new TransportError('invalid_response')
    return bytes
  },
}

export function validateFontFile(file: File) {
  if (!/\.(ttf|otf)$/i.test(file.name)) return 'TTF 또는 OTF 파일을 선택해 주세요.'
  if (!file.size) return '비어 있는 글꼴 파일입니다.'
  if (file.size > fontLimit) return '글꼴 파일은 5MB까지 올릴 수 있어요.'
}
