import { useEffect, useState } from 'react'
import { designApi } from '../api.ts'
import type { DesignTemplate, TemplatePreview } from '../api.ts'
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

type Ready = { canvas: TemplatePreview['canvas']; slides: ReturnType<typeof previewSlides> }
type State = { status: 'loading' } | { status: 'failed' } | ({ status: 'ready' } & Ready)

// 생성 엔진이 그린 예시 슬라이드를 불러온다. 템플릿이 바뀌면 다시 불러오는 중으로 본다
export function useTemplateSlides(template?: DesignTemplate) {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<{ key: string; result: Ready | null }>()
  const id = template?.id
  const templateKey = template?.key
  const key = `${id}:${attempt}`

  useEffect(() => {
    if (!id || !templateKey) return
    const controller = new AbortController()
    designApi.preview(id, controller.signal)
      .then((preview) => setLoaded({ key, result: { canvas: preview.canvas, slides: previewSlides(templateKey, preview) } }))
      .catch(() => { if (!controller.signal.aborted) setLoaded({ key, result: null }) })
    return () => controller.abort()
  }, [id, templateKey, key])

  const state: State = !id || loaded?.key !== key ? { status: 'loading' }
    : loaded.result ? { status: 'ready', ...loaded.result } : { status: 'failed' }
  return { state, retry: () => setAttempt((value) => value + 1) }
}
