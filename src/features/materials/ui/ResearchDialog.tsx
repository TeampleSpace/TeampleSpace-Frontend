import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { TransportError } from '../../../shared/api/client.ts'
import { Button } from '../../../shared/ui/Button.tsx'
import { Field } from '../../../shared/ui/Field.tsx'
import { Modal } from '../../../shared/ui/Modal.tsx'
import { RequestError } from '../../../shared/ui/RequestError.tsx'
import type { Project } from '../../../entities/project/model.ts'
import { materialsApi } from '../../../entities/material/api.ts'
import { isAccessLoss, isUncertain } from '../../../entities/material/errors.ts'
import { limits } from '../../../entities/material/model.ts'
import type { Job, Material } from '../../../entities/material/model.ts'
import { researchApi, researchMarkdown, researchResultSchema, topicMax } from '../../../entities/material/research.ts'
import type { ResearchResult } from '../../../entities/material/research.ts'
import Markdown from './Markdown.tsx'
import styles from './Materials.module.css'
import own from './ResearchDialog.module.css'

const running = (job?: Job) => job?.status === 'queued' || job?.status === 'running'

// 주제를 AI로 조사하고 확인한 결과를 메모 자료로 추가한다. 결과는 저장하기 전까지 이 창에만 있다
export function ResearchDialog({ project, onClose, onDone, onDirtyChange, onError }: {
  project: Project; onClose: () => void; onDone: (material: Material) => void
  onDirtyChange: (dirty: boolean) => void; onError: (reason: unknown) => void
}) {
  const [topic, setTopic] = useState('')
  const [job, setJob] = useState<Job>()
  const [result, setResult] = useState<ResearchResult>()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const [pollError, setPollError] = useState<unknown>()
  const [poll, setPoll] = useState(0)
  const [confirmClose, setConfirmClose] = useState(false)
  // 결과를 모르는 조사 요청. 같은 주제로 다시 보낼 때만 키를 다시 쓴다
  const startRetry = useRef<{ key: string; topic: string } | null>(null)
  const saveRetry = useRef<{ key: string; body: string } | null>(null)
  const lock = useRef(false)
  const topicId = useId()
  const topicField = () => document.getElementById(topicId) as HTMLInputElement | null

  const dirty = !!topic.trim() || !!job
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const pollId = running(job) ? job?.id : undefined
  useEffect(() => {
    if (!pollId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    async function check() {
      let delay = 2000
      try {
        const latest = await materialsApi.job(pollId!, controller.signal)
        if (controller.signal.aborted) return
        setPollError(undefined)
        settle(latest)
        if (!running(latest)) return
      } catch (reason) {
        if (controller.signal.aborted) return
        onError(reason)
        setPollError(reason)
        if (isAccessLoss(reason)) return
        delay = 4000
      }
      timer = setTimeout(() => void check(), delay)
    }
    timer = setTimeout(() => void check(), 1000)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [pollId, poll, onError])

  // 조회와 취소 응답에 같이 쓴다. 취소 전에 끝난 작업이면 결과를 보여 준다
  function settle(latest: Job) {
    if (latest.status === 'succeeded') {
      const parsed = researchResultSchema.safeParse(latest.resultRef)
      if (!parsed.success) throw new TransportError('invalid_response')
      setResult(parsed.data)
      setTitle(parsed.data.topic.slice(0, limits.title))
    }
    setJob(latest)
  }

  async function guarded(work: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(undefined)
    try { await work() } catch (reason) { onError(reason); setError(reason) } finally { lock.current = false; setBusy(false) }
  }

  const start = () => guarded(async () => {
    const value = (topicField()?.value ?? topic).trim()
    if (!value) return
    if (startRetry.current?.topic !== value) startRetry.current = { key: crypto.randomUUID(), topic: value }
    try {
      const queued = await researchApi.start(project.id, value, startRetry.current.key)
      if (queued.type !== 'material_research') throw new TransportError('invalid_response')
      startRetry.current = null
      setResult(undefined); setPollError(undefined); setJob(queued)
    } catch (reason) {
      if (!isUncertain(reason)) startRetry.current = null
      throw reason
    }
  })

  const cancel = () => guarded(async () => {
    if (job) settle(await materialsApi.cancelJob(job.id))
  })

  // 같은 본문이면 결과를 모르는 저장 요청의 키를 다시 쓴다
  const save = () => guarded(async () => {
    if (!result || !title.trim()) return
    const body = { title: title.trim(), markdown: researchMarkdown(result) }
    const serialized = JSON.stringify(body)
    if (saveRetry.current?.body !== serialized) saveRetry.current = { key: crypto.randomUUID(), body: serialized }
    try {
      const created = await materialsApi.createMemo(project.id, body, saveRetry.current.key)
      saveRetry.current = null
      onDone(created.material)
    } catch (reason) {
      if (!isUncertain(reason)) saveRetry.current = null
      throw reason
    }
  })

  // 주제는 그대로 두고 처음 단계로 돌아간다
  function again() {
    setJob(undefined); setResult(undefined); setError(undefined); setPollError(undefined)
  }
  // 주제 단계로 돌아오면 바뀐 버튼에 포커스가 남지 않게 입력란으로 옮긴다
  const atTopic = !job
  useEffect(() => { if (atTopic) document.getElementById(topicId)?.focus() }, [atTopic, topicId])
  function requestClose() {
    if (busy) return
    if (dirty) setConfirmClose(true); else onClose()
  }

  const failed = job?.status === 'failed' || job?.status === 'canceled'
  const footer = result
    ? <Fragment key="result"><Button variant="secondary" disabled={busy} onClick={again}>새로 조사</Button>
      <Button loading={busy} disabled={!title.trim()} onClick={() => void save()}>자료로 추가</Button></Fragment>
    : running(job)
      ? <Fragment key="running"><Button variant="secondary" disabled={busy} onClick={requestClose}>닫기</Button>
        <Button variant="secondary" loading={busy} onClick={() => void cancel()}>조사 취소</Button></Fragment>
      : failed
        ? <Fragment key="failed"><Button variant="secondary" disabled={busy} onClick={again}>주제 바꾸기</Button>
          <Button loading={busy} onClick={() => void start()}>다시 조사</Button></Fragment>
        : <Fragment key="topic"><Button variant="secondary" disabled={busy} onClick={requestClose}>취소</Button>
          <Button loading={busy} disabled={!topic.trim()} onClick={() => void start()}>조사 시작</Button></Fragment>

  return <>
    <Modal open size="form" minHeight={result ? 760 : 480} title="AI 자료 조사"
      description={`${project.name} · 주제를 웹에서 찾아 출처와 함께 정리해요`} onClose={requestClose} footer={footer}>
      {!job && <div className={styles.form}>
        <Field id={topicId} data-autofocus label="조사할 주제" placeholder="예: 국내 대학생의 생성형 AI 활용 현황" maxLength={topicMax}
          value={topic} disabled={busy} onChange={(event) => setTopic(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) void start() }} />
        <p className={styles.guide}>입력한 주제가 AI 서비스로 전달되고, AI가 웹 검색 결과를 바탕으로 정리해요. 프로젝트 자료는 보내지 않아요.</p>
        <RequestError error={error} />
      </div>}

      {running(job) && <div className={styles.form}>
        <p role="status" className={own.progress}>{job?.status === 'queued' ? '조사를 준비하고 있어요' : '웹에서 자료를 찾고 정리하는 중이에요'}</p>
        <p className={styles.guide}>보통 1분 안팎, 길면 2분 정도 걸려요. 창을 닫으면 결과를 볼 수 없어요.</p>
        <RequestError error={pollError ?? error} action={pollError ? <Button variant="text" onClick={() => setPoll((value) => value + 1)}>상태 다시 확인</Button> : undefined} />
      </div>}

      {failed && !result && <div className={styles.form}>
        <p role="alert" className={own.progress}>{job?.status === 'canceled' ? '조사를 취소했어요.' : job?.error?.message ?? '자료를 조사하지 못했어요.'}</p>
        <p className={styles.guide}>입력한 주제는 그대로 남아 있어요. 같은 주제로 다시 조사하거나 주제를 바꿀 수 있어요.</p>
        <RequestError error={error} />
      </div>}

      {result && <div className={styles.form}>
        <p className={own.label}>AI가 정리한 조사 결과예요. 출처에서 사실을 확인한 뒤 자료로 추가해 주세요.</p>
        <div className={own.result}><Markdown>{result.markdown}</Markdown></div>
        <section aria-labelledby="research-sources">
          <h3 id="research-sources" className={own.heading}>출처 {result.sources.length}개</h3>
          <ol className={own.sources}>
            {result.sources.map((source) => <li key={source.url}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
              <span className={own.host}>{hostOf(source.url)}</span>
            </li>)}
          </ol>
        </section>
        <Field label="자료 이름" maxLength={limits.title} value={title} disabled={busy}
          description="메모 자료로 추가되고 출처 목록도 본문 끝에 함께 남아요." onChange={(event) => setTitle(event.target.value)} />
        <RequestError error={error} />
      </div>}
    </Modal>

    <Modal open={confirmClose} size="dialog" onClose={() => setConfirmClose(false)}
      title={result ? '조사 결과를 저장하지 않고 닫을까요?' : running(job) ? '조사를 멈추지 않고 닫을까요?' : '입력한 주제를 닫을까요?'}
      description={result ? '자료로 추가하지 않은 조사 결과는 사라져요.' : running(job) ? '창을 닫으면 진행 중인 조사 결과를 볼 수 없어요.' : '입력한 내용이 사라져요.'}
      footer={<>
        <Button onClick={() => setConfirmClose(false)} data-autofocus>계속 보기</Button>
        <Button variant="secondary" className={styles.dangerText} onClick={() => {
          if (running(job) && job) void materialsApi.cancelJob(job.id).catch(() => undefined)
          onClose()
        }}>닫기</Button>
      </>} />
  </>
}

function hostOf(url: string) {
  try { return new URL(url).host } catch { return url }
}
