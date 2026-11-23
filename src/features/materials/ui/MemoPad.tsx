import { useEffect, useId, useRef, useState } from 'react'
import { ApiError } from '../../../shared/api/client.ts'
import { Button } from '../../../shared/ui/Button.tsx'
import { RequestError } from '../../../shared/ui/RequestError.tsx'
import { materialsApi } from '../../../entities/material/api.ts'
import { isUncertain } from '../../../entities/material/errors.ts'
import type { Material } from '../../../entities/material/model.ts'
import { MarkdownEditor } from './MarkdownEditor.tsx'
import styles from './Materials.module.css'

// 입력을 멈추고 이만큼 지나면 저장한다
export const memoSaveDelayMs = 1200

type Status = 'saved' | 'waiting' | 'saving' | 'failed' | 'conflict'
const statusLabels: Record<Status, string> = {
  saved: '저장됨', waiting: '저장 대기', saving: '저장 중', failed: '저장하지 못했어요', conflict: '확인이 필요해요',
}

// 자료를 먼저 읽고 그 자료의 현재 개정으로 원문을 읽어 버전과 본문이 같은 시점을 가리키게 한다
async function latestOf(id: string, signal?: AbortSignal) {
  const current = await materialsApi.get(id, signal)
  const source = await materialsApi.source(id, current.currentRevision?.id, signal)
  return [current, source] as const
}

