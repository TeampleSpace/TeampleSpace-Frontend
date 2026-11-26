import { useState } from 'react'
import type { Presentation, Slide } from '../../../entities/presentation/schema.ts'
import { Button } from '../../../shared/ui/Button.tsx'
import type { DesignTemplate } from '../api.ts'
import { DesignPreview } from './DesignPreview.tsx'
import { StudioPreview } from './StudioPreview.tsx'
import { studioPreview } from './studioPreviews.ts'
import { useTemplateSlides } from './templatePreviewSlides.ts'
import styles from './DesignPage.module.css'

type Labeled = { label: string; document: Slide }

// 큰 슬라이드 하나와 배치를 고르는 작은 슬라이드를 보여 준다
function SlidePicker({ slides, canvas }: { slides: Labeled[]; canvas?: Presentation['canvas'] }) {
  const [index, setIndex] = useState(0)
  const current = slides[Math.min(index, slides.length - 1)]
  return <>
    <StudioPreview slide={current.document} label={current.label} canvas={canvas} />
    {slides.length > 1 && <div className={styles.slideThumbs} role="group" aria-label="배치 선택">
      {slides.map(({ label, document }, position) => <button key={document.id} type="button"
        aria-pressed={position === index} aria-label={`${label} 배치`} title={label} onClick={() => setIndex(position)}>
        <StudioPreview slide={document} canvas={canvas} />
      </button>)}
    </div>}
  </>
}

// 선택한 템플릿의 실제 배치를 보여 준다. 시안이 따로 있는 템플릿은 상세 미리보기처럼 시안을 쓴다
export function TemplateSlidePreview({ template, projectName }: { template?: DesignTemplate; projectName?: string }) {
  const studio = template && studioPreview(template.key)
  const { state, retry } = useTemplateSlides(studio ? undefined : template)
  if (!template) return <p className={styles.notice}>템플릿을 고르면 여기에서 슬라이드를 미리 볼 수 있어요.</p>
  if (studio) return <SlidePicker key={template.key} slides={studio} />
  if (state.status === 'ready') return <SlidePicker key={template.id} slides={state.slides} canvas={state.canvas} />
  return <>
    {state.status === 'failed' && <div className={styles.notice} role="alert">
      <p>실제 배치 미리보기를 불러오지 못했어요. 아래는 대표 시안이에요.</p>
      <Button variant="secondary" onClick={retry}>다시 시도</Button>
    </div>}
    <div aria-busy={state.status === 'loading'}>
      <DesignPreview projectName={projectName} variant="detail"
        preview={{ ...template.preview, font: template.fonts[0], templateKey: template.key }} />
    </div>
  </>
}
