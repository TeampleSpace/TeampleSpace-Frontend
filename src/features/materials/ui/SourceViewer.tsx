import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../../../shared/ui/Button.tsx'
import { Modal } from '../../../shared/ui/Modal.tsx'
import { RequestError } from '../../../shared/ui/RequestError.tsx'
import { StatusPanel } from '../../../shared/ui/StatusPanel.tsx'
import { materialsApi } from '../../../entities/material/api.ts'
import { isAccessLoss, isGone } from '../../../entities/material/errors.ts'
import { kindLabels } from '../../../entities/material/model.ts'
import type { Material, MaterialSource } from '../../../entities/material/model.ts'
import { PdfCanvas } from './PdfCanvas.tsx'
import type { PdfDocument } from './PdfCanvas.tsx'
import { SourceLink } from './ExternalLink.tsx'
import styles from './Materials.module.css'
import linkStyles from './Links.module.css'

const Markdown = lazy(() => import('./Markdown.tsx'))
const returnNote = '닫으면 이전 화면의 작업을 그대로 이어갑니다.'

// 자료의 원문 팝업. PDF는 실제 파일을 그리고 전체 보기를 한 단계 위에 연다
export function SourceViewer({ material, revisionId, onClose, onError }: {
  material: Pick<Material, 'id' | 'title'> & Partial<Pick<Material, 'currentRevision' | 'createdBy'>>
  revisionId?: string
  onClose: () => void
  onError: (reason: unknown) => void
}) {
  const [source, setSource] = useState<MaterialSource | null>(null)
  const [error, setError] = useState<unknown>()
  // 원문이 삭제됐으면 보던 내용을 가린다
  const [gone, setGone] = useState(false)
  const [request, setRequest] = useState(0)
  const [pdf, setPdf] = useState<{ url: string; document: PdfDocument } | null>(null)
  const [fileError, setFileError] = useState<unknown>()
  const [page, setPage] = useState(revisionId ? 1 : (material.currentRevision?.excerpt?.page ?? 1))
  const [full, setFull] = useState(false)
  // 보던 개정을 계속 본다. 그사이 새 개정이 생겨도 바꾸지 않는다
  const openedRevisionId = useRef<string | undefined>(undefined)
  // 주소를 다시 받은 뒤에도 실패하면 더 반복하지 않는다
  const reissued = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    void materialsApi.source(material.id, revisionId ?? openedRevisionId.current, controller.signal).then((data) => {
      if (controller.signal.aborted) return
      openedRevisionId.current = data.revisionId
      setSource(data); setError(undefined)
    }).catch((reason) => {
      if (controller.signal.aborted) return
      if (isGone(reason) || isAccessLoss(reason)) { setSource(null); setPdf(null); setGone(true) }
      // 주소를 다시 받지 못했으면 파일 영역에 알리고 다시 시도하게 한다
      else setFileError(reason)
      setError(reason); onError(reason)
    })
    return () => controller.abort()
  }, [material.id, revisionId, request, onError])

  // 파일을 읽지 못하면 원문 주소를 한 번 다시 받는다. 보던 쪽은 그대로 둔다
  const onFileError = useCallback((reason: unknown) => {
    if (reissued.current) { setFileError(reason); return }
    reissued.current = true
    setRequest((value) => value + 1)
  }, [])
  const fileUrl = source?.file?.url
  useEffect(() => {
    if (!fileUrl) return
    let canceled = false
    let destroy = () => {}
    void import('../pdf.ts').then(({ openPdf }) => {
      if (canceled) return undefined
      const task = openPdf(fileUrl)
      destroy = task.destroy
      return task.promise
    }).then((document) => {
      if (canceled || !document) return
      setPdf({ url: fileUrl, document: document as unknown as PdfDocument }); setFileError(undefined)
    }).catch((reason) => { if (!canceled) onFileError(reason) })
    return () => { canceled = true; destroy() }
  }, [fileUrl, source, onFileError])

  const onRendered = useCallback(() => { reissued.current = false }, [])

  // 이전과 다음은 실제 문서의 쪽수로 정한다
  const pageCount = pdf?.document.numPages ?? source?.file?.pageCount ?? 1
  const current = Math.min(Math.max(page, 1), pageCount)
  const retryFile = () => { reissued.current = false; setFileError(undefined); setRequest((value) => value + 1) }
  const pager = (previous: string, next: string) => <>
    <Button variant="secondary" disabled={current <= 1} onClick={() => setPage(current - 1)}>{previous}</Button>
    <Button variant="secondary" disabled={current >= pageCount} onClick={() => setPage(current + 1)}>{next}</Button>
  </>
  const pdfPage = fileError
    ? <RequestError error={fileError} action={<Button onClick={retryFile}>원문 다시 불러오기</Button>} />
    : pdf && pdf.url === fileUrl
      ? <PdfCanvas document={pdf.document} page={current} title={material.title} onError={onFileError} onRendered={onRendered} />
      : <StatusPanel kind="loading" title="원문을 불러오고 있어요" />
  const footer = (close: () => void) => <><p className={styles.returnNote}>{returnNote}</p><Button onClick={close}>이전 화면으로 돌아가기</Button></>

  return <>
    <Modal open size="viewer" minHeight={720} title="자료 보기" description="자료의 원문을 확인하세요." onClose={onClose} footer={footer(onClose)}>
      <div className={styles.document}>
        {gone ? <>
          <h3>원문을 볼 수 없어요</h3>
          <p role="alert">{isAccessLoss(error) ? '이 프로젝트에 더 이상 접근할 수 없어요.' : '자료가 삭제됐어요. 보던 내용은 더 이상 표시하지 않아요.'}</p>
        </> : !source ? (error
          ? <RequestError error={error} action={<Button onClick={() => setRequest((value) => value + 1)}>다시 불러오기</Button>} />
          : <StatusPanel kind="loading" title="원문을 불러오고 있어요" />) : <>
          <h3>{source.title}</h3>
          {source.file && <>
            <p className={styles.documentMeta}>PDF · {current}쪽 / {pageCount}쪽</p>
            <div className={styles.pager}>
              <Button variant="secondary" onClick={() => setFull(true)}>전체 PDF 보기</Button>
              {pager('이전 쪽', '다음 쪽')}
            </div>
            {!full && pdfPage}
          </>}
          {source.markdown !== null && <>
            <p className={styles.documentMeta}>{kindLabels.memo}{material.createdBy ? ` · ${material.createdBy.name} 님 작성` : ''} · 개정 {source.sourceVersion}</p>
            <div className={styles.documentBody}><Suspense fallback={<p className={styles.plain}>{source.markdown}</p>}><Markdown>{source.markdown}</Markdown></Suspense></div>
          </>}
          {source.link && <>
            <p className={styles.documentMeta}>{kindLabels.link} · <SourceLink url={source.link.url} /></p>
            <p className={linkStyles.address}>{source.link.url}</p>
            <p className={`${styles.documentBody} ${styles.plain}`}>{source.link.text || '추출한 본문이 없어요'}</p>
          </>}
        </>}
      </div>
    </Modal>
    {source?.file && <Modal open={full} size="viewer" title="PDF 전체 보기" description={`${source.title} · 전체 ${pageCount}쪽`}
      onClose={() => setFull(false)} footer={footer(() => setFull(false))}>
      <div className={styles.pager}>{pager('이전 페이지', '다음 페이지')}</div>
      <div className={`${styles.document} ${styles.fullView}`}>
        <h3>{source.title}</h3>
        <p className={styles.documentMeta}>{current} / {pageCount}쪽</p>
        {full && pdfPage}
      </div>
    </Modal>}
  </>
}
