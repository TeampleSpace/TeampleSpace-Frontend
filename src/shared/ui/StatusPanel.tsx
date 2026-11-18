import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from './Button.tsx'
import styles from './StatusPanel.module.css'

type Props = {
  kind: 'loading' | 'empty' | 'error'
  title: string
  description?: string
  // 오류 진단에 쓰는 요청 식별자
  requestId?: string
  action?: ReactNode
}

// 오류는 간결한 안내로, 로딩과 빈 상태는 가운데 안내로 표시한다
export function StatusPanel({
  kind,
  title,
  description,
  requestId,
  action,
}: Props) {
  const detailsId = useId()
  const [detailsOpen, setDetailsOpen] = useState(false)

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
      {(action || requestId) && (
        <div className={styles.actions}>
          {action}
          {requestId && (
            <Button
              variant="text"
              aria-expanded={detailsOpen}
              aria-controls={detailsId}
              onClick={() => setDetailsOpen((open) => !open)}
            >
              상세 정보
            </Button>
          )}
        </div>
      )}
      {requestId && (
        <p id={detailsId} className={styles.meta} hidden={!detailsOpen}>
          요청 번호 {requestId}
        </p>
      )}
    </div>
  )
}
