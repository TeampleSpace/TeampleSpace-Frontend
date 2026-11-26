import { useEffect, useId, useRef, useState } from 'react'
import { ApiError } from '../../../shared/api/client.ts'
import { Button } from '../../../shared/ui/Button.tsx'
import { Field } from '../../../shared/ui/Field.tsx'
import { Modal } from '../../../shared/ui/Modal.tsx'
import { RequestError } from '../../../shared/ui/RequestError.tsx'
import { useSession } from '../../../entities/session/sessionContext.ts'
import type { Project } from '../../../entities/project/model.ts'
import { materialsApi } from '../../../entities/material/api.ts'
import { isAccessLoss, isUncertain } from '../../../entities/material/errors.ts'
import { MarkdownEditor } from './MarkdownEditor.tsx'
import { formatBytes, limits, normalizeUrl } from '../../../entities/material/model.ts'
import type { Material } from '../../../entities/material/model.ts'
import { addPdf, checkFile, uploadErrorMessage, uploadSteps } from '../upload.ts'
import type { UploadProgress, UploadStep } from '../upload.ts'
import styles from './Materials.module.css'

export type InputType = 'file' | 'link' | 'memo'
const typeLabels: Record<InputType, string> = { file: '파일 업로드', link: '링크', memo: '메모' }
const targetLabels: Record<InputType, string> = { file: '파일 추가', link: '링크 추가', memo: '메모 작성' }
// 고른 파일마다 확인 결과와 이어 쓸 업로드 진행 상태를 둔다
type Picked = { file: File; error: string | null; progress: UploadProgress; added?: boolean; failure?: unknown }

