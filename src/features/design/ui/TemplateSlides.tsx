import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '../../../shared/ui/Button.tsx'
import type { DesignTemplate } from '../api.ts'
import { StudioPreview } from './StudioPreview.tsx'
import { useTemplateSlides } from './templatePreviewSlides.ts'
import styles from './DesignPage.module.css'

// 불러오는 동안과 실패하면 기존 시안을 보여 준다
export function TemplateSlides({ template, fallback }: { template: DesignTemplate; fallback: ReactNode }) {
  const { state, retry } = useTemplateSlides(template)
  const [retried, setRetried] = useState(false)
  const slides = useRef<HTMLDivElement>(null)

  // 다시 시도 버튼이 사라지므로 불러온 슬라이드로 포커스를 옮긴다
  useEffect(() => {
    if (state.status === 'ready' && retried) slides.current?.focus()
  }, [state.status, retried])

  if (state.status === 'ready') {
    return <div ref={slides} className={styles.previewSlides} tabIndex={-1} aria-label="실제 배치 미리보기">
      {state.slides.map(({ label, document }) => <StudioPreview key={document.id} slide={document} label={label} canvas={state.canvas} />)}
    </div>
  }
  return <>
    {state.status === 'failed' && <div className={styles.notice} role="alert">
      <p>실제 배치 미리보기를 불러오지 못했어요. 아래는 대표 시안이에요.</p>
      <Button variant="secondary" onClick={() => {
        setRetried(true)
        retry()
      }}>다시 시도</Button>
    </div>}
    {fallback}
  </>
}
