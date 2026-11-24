import type { TemplatePreview } from '../api.ts'
import { slide } from './studioSlide.ts'
import type { PreviewElement } from './studioSlide.ts'

const layoutLabels: Record<string, string> = {
  title: '표지', agenda: '목차', statement: '핵심 문장', cards: '카드', compare: '비교', process: '단계', list: '목록', summary: '정리',
}

// 서버가 그린 미리보기를 문서 슬라이드로 바꾼다. 배치 이름을 붙이고 쌓임 순서는 서버 값을 따른다
export function previewSlides(templateKey: string, preview: TemplatePreview) {
  return preview.slides.map(({ layoutId, elements }, index) =>
    slide(`${templateKey}-preview-${index}`, layoutLabels[layoutId] ?? layoutId,
      [...elements].sort((a, b) => a.geometry.z - b.geometry.z)
        .map(({ geometry: { z: _z, ...geometry }, ...element }): PreviewElement => ({ ...element, geometry }))))
}
