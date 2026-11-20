import { z } from 'zod'
import { api } from '../auth/api.ts'

const version = z.number().int().positive()
export const designColor = /^#[0-9a-f]{6}$/i
const hexColor = z.string().regex(designColor)

const templateSchema = z.object({
  id: z.string().min(1),
  version,
  name: z.string().min(1),
  preview: z.object({ backgroundColor: hexColor, headingColor: hexColor, description: z.string() }),
  fonts: z.array(z.string()),
  layouts: z.array(z.string()),
})

const catalogSchema = z.object({
  items: z.array(templateSchema),
  allowedFonts: z.array(z.string()),
})

const customSchema = z.object({
  name: z.string().min(1).max(80),
  font: z.string().min(1),
  primaryColor: hexColor,
  guidelines: z.string().max(2000),
})

const settingsBase = z.object({ version, updatedAt: z.string() })
const settingsSchema = z.discriminatedUnion('mode', [
  settingsBase.extend({ mode: z.literal('unset'), templateId: z.null(), templateVersion: z.null(), custom: z.null() }),
  settingsBase.extend({ mode: z.literal('template'), templateId: z.string().min(1), templateVersion: version, custom: z.null() }),
  settingsBase.extend({ mode: z.literal('custom'), templateId: z.null(), templateVersion: z.null(), custom: customSchema }),
])

export type DesignTemplate = z.infer<typeof templateSchema>
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
  save: (projectId: string, body: DesignInput, idempotencyKey: string, signal?: AbortSignal) =>
    api.request(settingsPath(projectId), settingsSchema, { method: 'PUT', body, idempotencyKey, timeoutMs: 15000, signal }),
}
