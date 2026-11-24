import type { TemplatePreview } from '../api.ts'
import { slide } from './studioSlide.ts'
import type { PreviewElement } from './studioSlide.ts'

const layoutLabels: Record<string, string> = {
  title: '표지', agenda: '목차', statement: '핵심 문장', cards: '카드', compare: '비교', process: '단계', list: '목록', summary: '정리',
}

// 서버가 그린 미리보기를 문서 슬라이드로 바꾼다. 배치 이름을 붙인다
export function previewSlides(templateKey: string, preview: TemplatePreview) {
  return preview.slides.map(({ layoutId, elements }, index) =>
    slide(`${templateKey}-preview-${index}`, layoutLabels[layoutId] ?? layoutId,
      elements.map(({ geometry: { z: _z, ...geometry }, ...element }): PreviewElement => ({ ...element, geometry }))))
}
