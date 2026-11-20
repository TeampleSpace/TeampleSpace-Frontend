import { useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import { ApiError, TransportError } from '../../../shared/api/client.ts'
import { Button } from '../../../shared/ui/Button.tsx'
import { Field } from '../../../shared/ui/Field.tsx'
import { Modal } from '../../../shared/ui/Modal.tsx'
import { RequestError } from '../../../shared/ui/RequestError.tsx'
import { StatusPanel } from '../../../shared/ui/StatusPanel.tsx'
import { useSession } from '../../auth/sessionContext.ts'
import { materialsApi } from '../../materials/api.ts'
import { isAccessLoss, isGone, isUncertain } from '../../materials/errors.ts'
import type { Job, MaterialSummary } from '../../materials/model.ts'
import { outlineGenerationApi, outlineResultSchema } from '../api.ts'
import type { GenerationInput } from '../api.ts'
import styles from './OutlineGeneration.module.css'

type Props = {
  projectId: string
  version: number
  dirty: boolean
  outlineHasItems: boolean
  onGenerated: () => Promise<boolean>
  onAccessError: (reason: unknown) => void
}

type Request = { body: GenerationInput; key: string }
type Choices = { items: MaterialSummary[]; nextCursor: string | null }
type ChoicesFailure = { reason: unknown; cursor?: string }
type ResultState = { jobId: string; status: 'applied' | 'deferred' }
const maxSources = 20
const maxInstructions = 1000

function isActive(job: Job | undefined) {
  return job?.status === 'queued' || job?.status === 'running'
}

function isConflict(reason: unknown) {
  return reason instanceof ApiError && reason.code === 'VERSION_CONFLICT'
}

function isRateLimited(reason: unknown) {
  return reason instanceof ApiError && reason.status === 429
}

function retryDelay(reason: unknown) {
  if (!(reason instanceof ApiError)) return 0
  const fallback = reason.status === 429 || reason.code === 'REQUEST_IN_PROGRESS' ? 1 : 0
  return (reason.retryAfterSeconds ?? fallback) * 1000
}

function confirmJob(job: Job, projectId: string) {
  if (job.type !== 'outline_generation' || job.targetType !== 'outline'
    || job.projectId?.toLowerCase() !== projectId.toLowerCase()
    || job.targetId?.toLowerCase() !== projectId.toLowerCase()) {
    throw new TransportError('invalid_response')
  }
  return job
}

export default function OutlineGeneration(props: Props) {
  return <GenerationControls key={props.projectId} {...props} />
}

function GenerationControls({ projectId, version, dirty, outlineHasItems, onGenerated, onAccessError }: Props) {
  const { capabilities } = useSession()
  const enabled = capabilities?.featureFlags.outlineGeneration === true
  const [view, setView] = useState<'form' | 'job' | null>(null)
  const [choices, setChoices] = useState<Choices>()
  const [choicesError, setChoicesError] = useState<ChoicesFailure>()
  const [choicesLoading, setChoicesLoading] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [instructions, setInstructions] = useState('')
  const [job, setJob] = useState<Job>()
  const [jobError, setJobError] = useState<unknown>()
  const [writeError, setWriteError] = useState<unknown>()
  const [pending, setPending] = useState<Request>()
  const [write, setWrite] = useState<'create' | 'cancel' | 'refresh' | null>(null)
  const [result, setResult] = useState<ResultState>()
  const [readAttempt, setReadAttempt] = useState(0)
  const [retryUntil, setRetryUntil] = useState<number>()
  const [cancelDeniedFor, setCancelDeniedFor] = useState<string>()
  const choicesLock = useRef(false)
  const writeLock = useRef(false)
  const hintId = useId()

  const active = isActive(job)
  const activeJobId = active ? job?.id : undefined
  const completedJobId = job?.status === 'succeeded' ? job.id : undefined
  const completedResult = result?.jobId === completedJobId ? result?.status : undefined
  const resultApplied = completedResult === 'applied'
  const resultWaiting = !resultApplied && (dirty || completedResult === 'deferred')
  const showProgress = view === 'job' && active
  const isConflictError = isConflict(writeError)

  function reportAccess(reason: unknown, projectScoped = false) {
    if (isAccessLoss(reason) || (projectScoped && isGone(reason))) onAccessError(reason)
  }
  const reportReadAccess = useEffectEvent(reportAccess)

  function pauseWrites(reason: unknown) {
    const delay = retryDelay(reason)
    if (!delay) return
    const until = Date.now() + delay
    setRetryUntil((previous) => Math.max(previous ?? 0, until))
  }

  function shouldResume(entry: Job) {
    if (isActive(entry)) return true
    const result = outlineResultSchema.safeParse(entry.resultRef)
    return entry.status === 'succeeded' && result.success && result.data.outlineVersion > version
  }
  const resumeOnEntry = useEffectEvent((entry: Job) => {
    if (shouldResume(entry)) setJob((current) => current ?? entry)
  })

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    void outlineGenerationApi.latest(projectId, controller.signal).then((found) => {
      if (controller.signal.aborted || !found) return
      resumeOnEntry(confirmJob(found, projectId))
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) reportReadAccess(reason, true)
    })
    return () => controller.abort()
  }, [enabled, projectId])

  useEffect(() => {
    if (!retryUntil) return
    const timer = setTimeout(() => setRetryUntil(undefined), Math.max(0, retryUntil - Date.now()))
    return () => clearTimeout(timer)
  }, [retryUntil])

  useEffect(() => {
    const id = activeJobId
    if (!id) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    async function check(jobId: string) {
      let delay = 1500
      try {
        const latest = confirmJob(await materialsApi.job(jobId, controller.signal), projectId)
        if (controller.signal.aborted) return
        setJob((current) => {
          // 취소 응답보다 늦게 도착한 조회가 완료 상태나 취소 표시를 되돌리지 않는다
          if (current?.id !== latest.id || !isActive(current)) return current
          if (current.cancelRequestedAt && !latest.cancelRequestedAt && isActive(latest)) return current
          return latest
        })
        setJobError(undefined)
        if (latest.cancelRequestedAt || latest.status === 'canceled') setWriteError(undefined)
        if (!isActive(latest)) return
      } catch (reason) {
        if (controller.signal.aborted) return
        setJobError(reason)
        reportReadAccess(reason)
        if (isAccessLoss(reason) || isGone(reason)) return
        delay = Math.max(4000, retryDelay(reason))
      }
      timer = setTimeout(() => void check(jobId), delay)
    }
    void check(id)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [activeJobId, projectId, readAttempt])

  async function refreshGenerated(completed: Job, signal?: AbortSignal) {
    if (dirty || signal?.aborted) return false
    const reference = outlineResultSchema.safeParse(completed.resultRef)
    const inputVersion = completed.inputVersions?.outlineVersion
    if (!reference.success || reference.data.projectId.toLowerCase() !== projectId.toLowerCase()
      || (typeof inputVersion === 'number' && reference.data.outlineVersion !== inputVersion + 1)) {
      throw new TransportError('invalid_response')
    }
    setResult((current) => current?.jobId === completed.id && current.status === 'deferred' ? undefined : current)
    if (reference.data.outlineVersion > version && !(await onGenerated())) {
      if (!signal?.aborted) setResult({ jobId: completed.id, status: 'deferred' })
      return false
    }
    if (signal?.aborted) return false
    setResult({ jobId: completed.id, status: 'applied' })
    setSelected([])
    setInstructions('')
    setChoices(undefined)
    return true
  }

  const applyCompleted = useEffectEvent(async (jobId: string, signal: AbortSignal) => {
    if (signal.aborted || dirty || job?.id !== jobId) return
    setJobError(undefined)
    try { await refreshGenerated(job, signal) }
    catch (reason) {
      if (signal.aborted) return
      setJobError(reason)
      reportAccess(reason)
    }
  })

  useEffect(() => {
    if (!completedJobId || dirty || resultApplied) return
    const controller = new AbortController()
    void Promise.resolve().then(() => applyCompleted(completedJobId, controller.signal))
    return () => controller.abort()
  }, [completedJobId, resultApplied, dirty])

  async function loadChoices(cursor?: string) {
    if (choicesLock.current) return
    choicesLock.current = true
    setChoicesLoading(true)
    setChoicesError(undefined)
    try {
      const next = await materialsApi.list(projectId, { status: 'ready', cursor })
      const ready = next.items.filter((item) => item.status === 'ready')
      if (!cursor) {
        // 첫 페이지에서 빠진 선택은 준비 여부를 따로 확인한다
        if (next.nextCursor) {
          const missing = selected.filter((id) => !ready.some((item) => item.id === id))
          const results = await Promise.allSettled(missing.map((id) => materialsApi.get(id)))
          for (const [index, result] of results.entries()) {
            if (result.status === 'fulfilled') {
              if (result.value.status === 'ready' && result.value.projectId.toLowerCase() === projectId.toLowerCase()) ready.push(result.value)
            } else if (!isGone(result.reason)) {
              reportAccess(result.reason)
              const previous = choices?.items.find((item) => item.id === missing[index])
              if (previous && !isAccessLoss(result.reason)) ready.push(previous)
              setChoicesError((failure) => failure ?? { reason: result.reason })
            }
          }
        }
        const readyIds = new Set(ready.map((item) => item.id))
        setSelected((ids) => ids.filter((id) => readyIds.has(id)))
      }
      setChoices((current) => ({
        items: cursor && current ? [
          ...current.items,
          ...ready.filter((item) => !current.items.some((previous) => previous.id === item.id)),
        ] : ready,
        nextCursor: next.nextCursor,
      }))
    } catch (reason) {
      setChoicesError({ reason, cursor })
      reportAccess(reason, true)
    } finally { choicesLock.current = false; setChoicesLoading(false) }
  }

  function openForm() {
    setView('form')
    if (!pending && !writeLock.current) void loadChoices()
  }

  async function start() {
    if (writeLock.current || choicesLock.current || active || !enabled || dirty || isConflictError || retryUntil || !selected.length) return
    const instruction = instructions.trim()
    const command = pending ?? {
      key: crypto.randomUUID(),
      body: { expectedVersion: version, sourceIds: selected, ...(instruction ? { instructions: instruction } : {}) },
    }
    setPending(command)
    writeLock.current = true
    setWrite('create')
    setWriteError(undefined)
    try {
      const result = confirmJob(await outlineGenerationApi.create(projectId, command.body, command.key), projectId)
      setJob(result)
      setJobError(undefined)
      setPending(undefined)
      setView((current) => current === 'form' ? 'job' : current)
    } catch (reason) {
      reportAccess(reason, true)
      pauseWrites(reason)
      if (reason instanceof ApiError && reason.code === 'REQUEST_IN_PROGRESS') {
        try {
          const found = await outlineGenerationApi.latest(projectId)
          if (found && shouldResume(found)) {
            setJob(confirmJob(found, projectId))
            setPending(undefined)
            setView((current) => current === 'form' ? 'job' : current)
            return
          }
        } catch (latest) { reportAccess(latest, true) }
      } else if (!isUncertain(reason) && !isRateLimited(reason)) {
        setPending(undefined)
        if (reason instanceof ApiError && reason.status === 422) await loadChoices()
      }
      setWriteError(reason)
    } finally { writeLock.current = false; setWrite(null) }
  }

  async function cancel() {
    if (!job || !active || job.cancelRequestedAt || cancelDeniedFor === job.id || retryUntil || writeLock.current) return
    writeLock.current = true
    setWrite('cancel')
    setWriteError(undefined)
    try {
      const next = confirmJob(await materialsApi.cancelJob(job.id), projectId)
      setJob((current) => current?.id === next.id && isActive(current) ? next : current)
    } catch (reason) {
      reportAccess(reason)
      pauseWrites(reason)
      setWriteError(reason)
      if (reason instanceof ApiError && reason.status === 403 && reason.code === 'FORBIDDEN') setCancelDeniedFor(job.id)
      else if (!isRateLimited(reason)) setReadAttempt((value) => value + 1)
    } finally { writeLock.current = false; setWrite(null) }
  }

  async function refresh() {
    if (writeLock.current || dirty) return
    writeLock.current = true
    setWrite('refresh')
    setJobError(undefined)
    try {
      if (job?.status === 'succeeded' && view === 'job') {
        const latest = confirmJob(await materialsApi.job(job.id), projectId)
        if (latest.id !== job.id || latest.status !== 'succeeded') throw new TransportError('invalid_response')
        setJob(latest)
        if (await refreshGenerated(latest)) setWriteError(undefined)
      } else if (await onGenerated()) setWriteError(undefined)
    } catch (reason) {
      setJobError(reason)
      reportAccess(reason)
    } finally { writeLock.current = false; setWrite(null) }
  }

  const hint = !enabled ? '현재 환경에서 AI 구성을 사용할 수 없어요' : dirty ? '변경 내용을 저장한 뒤 AI 구성을 만들 수 있어요' : undefined
  const busy = write !== null
  const freezeInput = busy || choicesLoading || Boolean(pending)
  const retryAfterConflict = isConflictError && <Button variant="secondary" disabled={dirty} loading={write === 'refresh'} onClick={() => void refresh()}>최신 구성 확인</Button>
  const canCancel = active && !job?.cancelRequestedAt && cancelDeniedFor !== job?.id

  return <>
    <Button disabled={!active && (!enabled || dirty)} aria-describedby={!active && hint ? hintId : undefined}
      variant={outlineHasItems || active ? 'secondary' : 'primary'}
      onClick={() => active ? setView('job') : openForm()}>
      {active ? '구성 생성 진행 보기' : 'AI로 구성 만들기'}
    </Button>
    {!active && hint && <span className={styles.note} id={hintId}>{hint}</span>}
    <div className={`${styles.dialogSlot} ${showProgress ? styles.progressDialog : ''}`}>
      <Modal size={view === 'job' ? 'confirm' : 'form'} open={Boolean(view)}
        title={showProgress ? '발표 구성을 만들고 있어요' : view === 'job' ? '발표 구성 생성 결과' : 'AI로 구성 만들기'}
        description={showProgress ? '자료의 핵심 내용을 순서대로 정리합니다.' : undefined}
        onClose={() => setView(null)} footer={view === 'job' ? <>
          <Button onClick={() => setView(null)}>닫기</Button>
          {canCancel && <Button variant="dangerOutline" disabled={Boolean(retryUntil)} loading={write === 'cancel'} onClick={() => void cancel()}>생성 취소</Button>}
          {job?.status === 'failed' && enabled && !dirty && <Button variant="secondary" onClick={openForm}>다시 생성</Button>}
        </> : <>
          <Button variant="secondary" onClick={() => setView(null)}>닫기</Button>
          {active ? <Button onClick={() => setView('job')}>진행 보기</Button> :
            <Button disabled={!selected.length || choicesLoading || dirty || isConflictError || Boolean(retryUntil)}
              loading={write === 'create'} onClick={() => void start()}>{pending ? '생성 요청 다시 확인' : '구성 만들기'}</Button>}
        </>}>
        {view === 'form' && <>
          {(outlineHasItems || job?.status === 'failed') && <p className={styles.note}>
            {job?.error?.code === 'JOB_INPUT_STALE' && '발표 구성이나 자료가 바뀌었어요. 최신 내용을 확인하고 다시 시도해 주세요. '}
            {outlineHasItems && '생성이 완료되면 저장된 발표 구성이 새 결과로 바뀝니다.'}
          </p>}
          <p className={styles.note}>선택한 자료의 제목과 일부 원문, 생성 지시가 AI 서비스에 전달됩니다.</p>
          <fieldset className={styles.choices} disabled={freezeInput}>
            <legend>발표에 사용할 자료 {selected.length}개 선택</legend>
            {choices?.items.map((item) => <label key={item.id}>
              <input type="checkbox" checked={selected.includes(item.id)}
                disabled={!selected.includes(item.id) && selected.length >= maxSources}
                onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))} />
              {item.title}
            </label>)}
            {choices && !choices.items.length && !choices.nextCursor && <p>선택할 수 있는 준비된 자료가 없어요</p>}
          </fieldset>
          {choicesLoading && <StatusPanel kind="loading" title="자료를 불러오고 있어요" />}
          {choicesError && <RequestError error={choicesError.reason} action={<Button variant="secondary" disabled={freezeInput}
            onClick={() => void loadChoices(choicesError.cursor)}>자료 다시 불러오기</Button>} />}
          {choices?.nextCursor && !choicesError && <Button variant="text" disabled={freezeInput || choicesLoading}
            onClick={() => void loadChoices(choices.nextCursor ?? undefined)}>자료 더 보기</Button>}
          <Field multiline label="생성 지시" description="선택 입력, 최대 1000자" maxLength={maxInstructions}
            rows={3} value={instructions} disabled={freezeInput} onChange={(event) => setInstructions(event.target.value)} />
          <RequestError error={writeError} action={retryAfterConflict} />
          {retryUntil && <p role="status" className={styles.note}>잠시 뒤 다시 시도할 수 있어요</p>}
          <RequestError error={jobError} />
        </>}
        {view === 'job' && job && <>
          {active && <div className={styles.details}>
            <p>자료 확인, 목차 구성, 근거 연결</p>
            <p role="status">{job.cancelRequestedAt ? '취소 요청을 확인하고 있어요' : `${job.status === 'queued' ? '생성 대기 중' : '생성 중'} ${job.progress}%`}</p>
            <progress className={styles.progress} max={100} value={job.progress} aria-label="발표 구성 생성 진행률" />
          </div>}
          {job.status === 'succeeded' && (resultWaiting || !jobError) && <p role="status">
            {resultWaiting ? '편집을 마치면 생성한 발표 구성을 불러올 수 있어요'
              : resultApplied ? '발표 구성을 만들었어요' : '생성한 발표 구성을 불러오고 있어요'}
          </p>}
          {completedResult === 'deferred' && !dirty && !jobError && <Button variant="secondary" loading={write === 'refresh'}
            onClick={() => void refresh()}>생성 결과 다시 불러오기</Button>}
          {job.status === 'failed' && <StatusPanel kind="error" title={job.error?.message || '발표 구성을 만들지 못했어요'} />}
          {job.status === 'canceled' && <p role="status">발표 구성 생성을 취소했어요</p>}
          <RequestError error={writeError} />
          {retryUntil && <p role="status" className={styles.note}>잠시 뒤 다시 시도할 수 있어요</p>}
          <RequestError error={jobError} action={
            <Button variant="secondary" disabled={active ? retryDelay(jobError) > 0 : dirty} loading={write === 'refresh'}
              onClick={() => active ? setReadAttempt((value) => value + 1) : void refresh()}>
              {active ? '진행 상태 다시 확인' : '생성 결과 다시 불러오기'}
            </Button>}
          />
        </>}
      </Modal>
    </div>
    {!view && job && !active && job.status !== 'canceled' && <Button variant="text" onClick={() => setView('job')}>생성 결과 보기</Button>}
  </>
}
