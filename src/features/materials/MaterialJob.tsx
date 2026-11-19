import { useRef, useState } from 'react'
import { Button } from '../../shared/ui/Button.tsx'
import { RequestError } from '../../shared/ui/RequestError.tsx'
import { materialsApi } from './api.ts'
import type { Material } from './model.ts'
import styles from './Materials.module.css'

export function MaterialJob({ material, onChanged, onError }: {
  material: Material; onChanged: (material: Material) => void; onError: (reason: unknown) => void
}) {
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [requested, setRequested] = useState(false)
  const [error, setError] = useState<unknown>()
  const job = material.job
  if (!job || material.status !== 'processing') return null
  const canceling = requested || Boolean(job.cancelRequestedAt)
  async function check() {
    onChanged(await materialsApi.get(material.id))
  }
  async function cancel() {
    if (!job || lock.current || canceling) return
    lock.current = true; setBusy(true); setError(undefined)
    try {
      const result = await materialsApi.cancelJob(job.id)
      setRequested(Boolean(result.cancelRequestedAt) || result.status === 'canceled')
      await check()
    } catch (reason) {
      setError(reason); onError(reason)
      // 응답이 끊겼어도 취소가 반영됐을 수 있다
      try {
        const result = await materialsApi.job(job.id)
        if (result.cancelRequestedAt || result.status === 'canceled') {
          setRequested(true); setError(undefined); await check()
        }
      } catch (latest) { onError(latest) }
    } finally { lock.current = false; setBusy(false) }
  }
  return <div>
    <p className={styles.info}>{canceling ? '취소 요청을 확인하고 있어요' : `${job.status === 'queued' ? '분석 대기 중' : '분석 중'} ${job.progress}%`}</p>
    <p className={styles.info}>분석 요청자와 프로젝트 소유자가 취소할 수 있어요</p>
    <RequestError error={error} />
    <div className={styles.actions}><Button variant="secondary" loading={busy} disabled={canceling} onClick={() => void cancel()}>분석 취소</Button></div>
  </div>
}
