import { useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { ApiError, TransportError } from '../../../shared/api/client.ts'
import { Button } from '../../../shared/ui/Button.tsx'
import { Modal } from '../../../shared/ui/Modal.tsx'
import { RequestError } from '../../../shared/ui/RequestError.tsx'
import { StatusPanel } from '../../../shared/ui/StatusPanel.tsx'
import { useSession } from '../../../entities/session/sessionContext.ts'
import { materialsApi } from '../../../entities/material/api.ts'
import { isAccessLoss, isGone, isUncertain } from '../../../entities/material/errors.ts'
import type { Job } from '../../../entities/material/model.ts'
import { outlineApi } from '../../outline/api.ts'
import { designApi } from '../../design/api.ts'
import type { DesignSettings } from '../../design/api.ts'
import { presentationGenerationApi, presentationResultSchema } from '../api.ts'
import { needsApproval, requestsApi, useRequestApproved } from '../../../entities/request/api.ts'
import type { GenerationRequest } from '../api.ts'
import styles from './PresentationGeneration.module.css'

type Props = {
  projectId: string
  projectName?: string
  onCompleted?: () => Promise<void> | void
  // 버튼을 놓을 자리를 정한다. 모달은 버튼이 사라져도 계속 보인다
  children?: (trigger: ReactNode) => ReactNode
}

type Page = 'outline' | 'design' | 'slides'
type Summary = {
  request: GenerationRequest
  items: number
  design?: string
  blocker?: { message: string; page: Page }
}

const maxSources = 20

function isActive(job: Job | undefined) {
  return job?.status === 'queued' || job?.status === 'running'
}

function confirmJob(job: Job, projectId: string) {
  if (job.type !== 'presentation_generation' || job.projectId?.toLowerCase() !== projectId.toLowerCase()) {
    throw new TransportError('invalid_response')
  }
  return job
}

function blockerOf(items: number, deleted: boolean, sources: number, design: DesignSettings): Summary['blocker'] {
  if (!items) return { message: '발표 구성을 먼저 저장해 주세요', page: 'outline' }
  if (deleted) return { message: '삭제된 근거 자료가 발표 구성에 연결되어 있어요. 근거를 다시 골라 주세요', page: 'outline' }
  if (!sources) return { message: '발표 구성에 근거 자료를 하나 이상 연결해 주세요', page: 'outline' }
  if (sources > maxSources) return { message: `근거 자료는 ${maxSources}개까지 쓸 수 있어요. 발표 구성에서 연결한 자료를 줄여 주세요`, page: 'outline' }
  if (design.mode === 'unset') return { message: '디자인을 먼저 저장해 주세요', page: 'design' }
}

export default function PresentationGeneration(props: Props) {
  return <Generation key={props.projectId} {...props} />
}

function Generation({ projectId, projectName, onCompleted, children }: Props) {
  const { capabilities } = useSession()
  const enabled = capabilities?.featureFlags.presentationGeneration === true
  const navigate = useNavigate()
  const hintId = useId()
  const [view, setView] = useState<'confirm' | 'job' | 'cancel' | null>(null)
  const [summary, setSummary] = useState<Summary>()
  const [summaryError, setSummaryError] = useState<unknown>()
  const [loading, setLoading] = useState(false)
  const [job, setJob] = useState<Job>()
  const [jobError, setJobError] = useState<unknown>()
  const [writeError, setWriteError] = useState<unknown>()
  // request는 팀원 승인을 받아 실행하는지다. 정하기 전이면 비워 둔다
  const [pending, setPending] = useState<{ body: GenerationRequest; key: string; request?: boolean }>()
  const [write, setWrite] = useState<'create' | 'cancel' | null>(null)
  const [readAttempt, setReadAttempt] = useState(0)
  const writeLock = useRef(false)
  const finished = useRef<string>(undefined)

  const active = isActive(job)
  const activeJobId = active ? job?.id : undefined
  const succeeded = job?.status === 'succeeded'
  const failed = job?.status === 'failed'

  // 다시 들어오면 진행 중이거나 끝난 작업을 이어서 보여 준다
  const resume = useEffectEvent((found: Job) => {
    if (isActive(found) || found.status === 'succeeded') setJob((current) => current ?? found)
  })
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    void presentationGenerationApi.latest(projectId, controller.signal).then((found) => {
      if (!controller.signal.aborted && found) resume(confirmJob(found, projectId))
    }).catch(() => {
      // 이어 볼 작업을 찾지 못해도 새로 만들 수 있다
    })
    return () => controller.abort()
  }, [enabled, projectId])

  // 다른 팀원이 승인해 시작한 작업을 이어서 보여 준다
  useRequestApproved(projectId, 'presentation_generation', (request) => {
    if (!enabled || !request.result || !('jobId' in request.result)) return
    void materialsApi.job(request.result.jobId).then((found) => {
      const entry = confirmJob(found, projectId)
      if (isActive(entry) || entry.status === 'succeeded') setJob((current) => isActive(current) ? current : entry)
    }).catch(() => {
      // 다시 들어오면 최근 작업으로 이어서 보여 준다
    })
  })

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
        // 취소 응답보다 늦게 온 조회가 완료나 취소 표시를 되돌리지 않는다
        setJob((current) => current?.id !== latest.id || !isActive(current)
          || (current.cancelRequestedAt && !latest.cancelRequestedAt && isActive(latest)) ? current : latest)
        setJobError(undefined)
        if (!isActive(latest)) return
      } catch (reason) {
        if (controller.signal.aborted) return
        setJobError(reason)
        if (isAccessLoss(reason) || isGone(reason)) return
        delay = 4000
      }
      timer = setTimeout(() => void check(jobId), delay)
    }
    void check(id)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [activeJobId, projectId, readAttempt])

  // 만든 문서를 불러온다. 실패하면 완료 안내에서 다시 불러올 수 있다
  async function complete(done: Job) {
    finished.current = done.id
    const result = presentationResultSchema.safeParse(done.resultRef)
    if (!result.success || result.data.projectId.toLowerCase() !== projectId.toLowerCase()) {
      setJobError(new TransportError('invalid_response'))
      return
    }
    setJobError(undefined)
    try { await onCompleted?.() } catch (reason) { setJobError(reason) }
  }
  const finish = useEffectEvent((done: Job) => {
    if (finished.current !== done.id) void complete(done)
  })
  useEffect(() => {
    const done = job?.status === 'succeeded' ? job : undefined
    if (done) void Promise.resolve().then(() => finish(done))
  }, [job])

  async function loadSummary() {
    setLoading(true)
    setSummary(undefined)
    setSummaryError(undefined)
    try {
      const [outline, design, catalog] = await Promise.all([
        outlineApi.get(projectId), designApi.get(projectId), designApi.catalog().catch(() => undefined),
      ])
      const refs = outline.items.flatMap((item) => item.sourceRefs)
      const sourceIds = [...new Set(refs.filter((ref) => !ref.sourceDeleted).map((ref) => ref.materialId))]
      setSummary({
        request: { outlineVersion: outline.version, designVersion: design.version, sourceIds },
        items: outline.items.length,
        design: design.mode === 'template'
          ? catalog?.items.find((item) => item.id === design.templateId)?.name ?? '저장한 템플릿'
          : design.mode === 'custom' ? design.custom.name : undefined,
        blocker: blockerOf(outline.items.length, refs.some((ref) => ref.sourceDeleted), sourceIds.length, design),
      })
    } catch (reason) {
      setSummaryError(reason)
    } finally { setLoading(false) }
  }

  function open() {
    setView('confirm')
    setWriteError(undefined)
    if (!pending) void loadSummary()
  }

  function goTo(page: Page) {
    setView(null)
    navigate(`/projects/${projectId}/${page}`)
  }

  async function start() {
    if (writeLock.current || !summary || summary.blocker || !enabled) return
    let command = pending ?? { body: summary.request, key: crypto.randomUUID() }
    setPending(command)
    writeLock.current = true
    setWrite('create')
    setWriteError(undefined)
    try {
      if (command.request === undefined) setPending(command = { ...command, request: await needsApproval(projectId) })
      if (command.request) {
        await requestsApi.create(projectId, 'presentation_generation', command.body, command.key)
        setPending(undefined)
        setView(null)
        return
      }
      const created = confirmJob(await presentationGenerationApi.create(projectId, command.body, command.key), projectId)
      setPending(undefined)
      setJob(created)
      setJobError(undefined)
      setView('job')
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === 'REQUEST_IN_PROGRESS' && !command.request) {
        const found = await presentationGenerationApi.latest(projectId).catch(() => undefined)
        if (found && isActive(found) && found.projectId?.toLowerCase() === projectId.toLowerCase()) {
          setPending(undefined)
          setJob(found)
          setView('job')
          return
        }
      }
      // 같은 종류의 승인 요청이 이미 기다리면 결과가 정해진 것이라 다음에는 최신 구성과 디자인으로 다시 만든다
      const waiting = command.request && reason instanceof ApiError && reason.code === 'REQUEST_IN_PROGRESS'
      if (!isUncertain(reason) || waiting) {
        setPending(undefined)
        // 구성이나 디자인이 바뀌었으면 최신 내용으로 다시 보여 준다
        if (reason instanceof ApiError && (reason.code === 'VERSION_CONFLICT' || reason.status === 422)) void loadSummary()
      }
      setWriteError(reason)
    } finally { writeLock.current = false; setWrite(null) }
  }

  async function cancel() {
    if (!job || !active || writeLock.current) return
    writeLock.current = true
    setWrite('cancel')
    setWriteError(undefined)
    try {
      const next = confirmJob(await materialsApi.cancelJob(job.id), projectId)
      setJob((current) => current?.id === next.id && isActive(current) ? next : current)
    } catch (reason) {
      setWriteError(reason)
      setReadAttempt((value) => value + 1)
    } finally {
      writeLock.current = false
      setWrite(null)
      setView('job')
    }
  }

  const hint = enabled ? undefined : '현재 환경에서 PPT 생성을 사용할 수 없어요'
  const showJob = active || succeeded
  const trigger = <span className={styles.trigger}>
    <Button variant={showJob ? 'secondary' : 'primary'} disabled={!showJob && Boolean(hint)}
      aria-describedby={!showJob && hint ? hintId : undefined} onClick={() => showJob ? setView('job') : open()}>
      {active ? '생성 진행 보기' : succeeded ? '생성 결과 보기' : 'PPT 만들기'}
    </Button>
    {!showJob && hint && <span className={styles.note} id={hintId}>{hint}</span>}
  </span>
  const regenerationBlocked = writeError instanceof ApiError && writeError.code === 'REGENERATION_NOT_ENABLED'
  const itemLabel = summary ? `발표 구성 ${summary.items}장` : '발표 구성'
  const steps = job && [
    { label: `${itemLabel} 확인`, state: 'done' },
    { label: '자료의 핵심 내용과 출처 연결', state: succeeded ? 'done' : job.status === 'running' ? 'current' : 'waiting' },
    { label: '슬라이드 배치 정리', state: succeeded ? 'done' : 'waiting' },
  ]

  return <>
    {children ? children(trigger) : trigger}
    <Modal open={view === 'confirm'} size="form" title="PPT 초안 만들기"
      description="검토한 발표 구성과 근거 자료로 초안을 만듭니다." onClose={() => setView(null)}
      footer={<>
        <Button variant="secondary" onClick={() => goTo('design')}>디자인 다시 보기</Button>
        <Button disabled={!summary || Boolean(summary.blocker) || !enabled} loading={write === 'create'}
          onClick={() => void start()}>{pending ? '생성 요청 다시 확인' : '초안 생성'}</Button>
      </>}>
      {loading && <StatusPanel kind="loading" title="발표 구성과 디자인을 확인하고 있어요" />}
      <RequestError error={summaryError} action={<Button variant="secondary" onClick={() => void loadSummary()}>다시 확인</Button>} />
      {summary && <div className={styles.summary}>
        {projectName && <h3>{projectName}</h3>}
        {summary.items > 0 && <>
          <p>{itemLabel}, 표지와 정리를 더해 {summary.items + 2}장</p>
          <p>연결된 근거 자료 {summary.request.sourceIds.length}개, 본문 아래에 출처 표시</p>
        </>}
        <p className={styles.label}>선택한 디자인</p>
        <p className={styles.design}>{summary.design ?? '저장한 디자인 없음'}</p>
      </div>}
      {summary?.blocker && <StatusPanel kind="error" title={summary.blocker.message} action={
        <Button variant="secondary" onClick={() => goTo(summary.blocker!.page)}>
          {summary.blocker.page === 'outline' ? '발표 구성으로' : '디자인 설정으로'}
        </Button>} />}
      <p className={styles.note}>근거 자료의 제목과 일부 원문, 디자인 지침이 AI 서비스에 전달돼요. 생성 후에도 내용을 직접 편집할 수 있어요.</p>
      <RequestError error={writeError} action={regenerationBlocked
        ? <Button variant="secondary" onClick={() => goTo('slides')}>만든 PPT 보기</Button> : undefined} />
    </Modal>
    <div className={`${styles.slot} ${active ? styles.running : succeeded ? styles.done : ''}`}>
      <Modal open={view === 'job' && Boolean(job)} size={showJob ? 'form' : 'dialog'}
        title={active ? '발표자료를 만들고 있어요' : succeeded ? '발표자료가 완성됐어요' : failed ? '발표자료를 완성하지 못했어요' : '생성을 취소했어요'}
        description={active ? '발표 흐름에 맞게 내용을 배치하고 출처를 연결합니다.' : succeeded ? '초안과 연결된 출처를 준비했어요.'
          : failed ? '자료와 설정은 그대로 남아 있습니다.' : '취소한 초안은 저장되지 않았어요.'}
        onClose={() => setView(null)}
        footer={active ? <>
          <Button variant="secondary" disabled={Boolean(job?.cancelRequestedAt)} onClick={() => setView('cancel')}>생성 취소</Button>
          <Button disabled>생성 중</Button>
        </> : succeeded ? <>
          <Button variant="secondary" onClick={() => goTo('outline')}>발표 구성으로</Button>
          <Button onClick={() => goTo('slides')}>생성 결과 보기</Button>
        </> : <>
          <Button disabled={!enabled} onClick={open}>다시 생성</Button>
          <Button variant="secondary" onClick={() => goTo('design')}>설정 확인</Button>
        </>}>
        {showJob && steps && <ol className={styles.steps}>
          {steps.map((step) => <li key={step.label} data-state={step.state}>
            {step.label}{step.state === 'done' ? ' 완료' : step.state === 'current' ? ' 중' : ''}
          </li>)}
        </ol>}
        {active && <p role="status" className={styles.note}>
          {job?.cancelRequestedAt ? '취소 요청을 확인하고 있어요. ' : job?.status === 'queued' ? '생성 순서를 기다리고 있어요. ' : ''}
          이 창을 닫아도 생성은 계속돼요.
        </p>}
        {succeeded && <p className={styles.note}>팀원과 함께 확인하고 수정할 수 있어요.</p>}
        {failed && <p>{job?.error?.message || '잠시 후 다시 시도해 주세요.'}</p>}
        <RequestError error={writeError} />
        <RequestError error={jobError} action={active
          ? <Button variant="secondary" onClick={() => setReadAttempt((value) => value + 1)}>진행 상태 다시 확인</Button>
          : succeeded && job ? <Button variant="secondary" onClick={() => void complete(job)}>결과 다시 불러오기</Button> : undefined} />
      </Modal>
    </div>
    <Modal open={view === 'cancel'} size="confirm" title="생성을 취소할까요?" description="취소된 초안은 저장되지 않습니다."
      onClose={() => setView('job')} footer={<>
        <Button onClick={() => setView('job')}>생성 계속</Button>
        <Button variant="secondary" loading={write === 'cancel'} onClick={() => void cancel()}>취소하기</Button>
      </>} />
  </>
}
