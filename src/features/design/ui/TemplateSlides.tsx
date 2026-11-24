import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '../../../shared/ui/Button.tsx'
import { designApi } from '../api.ts'
import type { DesignTemplate } from '../api.ts'
import { StudioPreview } from './StudioPreview.tsx'
import { previewSlides } from './templatePreviewSlides.ts'
import styles from './DesignPage.module.css'

type State = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; slides: ReturnType<typeof previewSlides> }

// 생성 엔진이 그린 예시 슬라이드를 보여 준다. 불러오는 동안과 실패하면 기존 시안을 보여 준다
export function TemplateSlides({ template, fallback }: { template: DesignTemplate; fallback: ReactNode }) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<State>({ status: 'loading' })
  const slides = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    designApi.preview(template.id, controller.signal)
      .then((preview) => setState({ status: 'ready', slides: previewSlides(template.key, preview) }))
      .catch(() => { if (!controller.signal.aborted) setState({ status: 'failed' }) })
    return () => controller.abort()
  }, [template.id, template.key, attempt])

  // 다시 시도 버튼이 사라지므로 불러온 슬라이드로 포커스를 옮긴다
  useEffect(() => {
    if (state.status === 'ready' && attempt > 0) slides.current?.focus()
  }, [state.status, attempt])

  if (state.status === 'ready') {
    return <div ref={slides} className={styles.previewSlides} tabIndex={-1} aria-label="실제 배치 미리보기">
      {state.slides.map(({ label, document }) => <StudioPreview key={document.id} slide={document} label={label} />)}
    </div>
  }
  return <>
    {state.status === 'failed' && <div className={styles.notice} role="alert">
      <p>실제 배치 미리보기를 불러오지 못했어요. 아래는 대표 시안이에요.</p>
      <Button variant="secondary" onClick={() => {
        setState({ status: 'loading' })
        setAttempt((value) => value + 1)
      }}>다시 시도</Button>
    </div>}
    {fallback}
  </>
}
