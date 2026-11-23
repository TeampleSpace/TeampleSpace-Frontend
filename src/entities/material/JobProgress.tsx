import type { Job } from './model.ts'
import styles from './JobProgress.module.css'

// 진행 중인 생성 작업의 상태와 진행률. 상태가 바뀔 때만 알리고 숫자 변화는 알리지 않는다
export function JobProgress({ job, label }: { job: Job; label: string }) {
  const status = job.cancelRequestedAt ? '취소 요청을 확인하고 있어요'
    : job.status === 'queued' ? '생성 순서를 기다리고 있어요' : '생성하고 있어요'
  // 진행률을 아직 모르면 값 없이 두어 움직이는 막대로 보여 준다
  const value = job.status === 'running' && job.progress > 0 ? job.progress : undefined
  return <div className={styles.progress}>
    <p className={styles.row}>
      <span role="status">{status}</span>
      {value !== undefined && <span className={styles.percent}>{value}%</span>}
    </p>
    <progress max={100} value={value} aria-label={label} />
  </div>
}
