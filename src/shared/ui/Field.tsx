import { useId } from 'react'
import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'
import styles from './Field.module.css'

type FieldLabels = {
  label: string
  description?: string
  error?: string
}

type Props = FieldLabels & (
  | (InputHTMLAttributes<HTMLInputElement> & { multiline?: false })
  | (TextareaHTMLAttributes<HTMLTextAreaElement> & { multiline: true })
)

export function Field(props: Props) {
  const { label, description, error, id } = props
  const autoId = useId()
  const inputId = id ?? autoId
  const descriptionId = description ? `${inputId}-description` : undefined
  const errorId = error ? `${inputId}-error` : undefined

  const controlProps = {
    id: inputId,
    'aria-invalid': error ? true as const : undefined,
    'aria-describedby': [descriptionId, errorId].filter(Boolean).join(' ') || undefined,
  }
  const control = (() => {
    if (props.multiline) {
      const { label: _label, description: _description, error: _error, multiline: _multiline, ...rest } = props
      return <textarea {...rest} {...controlProps} className={styles.textarea} />
    }
    const { label: _label, description: _description, error: _error, multiline: _multiline, ...rest } = props
    return <input {...rest} {...controlProps} className={styles.input} />
  })()

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      {control}
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
