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
    getAnnotations?: () => Promise<{ subtype?: string; url?: string; dest?: unknown; rect?: number[] }[]>
    getTextContent?: () => Promise<{ items: { str?: string; transform?: number[]; width?: number }[] }>
  }>
  getDestination?: (name: string) => Promise<unknown[] | null>
  getPageIndex?: (ref: unknown) => Promise<number>
}

type PageLink = { url?: string; target?: number; left: number; top: number; width: number; height: number }

// 본문 글자로만 적힌 웹 주소. 끝의 문장부호와 괄호는 주소에 넣지 않는다
const writtenAddress = /(?:https?:\/\/|www\.)[^\s<>"'()[\]]*[^\s<>"'()[\].,;:!?]/gi

// 글자 일부의 가로 위치 비율. 실제 글꼴 대신 기본 글꼴 너비로 어림한다
let ruler: CanvasRenderingContext2D | null | undefined
function share(text: string, end: number) {
  ruler ??= document.createElement('canvas').getContext?.('2d') ?? null
  if (!ruler) return end / text.length
  ruler.font = '10px sans-serif'
  return ruler.measureText(text.slice(0, end)).width / (ruler.measureText(text).width || 1)
}

// 문서 안 링크가 가리키는 쪽 번호
async function targetPage(pdf: PdfDocument, dest: unknown) {
  const explicit = typeof dest === 'string' ? await pdf.getDestination?.(dest) : dest
  const ref: unknown = Array.isArray(explicit) ? explicit[0] : undefined
  const index = typeof ref === 'number' ? ref : ref && typeof ref === 'object' ? await pdf.getPageIndex?.(ref) : undefined
  return index !== undefined && Number.isInteger(index) && index >= 0 && index < pdf.numPages ? index + 1 : undefined
}

// 문서의 한 쪽을 영역 너비에 맞춰 그리고 쪽 안의 링크를 같은 자리에 누를 수 있게 둔다
export function PdfCanvas({ document: pdf, page, title, onError, onRendered, onNavigate }: {
  document: PdfDocument; page: number; title: string; onError: (reason: unknown) => void; onRendered: () => void
  onNavigate?: (page: number) => void
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
        if (!base.convertToViewportPoint) return
        const toViewport = (x: number, y: number) => base.convertToViewportPoint!(x, y)
        // 링크 자리는 쪽 크기에 대한 비율로 둬서 화면 너비가 바뀌어도 맞는다
        const place = (rect: number[]) => {
          const [x1 = 0, y1 = 0] = toViewport(rect[0]!, rect[1]!)
          const [x2 = 0, y2 = 0] = toViewport(rect[2]!, rect[3]!)
          return { left: Math.min(x1, x2) / base.width * 100, top: Math.min(y1, y2) / base.height * 100,
            width: Math.abs(x2 - x1) / base.width * 100, height: Math.abs(y2 - y1) / base.height * 100 }
        }
        const notes = await source.getAnnotations?.().catch(() => []) ?? []
        const items: PageLink[] = []
        for (const note of notes) {
          if (note.subtype !== 'Link' || note.rect?.length !== 4) continue
          if (note.url) {
            if (/^(https?:|mailto:)/i.test(note.url)) items.push({ url: note.url, ...place(note.rect) })
            continue
          }
          const found = note.dest ? await targetPage(pdf, note.dest).catch(() => undefined) : undefined
          if (found) items.push({ target: found, ...place(note.rect) })
        }
        // 링크 주석 없이 글자로만 적힌 주소도 누를 수 있게 한다. 주석과 겹치면 주석을 쓴다
        // ponytail: 줄을 넘겨 이어진 주소는 첫 줄만 잡힌다. 필요해지면 다음 글자 조각과 이어 붙인다
        const text = await source.getTextContent?.().catch(() => null)
        const noted = items.slice()
        for (const item of text?.items ?? []) {
          const [a = 0, b = 0, c = 0, d = 0, x = 0, y = 0] = item.transform ?? []
          if (!item.str || !item.width || Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || a <= 0 || d <= 0) continue
          for (const match of item.str.matchAll(writtenAddress)) {
            const start = x + item.width * share(item.str, match.index)
            const end = x + item.width * share(item.str, match.index + match[0].length)
            const spot = place([start, y - d * 0.25, end, y + d * 0.9])
            const covered = noted.some((link) => spot.left < link.left + link.width && link.left < spot.left + spot.width
              && spot.top < link.top + link.height && link.top < spot.top + spot.height)
            if (!covered) items.push({ url: /^www\./i.test(match[0]) ? `https://${match[0]}` : match[0], ...spot })
          }
        }
        if (!canceled) setLinks({ page, items })
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
      {link.url
        ? <ExternalLink href={link.url} className={linkStyles.pdfLink}><span className={linkStyles.hidden}>{page}쪽의 링크 {link.url}</span></ExternalLink>
        : onNavigate && <button type="button" className={linkStyles.pdfLink} onClick={() => { onNavigate(link.target!); canvas.current?.scrollIntoView?.({ block: 'start' }) }}>
          <span className={linkStyles.hidden}>{page}쪽의 링크 {link.target}쪽으로 이동</span></button>}
    </span>)}
  </div></div>
}
