import { useLayoutEffect, useRef, useState } from 'react'
import { SlideRenderer } from '../../../entities/presentation/SlideRenderer.tsx'
import type { Slide } from '../../../entities/presentation/schema.ts'
import styles from './StudioPreview.module.css'

const canvas = { width: 1280, height: 720, unit: 'px' as const }

export function StudioPreview({ slide, label }: { slide: Slide; label?: string }) {
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

  const preview = <div className={styles.frame} ref={container}>
    <SlideRenderer canvas={canvas} slide={slide} scale={width / canvas.width} />
  </div>
  if (!label) return <div aria-hidden="true">{preview}</div>

  return <figure className={styles.figure}>{preview}<figcaption>{label}</figcaption></figure>
}
