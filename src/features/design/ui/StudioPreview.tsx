import { useLayoutEffect, useRef, useState } from 'react'
import { SlideRenderer } from '../../../entities/presentation/SlideRenderer.tsx'
import type { Presentation, Slide } from '../../../entities/presentation/schema.ts'
import styles from './StudioPreview.module.css'

const defaultCanvas: Presentation['canvas'] = { width: 1280, height: 720, unit: 'px' }

export function StudioPreview({ slide, label, canvas = defaultCanvas }: {
  slide: Slide
  label?: string
  canvas?: Presentation['canvas']
}) {
  const container = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const frame = container.current
    if (!frame) return
    setWidth(frame.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  const preview = <div className={styles.frame} ref={container} style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}>
    <SlideRenderer canvas={canvas} slide={slide} scale={width / canvas.width} />
  </div>
  if (!label) return <div aria-hidden="true">{preview}</div>

  return <figure className={styles.figure}>{preview}<figcaption>{label}</figcaption></figure>
}
