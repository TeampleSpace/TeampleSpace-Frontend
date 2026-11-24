import { burgundyEditorial } from './studio/burgundy-editorial.ts'
import { fieldNotes } from './studio/field-notes.ts'
import { openCampus } from './studio/open-campus.ts'
import { techPitch } from './studio/tech-pitch.ts'

const previews = new Map([
  ['burgundy-editorial', burgundyEditorial],
  ['tech-pitch', techPitch],
  ['open-campus', openCampus],
  ['field-notes', fieldNotes],
])

export function studioPreview(templateKey: string) {
  return previews.get(templateKey)
}
