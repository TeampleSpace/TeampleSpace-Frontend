import { expect, test } from 'vitest'
import example from '../../../contracts/examples/presentation.json'
import { presentationSchema } from './schema.ts'

test('계약의 예제 문서가 문서 형식 검사를 통과한다', () => {
  const doc = presentationSchema.parse(example)
  const elements = doc.slides.flatMap((slide) => slide.elements)

  // 편집 실험과 파일 출력 실험에 필요한 요소가 모두 들어 있는지 확인한다
  expect(new Set(elements.map((element) => element.type))).toEqual(
    new Set(['text', 'shape', 'image']),
  )
  expect(JSON.stringify(example)).toContain('\\n')
  expect(elements.some((element) => element.sourceRefs.length > 0)).toBe(true)
  expect(elements.some((element) => element.geometry.rotation !== 0)).toBe(true)
})

test('순서 목록과 본문이 어긋난 문서는 거절한다', () => {
  const broken = structuredClone(example)
  broken.slideIds.reverse()
  expect(presentationSchema.safeParse(broken).success).toBe(false)
})

test('요소가 다른 슬라이드를 가리키는 문서는 거절한다', () => {
  const broken = structuredClone(example)
  broken.slides[0].elements[0].slideId = broken.slides[1].id
  expect(presentationSchema.safeParse(broken).success).toBe(false)
})

test('허용하지 않는 요소 종류는 거절한다', () => {
  const broken = structuredClone(example)
  broken.slides[0].elements[0].type = 'video'
  expect(presentationSchema.safeParse(broken).success).toBe(false)
})
