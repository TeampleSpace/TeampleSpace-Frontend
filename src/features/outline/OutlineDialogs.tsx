import { useId } from 'react'
import { Button } from '../../shared/ui/Button.tsx'
import { Field } from '../../shared/ui/Field.tsx'
import { Modal } from '../../shared/ui/Modal.tsx'
import { RequestError } from '../../shared/ui/RequestError.tsx'
import type { OutlineFields } from './model.ts'
import { outlineLimits } from './model.ts'
import styles from './Outline.module.css'

type Props = {
  fields: OutlineFields
  editing: boolean
  busy: boolean
  blocked: boolean
  recovering: boolean
  error: unknown
  titleError?: string
  summaryError?: string
  feedback?: React.ReactNode
  evidence?: () => void
  onChange: (key: keyof OutlineFields, value: string) => void
  onSave: () => void
  onDelete: () => void
  onClose: () => void
}

export function OutlineEditDialog({ fields, editing, busy, blocked, recovering, error, titleError, summaryError, feedback,
  evidence, onChange, onSave, onDelete, onClose }: Props) {
  const formId = useId()
  return <Modal open size="confirm" title={editing ? '발표 내용 수정' : '목차 추가'} onClose={onClose}>
    <form className={styles.form} id={formId} onSubmit={(event) => { event.preventDefault(); onSave() }}>
      <Field label="슬라이드 제목" value={fields.title} maxLength={outlineLimits.title} error={titleError}
        data-autofocus disabled={busy} onChange={(event) => onChange('title', event.target.value)} />
      <Field label="핵심 주장" value={fields.claim} maxLength={outlineLimits.summary}
        disabled={busy} onChange={(event) => onChange('claim', event.target.value)} />
      <Field label="발표 내용" multiline rows={2} value={fields.content} error={summaryError}
        maxLength={outlineLimits.summary} disabled={busy} onChange={(event) => onChange('content', event.target.value)} />
      {!feedback && <RequestError error={error} />}
      {recovering && <p>다시 저장하면 이전 요청의 결과를 먼저 확인해요.</p>}
      {feedback}
      <div className={styles.actions}>
        <Button type="submit" loading={busy} disabled={blocked}>{editing ? '저장' : '목차 추가'}</Button>
        <Button variant="secondary" onClick={onClose} disabled={busy}>취소</Button>
      </div>
      {editing && <div className={styles.actions}>
        {evidence && <Button variant="text" onClick={evidence} disabled={busy || blocked}>근거 자료</Button>}
        <Button variant="text" onClick={onDelete} disabled={busy || blocked || recovering}>목차 삭제</Button>
      </div>}
    </form>
  </Modal>
}
