import { z } from 'zod'

// 백엔드 계약의 자료, 원문, 팀 메모, 작업 형식을 옮긴 것이다
// 기준은 contracts/schemas/stage-2.schema.json과 api.schema.json이며 형식을 따로 만들지 않는다

const version = z.number().int().min(1)
export const materialKindSchema = z.enum(['file', 'link', 'memo'])
export type MaterialKind = z.infer<typeof materialKindSchema>
export const materialStatusSchema = z.enum(['processing', 'ready', 'failed'])
const personSchema = z.object({ userId: z.string(), name: z.string() })
const pageCount = z.number().int().min(1).nullable()

export const jobSchema = z.object({
  id: z.string(), projectId: z.string().optional(), type: z.string(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'canceled']),
  progress: z.number().int().min(0).max(100),
  targetType: z.string().optional(), targetId: z.string().optional(), attempt: z.number().int().min(0).optional(),
  inputVersions: z.record(z.string(), z.unknown()).optional(),
  resultRef: z.record(z.string(), z.unknown()).nullable().optional(),
  error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean().optional() }).nullable().optional(),
  cancelRequestedAt: z.string().nullable().optional(),
  createdAt: z.string(), updatedAt: z.string(), finishedAt: z.string().nullable().optional(),
})
export type Job = z.infer<typeof jobSchema>

const summaryFields = {
  id: z.string(), projectId: z.string(), kind: materialKindSchema, title: z.string(), status: materialStatusSchema,
  version, pageCount, createdBy: personSchema, createdAt: z.string(), updatedAt: z.string(),
}
export const materialSummarySchema = z.object(summaryFields)
export type MaterialSummary = z.infer<typeof materialSummarySchema>
export const materialListSchema = z.object({
  items: z.array(materialSummarySchema), nextCursor: z.string().nullable(),
  counts: z.object({ all: z.number().int(), file: z.number().int(), link: z.number().int(), memo: z.number().int() }),
})
export type MaterialList = z.infer<typeof materialListSchema>

export const materialRevisionSchema = z.object({
  id: z.string(), sourceVersion: version, pageCount, summary: z.string().nullable(),
  excerpt: z.object({ text: z.string(), page: z.number().int().min(1).nullable() }).nullable(),
  createdBy: personSchema, createdAt: z.string(),
})
export const materialSchema = z.object({
  ...summaryFields,
  description: z.string().nullable(),
  source: z.object({
    fileName: z.string().nullable(), mimeType: z.string().nullable(),
    sizeBytes: z.number().int().nullable(), url: z.string().nullable(),
  }),
  currentRevision: materialRevisionSchema.nullable(),
  job: jobSchema.nullable(),
  canDelete: z.boolean(),
})
export type Material = z.infer<typeof materialSchema>
export const materialCreatedSchema = z.object({ material: materialSchema, job: jobSchema.nullable() })
export const materialDeletedSchema = z.object({
  tombstone: z.object({ resourceType: z.literal('material'), id: z.string(), version, deletedAt: z.string() }),
  eventId: z.string(),
})

export const uploadTicketSchema = z.object({
  uploadId: z.string(), uploadUrl: z.string().min(1), uploadMethod: z.literal('PUT'),
  uploadHeaders: z.record(z.string(), z.string()), expiresAt: z.string(),
})
export type UploadTicket = z.infer<typeof uploadTicketSchema>

export const materialSourceSchema = z.object({
  materialId: z.string(), revisionId: z.string(), sourceVersion: version, kind: materialKindSchema, title: z.string(),
  file: z.object({
    url: z.string().min(1), expiresAt: z.string(), mimeType: z.string(), fileName: z.string(),
    sizeBytes: z.number().int().min(1), pageCount: z.number().int().min(1),
  }).nullable(),
  markdown: z.string().nullable(),
  link: z.object({ url: z.string(), title: z.string().nullable(), text: z.string() }).nullable(),
})
export type MaterialSource = z.infer<typeof materialSourceSchema>

export const materialNoteSchema = z.object({
  materialId: z.string(), markdown: z.string(), version: z.number().int().min(0),
  updatedBy: z.string().nullable(), updatedByName: z.string().nullable(), updatedAt: z.string().nullable(),
})
export type MaterialNote = z.infer<typeof materialNoteSchema>
export const materialNoteSavedSchema = z.object({ materialId: z.string(), version, eventId: z.string() })

// 계약이 정한 입력 길이
export const limits = { title: 255, description: 2000, markdown: 100000, note: 20000, url: 2048 }

export const kindLabels: Record<MaterialKind, string> = { file: 'PDF', link: '링크', memo: '메모' }
export const statusLabels: Record<MaterialSummary['status'], string> = {
  processing: '처리 중', ready: '분석 완료', failed: '분석 실패',
}

// 목록과 상세의 유형 줄. PDF는 실제 쪽수를 함께 보여 준다
export function kindLine(item: Pick<MaterialSummary, 'kind' | 'pageCount'>) {
  return item.pageCount ? `${kindLabels[item.kind]} · ${item.pageCount}쪽` : kindLabels[item.kind]
}

// 오늘과 어제는 시각으로, 그 밖은 날짜로 적는다
export function formatWhen(value: string, now = new Date()) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const day = (target: Date) => new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime()
  const diff = Math.round((day(now) - day(date)) / 86400000)
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  if (diff === 0) return `오늘 ${time}`
  if (diff === 1) return `어제 ${time}`
  return `${date.getFullYear() === now.getFullYear() ? '' : `${date.getFullYear()}년 `}${date.getMonth() + 1}월 ${date.getDate()}일`
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// 링크 주소는 서버에 보내기 전에 형식만 확인한다. 허용 여부는 서버가 정한다
export function normalizeUrl(value: string): string | null {
  const text = value.trim()
  if (!text || text.length > limits.url) return null
  try {
    const url = new URL(text)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null
    return url.toString()
  } catch { return null }
}

// 분석 작업의 실패 코드별 안내. 계약의 오류 코드 목록에서 HTTP 상태가 없는 항목이다
export const jobErrorMessages: Record<string, string> = {
  ANALYSIS_FAILED: '분석 중 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요',
  MATERIAL_UNREADABLE: '파일을 읽을 수 없어요. 손상됐거나 암호가 걸린 PDF인지 확인해 주세요',
  LINK_FETCH_FAILED: '링크의 문서를 가져오지 못했어요. 주소에 접속되는지 확인해 주세요',
  LINK_BLOCKED: '이 주소의 문서는 가져올 수 없어요',
  LINK_UNSUPPORTED_CONTENT: '글로 읽을 수 없는 형식의 링크예요',
  LINK_TOO_LARGE: '문서가 너무 커서 가져오지 못했어요',
  JOB_ATTEMPTS_EXHAUSTED: '분석을 끝내지 못했어요. 다시 시도해 주세요',
  JOB_TARGET_GONE: '자료가 삭제되어 분석을 멈췄어요',
}
