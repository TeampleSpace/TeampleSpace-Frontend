import { z } from 'zod'

const version = z.number().int().positive()

export const outlineSourceSchema = z.object({
  materialId: z.string(),
  revisionId: z.string(),
  sourceVersion: version,
  sourceDeleted: z.boolean(),
})

const outlineItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  position: z.number().int().nonnegative(),
  sourceRefs: z.array(outlineSourceSchema),
})

export const outlineSchema = z.object({
  projectId: z.string(),
  version,
  items: z.array(outlineItemSchema),
})

export type OutlineSource = z.infer<typeof outlineSourceSchema>
export type OutlineItem = z.infer<typeof outlineItemSchema>
export type Outline = z.infer<typeof outlineSchema>
export type OutlineItemInput = { id?: string; title: string; summary: string; sourceIds: string[] }
export type OutlineInput = { expectedVersion: number; items: OutlineItemInput[] }
export type OutlineFields = { title: string; claim: string; content: string }

export const outlineLimits = { items: 100, title: 255, summary: 10000, sources: 20 }

const claimHeader = '핵심 주장\n'
const contentHeader = '\n\n발표 내용\n'

// 기존 요약과 AI 결과는 발표 내용에 표시한다
export function readOutlineSummary(summary: string): Omit<OutlineFields, 'title'> {
  if (!summary.startsWith(claimHeader)) return { claim: '', content: summary }
  const separator = summary.indexOf(contentHeader, claimHeader.length)
  if (separator < 0) return { claim: '', content: summary }
  const claim = summary.slice(claimHeader.length, separator)
  if (claim.includes('\n')) return { claim: '', content: summary }
  return { claim, content: summary.slice(separator + contentHeader.length) }
}

export function writeOutlineSummary(claim: string, content: string) {
  return claim || content.startsWith(claimHeader) ? `${claimHeader}${claim}${contentHeader}${content}` : content
}

export function fieldsOf(item?: OutlineItem): OutlineFields {
  return { title: item?.title ?? '', ...readOutlineSummary(item?.summary ?? '') }
}

export function outlineItemInput(item: OutlineItem): OutlineItemInput {
  return { id: item.id, title: item.title, summary: item.summary, sourceIds: item.sourceRefs.filter((source) => !source.sourceDeleted).map((source) => source.materialId) }
}

export function validateOutlineFields(fields: OutlineFields) {
  const title = fields.title.trim()
  const summary = writeOutlineSummary(fields.claim.trim(), fields.content)
  const titleError = !title ? '슬라이드 제목을 입력해 주세요' : undefined
  const summaryError = Array.from(summary).length > outlineLimits.summary ? '핵심 주장과 발표 내용을 합쳐 10000자까지 입력할 수 있어요' : undefined
  return { title, summary, titleError, summaryError }
}
