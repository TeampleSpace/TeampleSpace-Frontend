import type { Element } from '../../entities/presentation/schema.ts'

// 목록과 안내에 쓰는 요소 이름
export function describeElement(element: Element): string {
  if (element.type === 'text') return `텍스트 ${element.content.text.slice(0, 14)}`
  if (element.type === 'image') return `이미지 ${element.content.alt}`
  return element.content.shape === 'ellipse' ? '도형 타원' : '도형 사각형'
}
