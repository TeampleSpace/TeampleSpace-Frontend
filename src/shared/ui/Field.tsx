import { useId } from 'react'
import type { InputHTMLAttributes } from 'react'
import styles from './Field.module.css'

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  description?: string
  error?: string
}

export function Field({ label, description, error, id, ...rest }: Props) {
  const autoId = useId()
  const inputId = id ?? autoId
  const descriptionId = description ? `${inputId}-description` : undefined
  const errorId = error ? `${inputId}-error` : undefined

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      <input
        {...rest}
        id={inputId}
        className={styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [descriptionId, errorId].filter(Boolean).join(' ') || undefined
        }
      />
      {description && (
        <p id={descriptionId} className={styles.description}>
          {description}
        </p>
      )}
      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  )
}
