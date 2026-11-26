import { useEffect, useRef, useState } from 'react'
import { ExternalLink } from './ExternalLink.tsx'
import styles from './Materials.module.css'
import linkStyles from './Links.module.css'

// PDF.js 문서에서 화면이 쓰는 부분만 적은 형식
export type PdfDocument = {
  numPages: number
  getPage: (page: number) => Promise<{
    getViewport: (options: { scale: number }) => { width: number; height: number; convertToViewportPoint?: (x: number, y: number) => number[] }
    render: (options: { canvas: HTMLCanvasElement; viewport: { width: number; height: number } }) => { promise: Promise<unknown>; cancel: () => void }
    getAnnotations?: () => Promise<{ subtype?: string; url?: string; rect?: number[] }[]>
  }>
}

type PageLink = { url: string; left: number; top: number; width: number; height: number }

// 문서의 한 쪽을 영역 너비에 맞춰 그리고 쪽 안의 웹 링크를 같은 자리에 누를 수 있게 둔다
export function PdfCanvas({ document: pdf, page, title, onError, onRendered }: {
  document: PdfDocument; page: number; title: string; onError: (reason: unknown) => void; onRendered: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [links, setLinks] = useState<{ page: number; items: PageLink[] }>({ page: 0, items: [] })
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
        if (canceled) return
        onRendered()
        // 링크 자리는 쪽 크기에 대한 비율로 둬서 화면 너비가 바뀌어도 맞는다
        const notes = await source.getAnnotations?.().catch(() => []) ?? []
        if (canceled || !base.convertToViewportPoint) return
        const items = notes.flatMap((note) => {
          if (note.subtype !== 'Link' || !note.url || !/^(https?:|mailto:)/i.test(note.url) || note.rect?.length !== 4) return []
          const [x1 = 0, y1 = 0] = base.convertToViewportPoint!(note.rect[0]!, note.rect[1]!)
          const [x2 = 0, y2 = 0] = base.convertToViewportPoint!(note.rect[2]!, note.rect[3]!)
          return [{ url: note.url, left: Math.min(x1, x2) / base.width * 100, top: Math.min(y1, y2) / base.height * 100,
            width: Math.abs(x2 - x1) / base.width * 100, height: Math.abs(y2 - y1) / base.height * 100 }]
        })
        setLinks({ page, items })
      } catch (reason) {
        // 쪽을 넘기며 취소한 그리기는 오류가 아니다
        if (!canceled) onError(reason)
      }
    })()
    return () => { canceled = true; task?.cancel() }
  }, [pdf, page, onError, onRendered])
  return <div className={styles.pdfPage}><div className={linkStyles.pdfFrame}>
    <canvas ref={canvas} role="img" aria-label={`${title} ${page}쪽`} />
    {links.page === page && links.items.map((link, index) => <span key={index} className={linkStyles.pdfSpot}
      style={{ left: `${link.left}%`, top: `${link.top}%`, width: `${link.width}%`, height: `${link.height}%` }}>
      <ExternalLink href={link.url} className={linkStyles.pdfLink}><span className={linkStyles.hidden}>{page}쪽의 링크 {link.url}</span></ExternalLink>
    </span>)}
  </div></div>
}