// 자료 추가와 마크다운 자료 수정. 입력 유형마다 초안을 따로 두고 버리기 전에는 지우지 않는다
export function MaterialCreateDialog({ project, initial, edit, onClose, onDone, onAdded, onDirtyChange, onError }: {
  project: Project; initial: InputType; edit?: { material: Material; markdown: string }
  onClose: () => void; onDone: (material: Material) => void
  // 여러 파일 중 일부만 올라가 모달이 열려 있을 때 목록을 다시 읽게 한다
  onAdded?: () => void
  onDirtyChange: (dirty: boolean) => void; onError: (reason: unknown) => void
}) {
  const { capabilities } = useSession()
  const rule = capabilities?.uploadTypes.find((entry) => entry.kind === 'material_pdf')
  const [type, setType] = useState<InputType>(edit ? 'memo' : initial)
  // 바꾸려는 입력 유형이나 닫기. 확인을 받기 전에는 옮기지 않는다
  const [pending, setPending] = useState<InputType | 'close' | null>(null)
  const [busy, setBusy] = useState(false)
  const [retryDelay, setRetryDelay] = useState(0)
  const retryBlocked = useRef(false)
  useEffect(() => {
    if (!retryDelay) return
    const timer = setTimeout(() => { retryBlocked.current = false; setRetryDelay(0) }, retryDelay * 1000)
    return () => clearTimeout(timer)
  }, [retryDelay])
  const [error, setError] = useState<unknown>()
  const [failure, setFailure] = useState<unknown>()
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const [files, setFiles] = useState<Picked[]>([])
  const [current, setCurrent] = useState<File | null>(null)
  const file = files.length === 1 ? files[0].file : null
  const fileError = files.length === 1 ? files[0].error : null
  const [fileTitle, setFileTitle] = useState('')
  const [over, setOver] = useState(false)
  const [step, setStep] = useState<UploadStep | null>(null)
  const abort = useRef<AbortController | null>(null)

  const [url, setUrl] = useState('')
  const [linkTitle, setLinkTitle] = useState('')
  const [description, setDescription] = useState('')

  const [memoTitle, setMemoTitle] = useState(edit?.material.title ?? '')
  const [markdown, setMarkdown] = useState(edit?.markdown ?? '')
  // 수정 중에 다른 사람이 먼저 저장한 최신 자료
  const [conflict, setConflict] = useState<{ material: Material; markdown: string } | null>(null)
  const [base, setBase] = useState(edit)

  // 결과를 모르는 등록 요청은 같은 키와 본문으로 다시 보낸다
  const retry = useRef<{ key: string; body: string } | null>(null)
  const lock = useRef(false)
  const lastField = useRef<{ id: string; start: number | null; end: number | null } | null>(null)
  const ids = { picker: useId(), url: useId(), memoTitle: useId(), markdown: useId() }

  const memoDirty = base ? memoTitle !== base.material.title || markdown !== base.markdown : !!(memoTitle.trim() || markdown.trim())
  const dirty = memoDirty || files.length > 0 || !!(fileTitle.trim() || url.trim() || linkTitle.trim() || description.trim())
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const rememberField = ({ id, selectionStart, selectionEnd }: HTMLInputElement | HTMLTextAreaElement) => {
    lastField.current = { id, start: selectionStart, end: selectionEnd }
  }
  const remember = (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => rememberField(event.currentTarget)
  // 계속 작성을 고르면 쓰던 입력란과 커서로 돌아간다
  function keepWriting() {
    setPending(null)
    const last = lastField.current
    requestAnimationFrame(() => {
      const field = last && document.getElementById(last.id) as HTMLInputElement | HTMLTextAreaElement | null
      if (!field || field.hidden) return
      field.focus()
      if (last.start !== null) field.setSelectionRange(last.start, last.end)
    })
  }
  function requestClose() {
    if (step) { abort.current?.abort(); return }
    if (busy) return
    if (dirty) setPending('close'); else onClose()
  }
  function switchTo(next: InputType) {
    if (next === type || busy) return
    if (type === 'memo' && memoDirty) setPending(next); else setType(next)
  }
  function discardMemo(next: InputType) {
    setMemoTitle(''); setMarkdown(''); setError(undefined)
    lastField.current = null
    setType(next); setPending(null)
  }

  // 새로 고르면 이전 선택을 바꾼다
  function pick(list: FileList | null | undefined) {
    if (!list?.length || busy) return
    setFiles([...list].map((next) => ({ file: next, error: checkFile(next, rule), progress: {} })))
    setFailure(undefined)
  }
  const update = (target: File, patch: Partial<Picked>) =>
    setFiles((list) => list.map((item) => item.file === target ? { ...item, ...patch } : item))

  // 작업이 null을 돌려주면 모달을 닫지 않는다
  async function run(work: () => Promise<Material | null>, onFail: (reason: unknown) => void) {
    if (lock.current || retryBlocked.current) return
    lock.current = true; setBusy(true); setError(undefined); setFailure(undefined); setFieldErrors({})
    try { const material = await work(); if (material) onDone(material) }
    catch (reason) {
      if (reason instanceof ApiError && reason.retryAfterSeconds) {
        retryBlocked.current = true
        setRetryDelay(reason.retryAfterSeconds)
      }
      if (reason instanceof ApiError && reason.fieldErrors.length && reason.code !== 'UPLOAD_REJECTED') {
        setFieldErrors(Object.fromEntries(reason.fieldErrors.map((item) => [item.field, item.message])))
      } else onFail(reason)
      onError(reason)
    } finally { lock.current = false; setBusy(false); setStep(null) }
  }
  // 같은 본문이면 결과를 모르는 요청의 키를 다시 쓴다
  async function register(body: object, send: (key: string) => Promise<{ material: Material }>) {
    const serialized = JSON.stringify(body)
    if (retry.current?.body !== serialized) retry.current = { key: crypto.randomUUID(), body: serialized }
    try {
      const result = await send(retry.current.key)
      retry.current = null
      return result.material
    } catch (reason) {
      if (!isUncertain(reason)) retry.current = null
      throw reason
    }
  }

  const submitFile = () => {
    const queue = files.filter((item) => !item.error && !item.added)
    if (!queue.length || !rule) return
    abort.current = new AbortController()
    const { signal } = abort.current
    if (files.length === 1) {
      const [item] = queue
      void run(() => addPdf(materialsApi, project.id, item.file, fileTitle.trim(), rule, item.progress, setStep, signal),
        (reason) => { if (!signal.aborted) setFailure(reason) })
      return
    }
    // 여러 파일은 하나씩 올리고 실패한 파일은 이유를 남긴 채 다음 파일로 넘어간다
    void run(async () => {
      let last: Material | null = null
      let failed = false
      try {
        for (const item of queue) {
          signal.throwIfAborted()
          setCurrent(item.file)
          try {
            last = await addPdf(materialsApi, project.id, item.file, '', rule, item.progress, setStep, signal)
            update(item.file, { added: true, failure: undefined })
            onAdded?.()
          } catch (reason) {
            if (signal.aborted || isAccessLoss(reason)) throw reason
            failed = true
            // PDF가 아니라고 확인된 파일은 다시 올려도 같으므로 재시도에서 뺀다
            if (reason instanceof ApiError && reason.code === 'UPLOAD_REJECTED' && reason.fieldErrors[0]?.code === 'NOT_PDF') {
              update(item.file, { error: uploadErrorMessage(reason, rule) })
            } else update(item.file, { failure: reason })
            // 서버가 기다리라고 하면 남은 파일도 멈추고 그 시간 동안 다시 시도를 막는다
            if (reason instanceof ApiError && reason.retryAfterSeconds) throw reason
            onError(reason)
          }
        }
      } finally { setCurrent(null) }
      return failed ? null : last
    }, () => {})
  }
  const submitLink = () => {
    const normalized = normalizeUrl(url)
    if (!normalized) { setFieldErrors({ url: 'http나 https로 시작하는 전체 주소를 입력해 주세요' }); return }
    const body = { url: normalized, ...(linkTitle.trim() ? { title: linkTitle.trim() } : {}), ...(description.trim() ? { description: description.trim() } : {}) }
    void run(() => register(body, (key) => materialsApi.createLink(project.id, body, key)), setFailure)
  }
  const submitMemo = () => {
    // 한글 조합이 끝난 실제 입력값을 읽는다
    const title = ((document.getElementById(ids.memoTitle) as HTMLInputElement | null)?.value ?? memoTitle).trim()
    const text = markdown
    if (!title || !text.trim()) return
    if (!base) {
      const body = { title, markdown: text }
      void run(() => register(body, (key) => materialsApi.createMemo(project.id, body, key)), setError)
      return
    }
    void run(() => save(base, title, text), setError)
  }
  // 수정은 버전을 비교한다. 충돌하거나 응답을 못 받으면 다시 읽어 내 입력과 비교한다
  async function save(from: { material: Material; markdown: string }, title: string, text: string) {
    const change = { ...(title !== from.material.title ? { title } : {}), ...(text !== from.markdown ? { markdown: text } : {}) }
    if (Object.keys(change).length === 0) return from.material
    try {
      return await materialsApi.update(from.material.id, from.material.version, change)
    } catch (reason) {
      const conflicted = reason instanceof ApiError && reason.code === 'VERSION_CONFLICT'
      if (!conflicted && !isUncertain(reason)) throw reason
      const [material, source] = await Promise.all([materialsApi.get(from.material.id), materialsApi.source(from.material.id)]).catch(() => [null, null])
      if (!material || !source) throw reason
      const latest = { material, markdown: source.markdown ?? '' }
      if (material.title === title && latest.markdown === text) return material
      // 그사이 다른 사람이 바꿨으면 덮어쓰지 않고 고르게 한다
      if (material.version !== from.material.version) setConflict(latest)
      throw reason
    }
  }

  const submit = type === 'file' ? submitFile : type === 'link' ? submitLink : submitMemo
  const ready = type === 'file' ? files.some((item) => !item.error && !item.added) && !!rule : type === 'link' ? !!url.trim() : !!memoTitle.trim() && !!markdown.trim()
  const uploadMessage = uploadErrorMessage(failure, rule)

  return <>
    <Modal open size="form" minHeight={type === 'memo' ? 760 : type === 'link' ? 584 : 640} title={edit ? '메모 수정' : '자료 추가'} description={`${project.name} · 팀원들과 함께 사용할 자료`} onClose={requestClose}
      footer={<>
        <Button variant="secondary" onClick={requestClose}>취소</Button>
        {!conflict && <Button loading={busy} disabled={!ready || !!retryDelay} onClick={submit}>{edit ? '저장' : type === 'memo' ? '메모 추가' : '자료 추가'}</Button>}
      </>}>
      {!edit && <div className={styles.tabs} role="tablist" aria-label="자료 유형">
        {(Object.keys(typeLabels) as InputType[]).map((value) => <Button key={value} variant="text" role="tab" aria-selected={type === value}
          disabled={busy && type !== value} onClick={() => switchTo(value)}>{typeLabels[value]}</Button>)}
      </div>}

      {type === 'file' && <div className={styles.form}>
        <div className={styles.drop} data-over={over}
          onDragOver={(event) => { event.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
          onDrop={(event) => { event.preventDefault(); setOver(false); pick(event.dataTransfer.files) }}>
          <p>{file ? file.name : files.length ? `파일 ${files.length}개` : '파일을 여기에 끌어다 놓으세요'}</p>
          <p>{file ? `PDF · ${formatBytes(file.size)}`
            : current ? `${files.findIndex((item) => item.file === current) + 1}번째 파일 올리는 중 · ${current.name}`
            : files.length ? `PDF · ${formatBytes(files.reduce((sum, item) => sum + item.file.size, 0))}`
            : 'PDF 자료를 여러 개 함께 추가할 수 있어요'}</p>
          {step ? <ol className={styles.steps} role="status" aria-label="업로드 진행">
            {uploadSteps.map((item, index) => {
              const current = uploadSteps.findIndex((entry) => entry.step === step)
              return <li key={item.step} data-state={index < current ? 'done' : index === current ? 'current' : 'todo'}>
                {item.label}{index === current && <span className={styles.visuallyHidden}> 진행 중</span>}
              </li>
            })}
          </ol> : <Button variant="secondary" disabled={busy} onClick={() => document.getElementById(ids.picker)?.click()}>{files.length ? '다른 파일 선택' : '파일 선택'}</Button>}
          <input id={ids.picker} type="file" accept="application/pdf,.pdf" multiple hidden aria-label="PDF 파일"
            onChange={(event) => { pick(event.target.files); event.target.value = '' }} />
        </div>
        {fileError && <p className={styles.fieldError} role="alert">{fileError}</p>}
        {files.length > 1 && <ul className={styles.fileList} aria-label="고른 파일">
          {files.map((item, index) => {
            const problem = item.error ?? (item.failure ? uploadErrorMessage(item.failure, rule) ?? (item.failure instanceof ApiError ? item.failure.message : '올리지 못했어요. 연결을 확인해 주세요') : null)
            return <li key={index} data-state={item.added ? 'added' : problem ? 'failed' : item.file === current ? 'current' : 'waiting'}>
              <span>{item.file.name}</span>
              <span>{item.added ? '추가됨' : problem ?? (item.file === current ? '올리는 중' : formatBytes(item.file.size))}</span>
            </li>
          })}
        </ul>}
        {files.length > 1 && files.some((item) => item.failure && !item.added) && !busy &&
          <p className={styles.fieldError} role="alert">올리지 못한 파일이 있어요. 자료 추가를 다시 누르면 실패한 파일만 올려요</p>}
        {files.length <= 1 && <Field label="자료 이름 · 선택" placeholder="비워두면 파일 이름으로 저장해요" maxLength={limits.title} value={fileTitle} disabled={busy}
          error={fieldErrors.title} onChange={(event) => setFileTitle(event.target.value)} onBlur={remember} />}
        <p className={styles.guide}>{files.length > 1 ? '여러 파일은 파일 이름으로 저장해요. ' : ''}추가한 자료는 프로젝트 팀원 모두가 볼 수 있어요.{rule ? ` PDF는 ${formatBytes(rule.maxBytes)}까지 올릴 수 있어요.` : ''}</p>
      </div>}

      {type === 'link' && <div className={styles.form}>
        <Field id={ids.url} label="링크 주소" type="url" inputMode="url" placeholder="https://" maxLength={limits.url} value={url} disabled={busy}
          description="웹페이지의 전체 주소를 붙여 넣어 주세요." error={fieldErrors.url}
          onChange={(event) => { setUrl(event.target.value); setFieldErrors({}) }} onBlur={remember} />
        <Field label="자료 이름 · 선택" placeholder="비워두면 문서 제목으로 저장해요" maxLength={limits.title} value={linkTitle} disabled={busy}
          error={fieldErrors.title} onChange={(event) => setLinkTitle(event.target.value)} onBlur={remember} />
        <Field label="팀에 남길 설명 · 선택" placeholder="이 자료에서 함께 확인할 내용을 적어 주세요." maxLength={limits.description} value={description} disabled={busy}
          error={fieldErrors.description} onChange={(event) => setDescription(event.target.value)} onBlur={remember} />
      </div>}

      {type === 'memo' && <div className={styles.form}>
        <Field id={ids.memoTitle} label="메모 제목" maxLength={limits.title} value={memoTitle} disabled={busy} error={fieldErrors.title}
          onChange={(event) => setMemoTitle(event.target.value)} onBlur={remember} />
        <div onBlur={(event) => { if (event.target instanceof HTMLTextAreaElement) rememberField(event.target) }}>
          <MarkdownEditor id={ids.markdown} value={markdown} disabled={busy} onChange={setMarkdown} />
        </div>
        {fieldErrors.markdown && <p className={styles.fieldError} role="alert">{fieldErrors.markdown}</p>}
        <p className={styles.hintText}>## 제목, **굵게**, - 목록처럼 마크다운으로 입력하면 바로 서식이 적용돼요</p>
        {conflict && <div className={styles.conflict} role="alert">
          <p>{conflict.material.title} 자료를 다른 팀원이 먼저 수정했어요. 내 입력은 그대로 있어요</p>
          <p className={styles.plain}>{conflict.markdown}</p>
          <div className={styles.actions}>
            <Button loading={busy} disabled={!!retryDelay} onClick={() => { const latest = conflict; setConflict(null); setBase(latest); void run(() => save(latest, memoTitle.trim(), markdown), setError) }}>내 내용으로 저장</Button>
            <Button variant="secondary" disabled={busy} onClick={() => { setMemoTitle(conflict.material.title); setMarkdown(conflict.markdown); setBase(conflict); setConflict(null); setError(undefined) }}>최신 내용으로 바꾸기</Button>
          </div>
        </div>}
        {!conflict && <RequestError error={error} />}
      </div>}
    </Modal>

    <Modal open={pending !== null} size={pending === 'close' ? 'dialog' : 'confirm'} onClose={keepWriting}
      title={pending === 'close' ? '작성 중인 내용을 닫을까요?' : '메모 작성을 중단할까요?'}
      description={pending === 'close'
        ? (memoDirty ? '저장하지 않은 메모가 있습니다.' : '입력한 내용이 사라집니다.')
        : `저장하지 않은 메모는 사라집니다. ${pending ? targetLabels[pending as InputType] : ''}로 이동할까요?`}
      footer={<>
        <Button onClick={keepWriting} data-autofocus>계속 작성</Button>
        {pending === 'close'
          ? <Button variant="secondary" className={styles.dangerText} onClick={onClose}>저장하지 않고 닫기</Button>
          : <Button variant="secondary" className={styles.dangerText} onClick={() => { if (pending) discardMemo(pending as InputType) }}>메모 버리고 이동</Button>}
      </>} />

    <Modal open={!!failure} size="dialog" title="자료를 추가하지 못했어요" onClose={() => setFailure(undefined)}
      description={type === 'file' ? '파일을 올리는 중 문제가 생겼어요.' : '링크 주소와 접근 상태를 확인해 주세요.'}
      footer={<>
        <Button disabled={!!retryDelay} onClick={() => { setFailure(undefined); submit() }} data-autofocus>{retryDelay ? '잠시 후 다시 시도' : '다시 시도'}</Button>
        <Button variant="secondary" onClick={() => {
          setFailure(undefined)
          if (type === 'file') setFiles([])
          else requestAnimationFrame(() => document.getElementById(ids.url)?.focus())
        }}>{type === 'file' ? '파일 다시 선택' : '링크 다시 입력'}</Button>
      </>}>
      {uploadMessage ? <p role="alert">{uploadMessage}</p> : <RequestError error={failure} />}
      <p>선택한 자료와 입력 내용은 유지됩니다.</p>
    </Modal>
  </>
}
