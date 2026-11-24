import { z } from 'zod'
import { api } from '../../entities/session/api.ts'
import { imageElementSchema, shapeElementSchema, textElementSchema } from '../../entities/presentation/schema.ts'

const version = z.number().int().positive()
export const designColor = /^#[0-9a-f]{6}$/i
const hexColor = z.string().regex(designColor)

const templateSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1).max(64),
  version,
  name: z.string().min(1),
  preview: z.object({ backgroundColor: hexColor, headingColor: hexColor, description: z.string() }),
  fonts: z.array(z.string()),
  layouts: z.array(z.string()),
})

const catalogSchema = z.object({
  items: z.array(templateSchema),
  allowedFonts: z.array(z.string()),
  projectFontsEnabled: z.boolean().optional(),
})

const customSchema = z.object({
  name: z.string().min(1).max(80),
  font: z.string().min(1),
  primaryColor: hexColor,
  guidelines: z.string().max(2000),
  fontAssetId: z.uuid().optional(),
})

const settingsBase = z.object({ version, updatedAt: z.string() })
const settingsSchema = z.discriminatedUnion('mode', [
  settingsBase.extend({ mode: z.literal('unset'), templateId: z.null(), templateVersion: z.null(), custom: z.null() }),
  settingsBase.extend({ mode: z.literal('template'), templateId: z.string().min(1), templateVersion: version, custom: z.null() }),
  settingsBase.extend({ mode: z.literal('custom'), templateId: z.null(), templateVersion: z.null(), custom: customSchema }),
])

// 미리보기 요소는 문서 요소에서 식별자와 버전, 근거를 뺀 형식이다
const identity = { id: true, slideId: true, version: true, sourceRefs: true, deletedAt: true } as const
export const templatePreviewSchema = z.object({
  templateId: z.string().min(1),
  templateVersion: version,
  canvas: z.object({ width: z.number().positive(), height: z.number().positive(), unit: z.literal('px') }),
  slides: z.array(z.object({
    layoutId: z.string(),
    elements: z.array(z.discriminatedUnion('type', [
      textElementSchema.omit(identity), shapeElementSchema.omit(identity), imageElementSchema.omit(identity),
    ])),
  })).min(1),
})

export type DesignTemplate = z.infer<typeof templateSchema>
export type TemplatePreview = z.infer<typeof templatePreviewSchema>
export type DesignCatalog = z.infer<typeof catalogSchema>
export type DesignSettings = z.infer<typeof settingsSchema>
export type CustomDesign = z.infer<typeof customSchema>
export type TemplateSelection = { templateId: string; templateVersion: number }
export type DesignInput = { expectedVersion: number } & (
  | ({ mode: 'template' } & TemplateSelection)
  | { mode: 'custom'; custom: CustomDesign }
)

const settingsPath = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/design-settings`

export const designApi = {
  catalog: (signal?: AbortSignal) => api.request('/templates', catalogSchema, { timeoutMs: 10000, signal }),
  get: (projectId: string, signal?: AbortSignal) => api.request(settingsPath(projectId), settingsSchema, { timeoutMs: 10000, signal }),
  preview: (templateId: string, signal?: AbortSignal) =>
    api.request(`/templates/${encodeURIComponent(templateId)}/preview`, templatePreviewSchema, { timeoutMs: 10000, signal }),
  save: (projectId: string, body: DesignInput, idempotencyKey: string, signal?: AbortSignal) =>
    api.request(settingsPath(projectId), settingsSchema, { method: 'PUT', body, idempotencyKey, timeoutMs: 15000, signal }),
}
