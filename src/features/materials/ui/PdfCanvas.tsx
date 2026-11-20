import { useEffect, useRef } from 'react'
import styles from './Materials.module.css'

// PDF.js 문서에서 화면이 쓰는 부분만 적은 형식
export type PdfDocument = {
  numPages: number
  getPage: (page: number) => Promise<{
    getViewport: (options: { scale: number }) => { width: number; height: number }
    render: (options: { canvas: HTMLCanvasElement; viewport: { width: number; height: number } }) => { promise: Promise<unknown>; cancel: () => void }
  }>
}

// 문서의 한 쪽을 영역 너비에 맞춰 그린다
export function PdfCanvas({ document: pdf, page, title, onError, onRendered }: {
  document: PdfDocument; page: number; title: string; onError: (reason: unknown) => void; onRendered: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let canceled = false
    let task: { cancel: () => void } | undefined
    void (async () => {
      try {
        const target = canvas.current
        if (!target) return
        const source = await pdf.getPage(page)
        if (canceled) return
        const base = source.getViewport({ scale: 1 })
        const width = target.parentElement?.clientWidth || base.width
        const viewport = source.getViewport({ scale: (width / base.width) * Math.min(window.devicePixelRatio || 1, 2) })
        target.width = viewport.width; target.height = viewport.height
        const rendering = source.render({ canvas: target, viewport })
        task = rendering
        await rendering.promise
        if (!canceled) onRendered()
      } catch (reason) {
        // 쪽을 넘기며 취소한 그리기는 오류가 아니다
        if (!canceled) onError(reason)
      }
    })()
    return () => { canceled = true; task?.cancel() }
  }, [pdf, page, onError, onRendered])
  return <div className={styles.pdfPage}><canvas ref={canvas} role="img" aria-label={`${title} ${page}쪽`} /></div>
}
