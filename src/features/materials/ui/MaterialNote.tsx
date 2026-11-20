import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react'
import { ApiError } from '../../../shared/api/client.ts'
import { Button } from '../../../shared/ui/Button.tsx'
import { Field } from '../../../shared/ui/Field.tsx'
import { RequestError } from '../../../shared/ui/RequestError.tsx'
import { useSession } from '../../../entities/session/sessionContext.ts'
import { materialsApi } from '../../../entities/material/api.ts'
import { isUncertain } from '../../../entities/material/errors.ts'
import { formatWhen, limits } from '../../../entities/material/model.ts'
import type { MaterialNote as Note } from '../../../entities/material/model.ts'
import styles from './Materials.module.css'

const Markdown = lazy(() => import('./Markdown.tsx'))

// 자료마다 하나인 팀 메모. 저장은 버전을 비교하고 충돌하면 내 입력을 남긴다
export function MaterialNote({ materialId, onDirtyChange, onError }: {
  materialId: string; onDirtyChange: (dirty: boolean) => void; onError: (reason: unknown) => void
}) {
  const { user } = useSession()
  const [note, setNote] = useState<Note | null>(null)
  const [error, setError] = useState<unknown>()
  const [revision, setRevision] = useState(0)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<unknown>()
  // 다른 사람이 먼저 저장한 최신 메모
  const [conflict, setConflict] = useState<Note | null>(null)
  const fieldId = useId()
  const area = () => document.getElementById(fieldId) as HTMLTextAreaElement | null
  const lock = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    void materialsApi.note(materialId, controller.signal).then((data) => {
      if (!controller.signal.aborted) { setNote(data); setError(undefined) }
    }).catch((reason) => { if (!controller.signal.aborted) { setError(reason); onError(reason) } })
    return () => controller.abort()
  }, [materialId, revision, onError])

  const dirty = editing && draft !== (conflict ?? note)?.markdown
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])
  useEffect(() => { if (editing) document.getElementById(fieldId)?.focus() }, [editing, fieldId])

  function done(next: Note) { setNote(next); setConflict(null); setEditing(false); setSaveError(undefined) }

  async function save(base: Note) {
    if (lock.current) return
    // 한글 조합이 끝난 실제 입력값을 읽는다
    const value = area()?.value ?? draft
    lock.current = true; setBusy(true); setSaveError(undefined)
    try {
      const saved = await materialsApi.saveNote(materialId, base.version, value)
      done({ materialId, markdown: value, version: saved.version, updatedBy: user?.id ?? null, updatedByName: user?.name ?? null, updatedAt: new Date().toISOString() })
    } catch (reason) {
      const conflicted = reason instanceof ApiError && reason.code === 'VERSION_CONFLICT'
      if (conflicted || isUncertain(reason)) {
        // 응답을 못 받았거나 충돌이면 다시 읽어 내 입력과 비교한다. 같으면 저장된 것이다
        const latest = await materialsApi.note(materialId).catch(() => null)
        if (latest?.markdown === value) { done(latest); return }
        if (latest && conflicted) { setConflict(latest); return }
      }
      setSaveError(reason); onError(reason)
    } finally { lock.current = false; setBusy(false) }
  }

  if (error && !note) return <section className={styles.note} aria-label="팀 메모"><h3 className={styles.sectionTitle}>팀 메모</h3>
    <RequestError error={error} action={<Button variant="text" onClick={() => setRevision((value) => value + 1)}>다시 불러오기</Button>} /></section>
  if (!note) return <section className={styles.note} aria-label="팀 메모"><h3 className={styles.sectionTitle}>팀 메모</h3><p className={styles.noteAuthor} role="status">팀 메모를 불러오고 있어요</p></section>

  const author = note.updatedAt ? [note.updatedByName, formatWhen(note.updatedAt)].filter(Boolean).join(' · ') : ''
  return <section className={styles.note} aria-label="팀 메모">
    <div className={styles.sectionHeader}>
      <h3 className={styles.sectionTitle}>팀 메모</h3>
      {!editing && <Button variant="text" onClick={() => { setDraft(note.markdown); setEditing(true) }}>{note.version === 0 ? '메모 작성' : '메모 수정'}</Button>}
    </div>
    {!editing && (note.markdown.trim()
      ? <div className={styles.noteBody}><Suspense fallback={<p className={styles.plain}>{note.markdown}</p>}><Markdown>{note.markdown}</Markdown></Suspense></div>
      : <p className={styles.noteBody}>아직 팀 메모가 없어요.</p>)}
    {!editing && author && <p className={styles.noteAuthor}>{author}</p>}
    {editing && <>
      <Field id={fieldId} label="팀 메모 내용" multiline rows={4} maxLength={limits.note} value={draft} disabled={busy}
        description="마크다운으로 쓸 수 있어요. 저장하면 팀원 모두에게 보여요" onChange={(event) => setDraft(event.target.value)} />
      {conflict && <div className={styles.conflict} role="alert">
        <p>{conflict.updatedByName ?? '다른 팀원'}님이 먼저 저장했어요. 내 입력은 그대로 있어요</p>
        <p className={styles.plain}>{conflict.markdown || '내용 없음'}</p>
        <div className={styles.actions}>
          <Button loading={busy} onClick={() => void save(conflict)}>내 내용으로 저장</Button>
          <Button variant="secondary" disabled={busy} onClick={() => { setDraft(conflict.markdown); setNote(conflict); setConflict(null) }}>최신 내용으로 바꾸기</Button>
        </div>
      </div>}
      <RequestError error={saveError} />
      {!conflict && <div className={styles.actions}>
        <Button loading={busy} disabled={!dirty} onClick={() => void save(note)}>저장</Button>
        <Button variant="secondary" disabled={busy} onClick={() => { setEditing(false); setConflict(null); setSaveError(undefined) }}>취소</Button>
      </div>}
    </>}
  </section>
}
