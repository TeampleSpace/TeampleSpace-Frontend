import { useEffect, useRef, useState } from 'react'
import { TransportError } from '../../shared/api/client.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { Modal } from '../../shared/ui/Modal.tsx'
import { RequestError } from '../../shared/ui/RequestError.tsx'
import { useSession } from '../auth/sessionContext.ts'
import { materialsApi } from './api.ts'
import { isAccessLoss, isGone, isUncertain } from './errors.ts'
import type { Job, Material } from './model.ts'
import styles from './Materials.module.css'

function inProgress(job?: Job | null) {
  return job?.status === 'queued' || job?.status === 'running'
}

export function MaterialAiSummary({ material, onChanged, onError, onGone }: {
  material: Material; onChanged: (material: Material) => void; onError: (reason: unknown) => void
  onGone: (id: string, revisionId: string, reason: unknown) => void
}) {
  const { capabilities } = useSession()
  const enabled = capabilities?.featureFlags.materialSummary === true
  const revisionId = material.currentRevision?.id
  const [accepted, setAccepted] = useState<Job>()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const [pollError, setPollError] = useState<unknown>()
  const [attempt, setAttempt] = useState(0)
  const key = useRef<string | undefined>(undefined)
  const lock = useRef(false)
  const job = accepted ?? material.summaryJob
  const activeId = inProgress(job) ? job?.id : undefined
  const pollId = accepted?.id ?? activeId

  useEffect(() => {
    if (!pollId || !revisionId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    async function check() {
      let delay = 2000
      try {
        const latest = await materialsApi.get(material.id, controller.signal)
        if (controller.signal.aborted) return
        if (latest.status === 'ready' && latest.currentRevision?.id === revisionId && !latest.summaryJob && !latest.currentRevision?.summary) {
          throw new TransportError('invalid_response')
        }
        setPollError(undefined)
        onChanged(latest)
        setAccepted(undefined)
        if (latest.currentRevision?.id !== revisionId || latest.summaryJob?.id !== pollId || !inProgress(latest.summaryJob)) return
      } catch (reason) {
        if (controller.signal.aborted) return
        if (isGone(reason)) {
          onGone(material.id, revisionId, reason)
          return
        }
        onError(reason)
        setPollError(reason)
        if (isAccessLoss(reason)) return
        delay = 4000
      }
      timer = setTimeout(() => void check(), delay)
    }
    void check()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [pollId, attempt, material.id, onChanged, onError, onGone, revisionId])

  async function submit() {
    if (lock.current || !revisionId || !enabled || activeId) return
    lock.current = true
    key.current ??= crypto.randomUUID()
    setBusy(true)
    setError(undefined)
    try {
      const queued = await materialsApi.summarize(material.id, revisionId, key.current)
      if (queued.type !== 'material_summary' || queued.targetType !== 'material_summary' || queued.targetId !== revisionId) {
        throw new TransportError('invalid_response')
      }
      setAccepted(queued)
      setPollError(undefined)
      key.current = undefined
      setOpen(false)
    } catch (reason) {
      if (!isUncertain(reason)) key.current = undefined
      onError(reason)
      setError(reason)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  const summary = material.currentRevision?.summary
  const failed = job?.status === 'failed' || job?.status === 'canceled'
  const close = () => { if (!busy) setOpen(false) }
  return <section className={styles.section}>
    <div className={styles.sectionHeader}>
      <h3 className={styles.sectionTitle}>AI 요약</h3>
      {!summary && enabled && !activeId && <Button variant="secondary" onClick={() => { setError(undefined); setOpen(true) }}>
        {failed ? '요약 다시 요청' : 'AI 요약 만들기'}
      </Button>}
    </div>
    {summary ? <p className={styles.plain}>{summary}</p> : activeId ? <p role="status" className={styles.listNote}>
      {job?.status === 'queued' ? '요약 대기 중' : 'AI 요약 중'}
    </p> : failed ? <p role="alert" className={styles.listNote}>
      {job?.status === 'canceled' ? '요약이 취소됐어요.' : job?.error?.message ?? '요약을 만들지 못했어요.'}
    </p> : <p className={styles.listNote}>{enabled ? '아직 요약이 없어요.' : '이 환경에서는 AI 요약을 만들 수 없어요.'}</p>}
    <RequestError error={pollError} action={<Button variant="text" onClick={() => setAttempt((value) => value + 1)}>상태 다시 확인</Button>} />
    <Modal open={open} size="confirm" title="자료를 AI로 요약할까요?"
      description="이 자료의 제목과 원문 일부가 AI 서비스로 전달돼요." onClose={close}
      footer={<><Button variant="secondary" disabled={busy} onClick={close}>취소</Button>
        <Button loading={busy} onClick={() => void submit()}>요약 요청</Button></>}>
      <RequestError error={error} />
    </Modal>
  </section>
}
