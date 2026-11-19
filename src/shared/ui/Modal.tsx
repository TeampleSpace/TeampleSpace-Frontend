import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { Button } from './Button.tsx'
import styles from './Modal.module.css'

type Props = {
  open: boolean
  title: string
  description?: string
  size?: 'dialog' | 'confirm' | 'form' | 'team' | 'invite'
  minHeight?: number
  onClose: () => void
  children?: ReactNode
  footer?: ReactNode
}

// ponytail: 브라우저 기본 dialog 사용. 포커스 가두기, 배경 비활성, Esc, 포커스 복귀를 기본 동작에 맡긴다.
// 원문 팝업처럼 겹치는 오버레이의 복귀 문맥이 필요해지면 Radix 도입을 검토한다
export function Modal({
  open,
  title,
  description,
  size = 'dialog',
  minHeight,
  onClose,
  children,
  footer,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      // 기본 선택으로 표시한 요소가 있으면 그곳으로 포커스를 옮긴다
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    }
    if (open && !dialog.contains(document.activeElement)) {
      dialog.querySelector<HTMLElement>('[data-autofocus], button, a[href], input, textarea')?.focus()
    }
    if (!open && dialog.open) dialog.close()
  }, [open, title])

  const descriptionText = description && (
    <p id={descriptionId} className={styles.description}>
      {description}
    </p>
  )

  return (
    <dialog
      ref={ref}
      className={[styles.dialog, styles[size]].join(' ')}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        // 배경을 누르면 닫는다
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={styles.panel} style={minHeight ? { minHeight: `min(${minHeight}px, calc(100dvh - 32px))` } : undefined}>
        <header className={styles.header}>
          <div className={styles.titles}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {/* 입력 모달은 설명을 제목 바로 아래에 둔다 */}
            {(size === 'form' || size === 'invite') && descriptionText}
          </div>
          <Button variant="text" onClick={onClose}>
            닫기
          </Button>
        </header>
        {size !== 'form' && size !== 'invite' && descriptionText}
        {children && <div className={styles.content}>{children}</div>}
        {footer && <footer className={styles.footer} style={minHeight ? { marginTop: 'auto' } : undefined}>{footer}</footer>}
      </div>
    </dialog>
  )
}
