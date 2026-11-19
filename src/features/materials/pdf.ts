import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// PDF.js는 원문을 열 때만 불러온다
GlobalWorkerOptions.workerSrc = workerUrl

export function openPdf(url: string) {
  const assetBase = import.meta.env.BASE_URL + 'pdfjs/'
  const task = getDocument({
    url,
    cMapUrl: assetBase + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: assetBase + 'standard_fonts/',
    wasmUrl: assetBase + 'wasm/',
  })
  return { promise: task.promise, destroy: () => void task.destroy() }
}
