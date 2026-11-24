import type { Element, Slide } from '../../../entities/presentation/schema.ts'

type Bounds = [x: number, y: number, width: number, height: number]
type Position = Omit<Element['geometry'], 'z'>
type PreviewElement =
  | { type: 'text'; geometry: Position; content: Extract<Element, { type: 'text' }>['content']; style: Extract<Element, { type: 'text' }>['style'] }
  | { type: 'shape'; geometry: Position; content: Extract<Element, { type: 'shape' }>['content']; style: Extract<Element, { type: 'shape' }>['style'] }
  | { type: 'image'; geometry: Position; content: Extract<Element, { type: 'image' }>['content']; style: Extract<Element, { type: 'image' }>['style'] }

function position([x, y, width, height]: Bounds, rotation: number): Position {
  return { x, y, width, height, rotation }
}

export function text(bounds: Bounds, value: string, fontFamily: string, fontWeight: number, fontSize: number,
  color: string, align: 'left' | 'center' | 'right', lineHeight: number, rotation: number): PreviewElement {
  return { type: 'text', geometry: position(bounds, rotation), content: { text: value },
    style: { fontFamily, fontSize, fontWeight, color, align, lineHeight } }
}

export function shape(bounds: Bounds, shape: 'rect' | 'ellipse', fill: string | null, stroke: string | null,
  strokeWidth: number, cornerRadius: number, rotation: number): PreviewElement {
  return { type: 'shape', geometry: position(bounds, rotation), content: { shape },
    style: { fill, stroke, strokeWidth, cornerRadius } }
}

export function image(bounds: Bounds, filename: string, rotation: number): PreviewElement {
  return { type: 'image', geometry: position(bounds, rotation),
    content: { fileObjectId: filename, assetUrl: `/assets/design/templates/${filename}`, alt: '' }, style: {} }
}

export function slide(id: string, label: string, preview: PreviewElement[]): { label: string; document: Slide } {
  const elements = preview.map(({ geometry, ...element }, z) => ({
    ...element,
    id: `${id}-${z}`,
    slideId: id,
    version: 1,
    sourceRefs: [],
    geometry: { ...geometry, z },
  }))
  return { label, document: { id, presentationId: 'template-preview', generation: 1, version: 1,
    elementIds: elements.map((element) => element.id), elements } }
}
