import type { CSSProperties } from 'react'
import type { TextElement } from './schema.ts'

// 문서의 텍스트 스타일을 화면 스타일로 바꾼다. 렌더러와 입력창이 같은 값을 쓴다
export function textStyle(element: TextElement): CSSProperties {
  const { fontFamily, fontSize, fontWeight, color, align, lineHeight } = element.style
  return {
    fontFamily: `'${fontFamily}', var(--font-slide)`,
    fontSize,
    fontWeight,
    color,
    textAlign: align,
    lineHeight,
  }
}
