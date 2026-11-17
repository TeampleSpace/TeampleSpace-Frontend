import type { ReactNode } from 'react'
import styles from './StatusPanel.module.css'

type Props = {
  kind: 'loading' | 'empty' | 'error'
  title: string
  description?: string
  // 오류 진단에 쓰는 요청 식별자
  requestId?: string
  action?: ReactNode
}

// 로딩, 빈 상태, 오류를 같은 틀로 표시한다
export function StatusPanel({
  kind,
  title,
  description,
  requestId,
  action,
}: Props) {
  return (
    <div
      className={[styles.panel, styles[kind]].join(' ')}
      role={kind === 'error' ? 'alert' : kind === 'loading' ? 'status' : undefined}
    >
      {kind === 'loading' && (
        <span className={styles.spinner} aria-hidden="true" />
      )}
      <p className={styles.title}>{title}</p>
      {description && <p className={styles.description}>{description}</p>}
      {requestId && <p className={styles.meta}>요청 번호 {requestId}</p>}
      {action}
    </div>
  )
}
