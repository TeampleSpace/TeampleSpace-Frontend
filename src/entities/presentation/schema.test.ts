import { expect, test } from 'vitest'
import example from './example.json'
import { presentationSchema } from './schema.ts'

test('예제 문서가 문서 형식 검사를 통과한다', () => {
  const doc = presentationSchema.parse(example)
  const slide = doc.slides[doc.slideIds[0]]
  const types = slide.elementIds.map((id) => slide.elements[id].type)

  // 비교 실험에 필요한 요소가 모두 들어 있는지 확인한다
  expect(new Set(types)).toEqual(new Set(['text', 'shape', 'image']))
  expect(JSON.stringify(example)).toContain('\\n')
  expect(Object.values(slide.elements).some((el) => el.sourceRefs.length > 0)).toBe(true)
})

test('순서 목록과 본문이 어긋난 문서는 거절한다', () => {
  const broken = structuredClone(example)
  broken.slideIds.push('없는-슬라이드')
  expect(presentationSchema.safeParse(broken).success).toBe(false)
})

test('허용하지 않는 요소 종류는 거절한다', () => {
  const broken = structuredClone(example) as { slides: Record<string, { elements: Record<string, { type: string }> }> }
  const slide = Object.values(broken.slides)[0]
  Object.values(slide.elements)[0].type = 'video'
  expect(presentationSchema.safeParse(broken).success).toBe(false)
})
