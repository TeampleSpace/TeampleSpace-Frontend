import type { ButtonHTMLAttributes } from 'react'
import styles from './Button.module.css'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  // 주요와 삭제는 44px, 보조와 텍스트는 40px 높이다
  variant?: 'primary' | 'secondary' | 'text' | 'danger'
  loading?: boolean
}

export function Button({
  variant = 'primary',
  loading = false,
  className,
  onClick,
  children,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      {...rest}
      className={[styles.button, styles[variant], className]
        .filter(Boolean)
        .join(' ')}
      // 진행 중에는 포커스를 유지한 채 중복 실행만 막는다
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      // 제출 버튼이면 폼의 기본 제출도 함께 막는다. 입력란에서 Enter를 눌러도 이 클릭을 거친다
      onClick={loading ? (event) => event.preventDefault() : onClick}
    >
      {loading && <span className={styles.spinner} aria-hidden="true" />}
      {children}
    </button>
  )
}
