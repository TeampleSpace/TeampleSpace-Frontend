import { useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import { Button } from '../../../shared/ui/Button.tsx'
import { Field } from '../../../shared/ui/Field.tsx'
import { RequestError } from '../../../shared/ui/RequestError.tsx'
import { useSession } from '../../../entities/session/sessionContext.ts'
import { materialsApi } from '../../../entities/material/api.ts'
import { isUncertain } from '../../../entities/material/errors.ts'
import { formatWhen, limits } from '../../../entities/material/model.ts'
import type { MaterialComment, MaterialNote } from '../../../entities/material/model.ts'
import styles from './Materials.module.css'

// ponytail: 5초마다 새 댓글을 읽는다. 자료 화면이 이벤트 구독을 열면 그때 바꾼다
export const commentRefreshMs = 5000

// 자료에 팀원이 짧게 남기는 메모. 예전에 함께 쓰던 팀 메모가 있으면 맨 위에 보여 준다
export function TeamComments({ materialId, onDirtyChange, onError }: {
  materialId: string; onDirtyChange: (dirty: boolean) => void; onError: (reason: unknown) => void
}) {
  const { user } = useSession()
  const [items, setItems] = useState<MaterialComment[]>()
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [legacy, setLegacy] = useState<MaterialNote | null>(null)
  const [loadError, setLoadError] = useState<unknown>()
  const [revision, setRevision] = useState(0)
  const [draft, setDraft] = useState('')
  // 응답을 받지 못한 전송. 같은 키로 다시 보낸다
  const [pending, setPending] = useState<{ body: string; key: string }>()
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<unknown>()
  const [confirming, setConfirming] = useState<string>()
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<unknown>()
  const lock = useRef(false)
  // 서버에서 받아 본 마지막 댓글. 내가 방금 쓴 댓글은 여기에 넣지 않아 그 사이 남의 댓글을 건너뛰지 않는다
  const seen = useRef<string>(undefined)
  const inputId = useId()
  // 삭제 확인을 닫은 뒤 포커스를 돌려줄 곳
  const focusAfter = useRef<string>(undefined)
  useEffect(() => {
    if (confirming || !focusAfter.current) return
    const target = focusAfter.current === 'input' ? document.getElementById(inputId)
      : document.querySelector<HTMLElement>(`[data-comment-delete="${focusAfter.current}"]`)
    focusAfter.current = undefined
    target?.focus()
  }, [confirming, inputId])

  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([materialsApi.comments(materialId, undefined, controller.signal), materialsApi.note(materialId, controller.signal)])
      .then(([page, note]) => {
        if (controller.signal.aborted) return
        setItems(page.items)
        seen.current = page.items.at(-1)?.id
        setNextCursor(page.nextCursor)
        setLegacy(note.markdown.trim() ? note : null)
        setLoadError(undefined)
      })
      .catch((reason) => { if (!controller.signal.aborted) { setLoadError(reason); onError(reason) } })
    return () => controller.abort()
  }, [materialId, revision, onError])

  // 다 읽은 상태면 서버에서 받아 본 마지막 댓글 다음부터 새 댓글을 이어 붙인다
  const refresh = useEffectEvent(async () => {
    if (!items || nextCursor) return
    try {
      const page = await materialsApi.comments(materialId, seen.current)
      if (page.items.length) seen.current = page.items.at(-1)?.id
      setItems((current) => current && [...current, ...page.items.filter((item) => !current.some((entry) => entry.id === item.id))])
    } catch {
      // 다음 주기에 다시 읽는다
    }
  })
  useEffect(() => {
    const timer = setInterval(() => void refresh(), commentRefreshMs)
    return () => clearInterval(timer)
  }, [materialId])

  const dirty = draft.trim() !== '' || !!pending
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  async function more() {
    if (!nextCursor || lock.current) return
    lock.current = true
    try {
      const page = await materialsApi.comments(materialId, nextCursor)
      setItems((current) => [...(current ?? []), ...page.items.filter((item) => !current?.some((entry) => entry.id === item.id))])
      if (page.items.length) seen.current = page.items.at(-1)?.id
      setNextCursor(page.nextCursor)
      setLoadError(undefined)
    } catch (reason) { setLoadError(reason); onError(reason) }
    finally { lock.current = false }
  }

  async function send() {
    const body = draft.trim()
    if (lock.current || (!body && !pending)) return
    const command = pending ?? { body, key: crypto.randomUUID() }
    lock.current = true
    setSending(true)
    setSendError(undefined)
    try {
      const created = await materialsApi.addComment(materialId, command.body, command.key)
      setItems((current) => current?.some((item) => item.id === created.id) ? current : [...(current ?? []), created])
      setPending(undefined)
      setDraft((value) => value.trim() === command.body ? '' : value)
    } catch (reason) {
      setPending(isUncertain(reason) ? command : undefined)
      setSendError(reason)
      onError(reason)
    } finally { lock.current = false; setSending(false) }
  }

  async function remove(commentId: string) {
    if (lock.current) return
    lock.current = true
    setDeleting(true)
    setDeleteError(undefined)
    try {
      await materialsApi.deleteComment(materialId, commentId)
      setItems((current) => current?.filter((item) => item.id !== commentId))
      focusAfter.current = 'input'
      setConfirming(undefined)
    } catch (reason) { setDeleteError(reason); onError(reason) }
    finally { lock.current = false; setDeleting(false) }
  }

  if (!items) return <section className={styles.note} aria-label="팀 메모">
    <h3 className={styles.sectionTitle}>팀 메모</h3>
    {loadError
      ? <RequestError error={loadError} action={<Button variant="text" onClick={() => setRevision((value) => value + 1)}>다시 불러오기</Button>} />
      : <p className={styles.noteAuthor} role="status">팀 메모를 불러오고 있어요</p>}
  </section>

  return <section className={styles.note} aria-label="팀 메모">
    <h3 className={styles.sectionTitle}>팀 메모</h3>
    {legacy && <div className={styles.comment}>
      <p className={styles.noteAuthor}>이전 팀 메모{legacy.updatedByName ? ` · ${legacy.updatedByName}` : ''}{legacy.updatedAt ? ` · ${formatWhen(legacy.updatedAt)}` : ''}</p>
      <p className={styles.plain}>{legacy.markdown}</p>
    </div>}
    {items.length > 0 && <ul className={styles.comments} aria-label="남긴 메모">
      {items.map((item) => <li key={item.id} className={styles.comment}>
        <p className={styles.noteAuthor}><strong>{item.author.name}</strong> · {formatWhen(item.createdAt)}</p>
        <p className={styles.plain}>{item.body}</p>
        {item.author.userId === user?.id && (confirming === item.id
          ? <div className={styles.actions}>
            <span>이 메모를 삭제할까요?</span>
            <Button variant="dangerText" loading={deleting} onClick={() => void remove(item.id)}>삭제</Button>
            {/* 실수로 지우지 않게 취소에 먼저 포커스를 둔다 */}
            <Button variant="text" autoFocus disabled={deleting}
              onClick={() => { focusAfter.current = item.id; setConfirming(undefined) }}>취소</Button>
          </div>
          : <div className={styles.actions}><Button variant="text" data-comment-delete={item.id}
            onClick={() => { setConfirming(item.id); setDeleteError(undefined) }}>삭제</Button></div>)}
      </li>)}
    </ul>}
    {items.length === 0 && !legacy && <p className={styles.noteBody}>아직 남긴 메모가 없어요. 팀원에게 첫 메모를 남겨 보세요.</p>}
    {nextCursor && <Button variant="text" onClick={() => void more()}>메모 더 보기</Button>}
    <RequestError error={loadError} />
    <RequestError error={deleteError} />
    <form className={styles.commentForm} onSubmit={(event) => { event.preventDefault(); void send() }}>
      <Field id={inputId} label="메모 남기기" multiline rows={2} maxLength={limits.comment} value={pending ? pending.body : draft}
        disabled={sending || !!pending} description="Enter로 남기고 Shift와 Enter로 줄을 바꿔요"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          // 한글 조합 중의 Enter는 글자를 확정할 뿐이다
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
          event.preventDefault()
          void send()
        }} />
      <div className={styles.actions}>
        <Button type="submit" loading={sending} disabled={!pending && !draft.trim()}>{pending ? '다시 보내기' : '남기기'}</Button>
      </div>
    </form>
    <RequestError error={sendError} />
  </section>
}