// 메모 자료의 본문을 바로 보여 주고 그 자리에서 고친다. 저장할 때마다 새 원문 개정이 생긴다
export function MemoPad({ material, onSaved, onDirtyChange, onError }: {
  material: Material; onSaved: (next: Material) => void
  onDirtyChange: (dirty: boolean) => void; onError: (reason: unknown) => void
}) {
  const fieldId = useId()
  const [draft, setDraft] = useState<string>()
  const [saved, setSaved] = useState('')
  const [mode, setMode] = useState<'write' | 'preview'>('write')
  const [status, setStatus] = useState<Status>('saved')
  const [error, setError] = useState<unknown>()
  const [loadError, setLoadError] = useState<unknown>()
  const [revision, setRevision] = useState(0)
  // 다른 사람이 먼저 바꾼 최신 본문
  const [latest, setLatest] = useState<{ material: Material; markdown: string }>()
  // 타이머와 응답에서 바로 쓰는 값은 ref로 둔다
  const savedRef = useRef('')
  // 지금 편집기에 보이는 본문의 개정
  const shown = useRef<string>(undefined)
  // 다른 팀원의 저장으로 다시 읽는 중에 입력이 생기면 응답으로 덮어쓰지 않는다
  const reloading = useRef(false)
  const editedSince = useRef(false)
  // 다시 읽지 못한 개정. 다시 불러오기를 누르기 전에는 같은 개정을 반복해 읽지 않는다
  const failedFor = useRef<string>(undefined)
  const external = material.currentRevision?.id
  const externalRef = useRef(external)
  useEffect(() => { externalRef.current = external })
  // 본문 조회가 끝날 때마다 늘려 그 사이 바뀐 개정을 다시 확인한다
  const [settled, setSettled] = useState(0)
  const version = useRef(material.version)
  const composing = useRef(false)
  // 충돌을 고르기 전에는 저장하지 않는다
  const blocked = useRef(false)
  const saving = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    const controller = new AbortController()
    void latestOf(material.id, controller.signal)
      .then(([current, source]) => {
        if (controller.signal.aborted) return
        const skip = reloading.current && editedSince.current
        reloading.current = false
        setSettled((value) => value + 1)
        if (skip) return
        const text = source.markdown ?? ''
        version.current = current.version
        shown.current = current.currentRevision?.id
        failedFor.current = undefined
        savedRef.current = text
        setSaved(text)
        setDraft(text)
        setLoadError(undefined)
      })
      .catch((reason) => {
        if (controller.signal.aborted) return
        if (reloading.current) failedFor.current = externalRef.current
        reloading.current = false
        setLoadError(reason)
        onError(reason)
        setSettled((value) => value + 1)
      })
    return () => controller.abort()
  }, [material.id, revision, onError])
  useEffect(() => () => clearTimeout(timer.current), [])

  // 보내는 중인 저장이 끝날 때까지도 저장하지 않은 것으로 본다
  const [sending, setSending] = useState(false)
  const dirty = draft !== undefined && (draft !== saved || sending)
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])

  // 입력 중이 아니면 다른 사람이 저장한 새 개정의 본문을 다시 읽는다. 표시 개정은 읽기에 성공한 뒤에 바꾼다
  useEffect(() => {
    if (!external || shown.current === undefined || external === shown.current) return
    if (dirty || blocked.current || saving.current || reloading.current || failedFor.current === external) return
    reload()
  }, [external, dirty, settled])

  function reload() {
    failedFor.current = undefined
    reloading.current = true
    editedSince.current = false
    queueMicrotask(() => setRevision((value) => value + 1))
  }
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  function done(next: Material, text: string) {
    version.current = next.version
    shown.current = next.currentRevision?.id
    savedRef.current = text
    setSaved(text)
    onSaved(next)
  }

  // 한 번에 하나만 보낸다. 보내는 동안 바뀐 입력은 끝난 뒤 이어서 보낸다
  async function save() {
    clearTimeout(timer.current)
    if (saving.current || composing.current || blocked.current) return
    // 한글 조합이 끝난 실제 입력값을 읽는다
    const value = (document.getElementById(fieldId) as HTMLTextAreaElement | null)?.value ?? draft ?? ''
    if (value === savedRef.current) { setStatus('saved'); return }
    saving.current = true
    setSending(true)
    setStatus('saving')
    setError(undefined)
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          done(await materialsApi.update(material.id, version.current, { markdown: value }), value)
          break
        } catch (reason) {
          const conflicted = reason instanceof ApiError && reason.code === 'VERSION_CONFLICT'
          if (!conflicted && !isUncertain(reason)) throw reason
          // 최신 본문과 비교한다. 같으면 저장된 것이고, 본문이 그대로면 이름만 바뀐 것이라 다시 보낸다
          const [current, source] = await latestOf(material.id)
          const text = source.markdown ?? ''
          if (text === value) { done(current, value); break }
          if (text === savedRef.current && attempt === 0) { version.current = current.version; continue }
          if (!conflicted) throw reason
          blocked.current = true
          setLatest({ material: current, markdown: text })
          setStatus('conflict')
          return
        }
      }
      const now = (document.getElementById(fieldId) as HTMLTextAreaElement | null)?.value
      if (now !== undefined && now !== savedRef.current) {
        setStatus('waiting')
        timer.current = setTimeout(() => void save(), memoSaveDelayMs)
      } else setStatus('saved')
    } catch (reason) {
      setError(reason)
      setStatus('failed')
      onError(reason)
    } finally {
      saving.current = false
      setSending(false)
    }
  }

  function change(value: string) {
    editedSince.current = true
    setDraft(value)
    if (blocked.current) return
    setStatus('waiting')
    clearTimeout(timer.current)
    if (!composing.current) timer.current = setTimeout(() => void save(), memoSaveDelayMs)
  }

  function keepMine() {
    if (!latest) return
    version.current = latest.material.version
    savedRef.current = latest.markdown
    setSaved(latest.markdown)
    onSaved(latest.material)
    blocked.current = false
    setLatest(undefined)
    setStatus('waiting')
    void save()
  }

  function takeLatest() {
    if (!latest) return
    done(latest.material, latest.markdown)
    blocked.current = false
    setDraft(latest.markdown)
    setLatest(undefined)
    setStatus('saved')
  }

  if (loadError && draft === undefined) return <section className={styles.memoPad} aria-label="메모 본문">
    <RequestError error={loadError} action={<Button variant="text" onClick={() => setRevision((value) => value + 1)}>다시 불러오기</Button>} />
  </section>
  if (draft === undefined) return <section className={styles.memoPad} aria-label="메모 본문">
    <p className={styles.noteAuthor} role="status">메모를 불러오고 있어요</p>
  </section>

  return <section className={styles.memoPad} aria-label="메모 본문">
    <div className={styles.sectionHeader}>
      <h3 className={styles.sectionTitle}>메모</h3>
      <span role="status">{statusLabels[status]}</span>
    </div>
    <div onCompositionStart={() => { composing.current = true }}
      onCompositionEnd={() => { composing.current = false; change((document.getElementById(fieldId) as HTMLTextAreaElement | null)?.value ?? '') }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) void save() }}>
      <MarkdownEditor id={fieldId} value={draft} mode={mode} disabled={status === 'conflict'} onChange={change} onModeChange={setMode} />
    </div>
    {latest && <div className={styles.conflict} role="alert">
      <p>다른 팀원이 먼저 메모를 고쳤어요. 내 입력은 그대로 있어요</p>
      <p className={styles.plain}>{latest.markdown || '내용 없음'}</p>
      <div className={styles.actions}>
        <Button onClick={keepMine}>내 내용으로 저장</Button>
        <Button variant="secondary" onClick={takeLatest}>최신 내용으로 바꾸기</Button>
      </div>
    </div>}
    {/* 다른 팀원이 고친 본문을 읽지 못했다. 고치는 중이면 저장할 때 충돌로 알린다 */}
    <RequestError error={loadError} action={dirty ? undefined : <Button variant="secondary" onClick={() => { setLoadError(undefined); reload() }}>다시 불러오기</Button>} />
    <RequestError error={error} action={status === 'failed'
      ? <Button variant="secondary" onClick={() => void save()}>다시 저장</Button> : undefined} />
  </section>
}
