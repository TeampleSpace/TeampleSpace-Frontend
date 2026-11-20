import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { Link, useParams } from 'react-router'
import { useShell } from '../../app/shellContext.ts'
import { ApiError } from '../../shared/api/client.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { Modal } from '../../shared/ui/Modal.tsx'
import { RequestError } from '../../shared/ui/RequestError.tsx'
import { StatusPanel } from '../../shared/ui/StatusPanel.tsx'
import { UnsavedGuard } from '../../shared/ui/UnsavedGuard.tsx'
import { useSession } from '../auth/sessionContext.ts'
import { materialsApi } from '../materials/api.ts'
import { isAccessLoss, isGone, isUncertain } from '../materials/errors.ts'
import { projectsApi } from '../projects/api.ts'
import type { Project } from '../projects/model.ts'
import { outlineApi } from './api.ts'
import { fieldsOf, outlineItemInput, outlineLimits, readOutlineSummary, validateOutlineFields } from './model.ts'
import type { Outline, OutlineFields, OutlineInput, OutlineItem } from './model.ts'
import { OutlineEditDialog } from './OutlineDialogs.tsx'
import styles from './Outline.module.css'

export type OutlineEvidenceProps = {
  projectId: string
  outline: Outline
  item: OutlineItem
  openRequest: number
  disabled: boolean
  onSaved: (outline: Outline) => void
  onReloadOutline: (keepItemId?: string) => Promise<Outline>
  onAccessError: (reason: unknown) => void
  onDirtyChange: (dirty: boolean) => void
}

export type OutlineAiSlotProps = {
  projectId: string
  version: number
  outlineHasItems: boolean
  dirty: boolean
  onGenerated: () => Promise<void>
  onAccessError: (reason: unknown) => void
}

type Slots = {
  renderEvidence?: ComponentType<OutlineEvidenceProps>
  renderAi?: ComponentType<OutlineAiSlotProps>
  designReady?: boolean
}

type Operation = { kind: 'edit'; id?: string } | { kind: 'delete'; id: string } | { kind: 'move'; id: string; by: -1 | 1 }
type ModalName = 'discard' | 'pin' | 'delete'
type SaveCommand = { operation: Operation; fields: OutlineFields; body: OutlineInput; key: string; index: number }
const indexLabel = (position: number) => String(position + 1).padStart(2, '0')
const sameFields = (left: OutlineFields, right: OutlineFields) => left.title === right.title && left.claim === right.claim && left.content === right.content

export default function OutlinePage(slots: Slots) {
  const { projectId = '' } = useParams()
  return <OutlineRoute key={projectId} projectId={projectId} slots={slots} />
}

function OutlineRoute({ projectId, slots }: { projectId: string; slots: Slots }) {
  const { setCurrentProject } = useShell()
  const { setUser } = useSession()
  const [data, setData] = useState<{ project: Project; outline: Outline } | null>(null)
  const [error, setError] = useState<unknown>()
  const [reload, setReload] = useState(0)

  const fail = useCallback((reason: unknown) => {
    setData(null)
    setError(reason)
    if (reason instanceof ApiError && reason.status === 401) setUser(null)
  }, [setUser])
  const onAccessError = useCallback((reason: unknown) => {
    if (isAccessLoss(reason)) fail(reason)
  }, [fail])

  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([projectsApi.get(projectId, controller.signal), outlineApi.get(projectId, controller.signal)])
      .then(([project, outline]) => { if (!controller.signal.aborted) setData({ project, outline }) })
      .catch((reason) => { if (!controller.signal.aborted) fail(reason) })
    return () => controller.abort()
  }, [projectId, reload, fail])

  const project = data?.project
  useEffect(() => {
    setCurrentProject(project ? { id: project.id, name: project.name } : null)
    return () => setCurrentProject(null)
  }, [project, setCurrentProject])

  if (error) return <div className={styles.page}>
    <RequestError error={error} action={<Button onClick={() => { setError(undefined); setReload((value) => value + 1) }}>다시 불러오기</Button>} />
    <Link to="/">프로젝트 목록으로</Link>
  </div>
  if (!data) return <StatusPanel kind="loading" title="발표 구성을 불러오고 있어요" />
  return <OutlineWorkspace project={data.project} initial={data.outline} slots={slots} onAccessError={onAccessError} onProjectError={fail} />
}

function OutlineWorkspace({ project, initial, slots, onAccessError, onProjectError }: {
  project: Project; initial: Outline; slots: Slots; onAccessError: (reason: unknown) => void; onProjectError: (reason: unknown) => void
}) {
  const projectPath = `/projects/${project.id}`
  const [outline, setOutline] = useState(initial)
  const outlineRef = useRef(initial)
  const [selection, setSelection] = useState<string>()
  const selected = outline.items.find((item) => item.id === selection) ?? outline.items[0]
  const [operation, setOperation] = useState<Operation | null>(null)
  const [baseVersion, setBaseVersion] = useState(initial.version)
  const [originalFields, setOriginalFields] = useState(fieldsOf())
  const [fields, setFields] = useState(fieldsOf())
  const [modal, setModal] = useState<ModalName>()
  const [pinOperation, setPinOperation] = useState<Operation>()
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState<unknown>()
  const [validation, setValidation] = useState(false)
  const [comparison, setComparison] = useState(false)
  const [serverConflict, setServerConflict] = useState(false)
  const [notice, setNotice] = useState('')
  const [retryUntil, setRetryUntil] = useState(0)
  const retry = useRef<SaveCommand | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const [recovered, setRecovered] = useState(false)
  const [evidenceRequest, setEvidenceRequest] = useState(0)
  const [evidenceDirty, setEvidenceDirty] = useState(false)
  const [readyCount, setReadyCount] = useState<{ count: number; more: boolean }>()
  const [materialsError, setMaterialsError] = useState<unknown>()
  const [materialsReload, setMaterialsReload] = useState(0)
  const editDirty = operation?.kind === 'edit' && !sameFields(fields, originalFields)
  const dirty = Boolean(editDirty) || evidenceDirty || busy || uncertain
  const conflict = !uncertain && Boolean(operation && (baseVersion !== outline.version || serverConflict))
  const target = operation?.id ? outline.items.find((item) => item.id === operation.id) : undefined
  const values = validateOutlineFields(fields)
  const blockers = busy || retryUntil > 0
  const visibleSections = selected ? readOutlineSummary(selected.summary) : null
  const empty = outline.items.length === 0
  const noMaterials = empty && readyCount?.count === 0
  const Evidence = slots.renderEvidence
  const Ai = slots.renderAi

  useEffect(() => {
    if (outline.items.length) return
    const controller = new AbortController()
    void materialsApi.list(project.id, { status: 'ready', limit: 100 }, controller.signal).then(({ items, nextCursor }) => {
      if (!controller.signal.aborted) setReadyCount({ count: items.filter((item) => item.status === 'ready').length, more: Boolean(nextCursor) })
    }).catch((reason) => {
      if (!controller.signal.aborted) { setMaterialsError(reason); onAccessError(reason) }
    })
    return () => controller.abort()
  }, [project.id, outline.items.length, materialsReload, onAccessError])

  useEffect(() => {
    if (!retryUntil) return
    const timer = window.setTimeout(() => setRetryUntil(0), Math.max(0, retryUntil - Date.now()))
    return () => window.clearTimeout(timer)
  }, [retryUntil])

  const setLatest = useCallback((next: Outline) => {
    if (next.version >= outlineRef.current.version) {
      outlineRef.current = next
      setOutline(next)
    }
    return outlineRef.current
  }, [])

  const reloadOutline = useCallback(async (keepItemId?: string) => {
    try {
      const next = await outlineApi.get(project.id)
      // 근거를 선택하던 항목이 사라져도 사용자가 닫을 때까지 선택을 유지한다
      return keepItemId && !next.items.some((item) => item.id === keepItemId) ? next : setLatest(next)
    } catch (reason) {
      if (isGone(reason)) onProjectError(reason)
      else onAccessError(reason)
      throw reason
    }
  }, [project.id, onAccessError, onProjectError, setLatest])

  const onGenerated = useCallback(async () => { await reloadOutline() }, [reloadOutline])
  const onAiAccessError = useCallback((reason: unknown) => {
    if (isGone(reason)) onProjectError(reason)
    else onAccessError(reason)
  }, [onAccessError, onProjectError])

  function open(next: Operation, item?: OutlineItem) {
    const initialFields = fieldsOf(item)
    retry.current = null
    setUncertain(false)
    setRecovered(false)
    setOperation(next)
    setBaseVersion(outline.version)
    setFields(initialFields)
    setOriginalFields(initialFields)
    setValidation(false)
    setComparison(false)
    setServerConflict(false)
    setPinOperation(undefined)
    setError(undefined)
    setNotice('')
    setModal(next.kind === 'delete' ? 'delete' : undefined)
  }

  function close() {
    setOperation(null)
    setModal(undefined)
    setError(undefined)
    setComparison(false)
    setServerConflict(false)
    setPinOperation(undefined)
    retry.current = null
    setUncertain(false)
    setRecovered(false)
  }

  function requestClose() {
    if (busy) return
    if (editDirty || uncertain) setModal('discard')
    else close()
  }

  async function compare() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(undefined)
    try { await reloadOutline(); setComparison(true) }
    catch (reason) { setError(reason) }
    finally { lock.current = false; setBusy(false) }
  }

  function acceptComparison() {
    if (operation?.id && !target) {
      if (operation.kind === 'edit') setOperation({ kind: 'edit' })
      else { close(); return }
    }
    setBaseVersion(outline.version)
    setComparison(false)
    setServerConflict(false)
    setError(undefined)
    retry.current = null
  }

  async function run(next: Operation, pinConfirmed = false) {
    if (lock.current || retryUntil) return
    if (retry.current) {
      await submit(retry.current, true)
      return
    }
    if (baseVersion !== outlineRef.current.version || conflict) return
    if (next.kind === 'edit') {
      setValidation(true)
      if (values.titleError || values.summaryError) return
      if (next.id && !editDirty) { close(); return }
    }
    const items = outline.items.map(outlineItemInput)
    const index = outline.items.findIndex((item) => item.id === next.id)
    if (next.id && index < 0) return
    if (next.kind === 'edit') {
      if (index < 0) {
        if (items.length >= outlineLimits.items) return
        items.push({ title: values.title, summary: values.summary, sourceIds: [] })
      } else {
        items[index] = { ...items[index], title: values.title, summary: fields.claim === originalFields.claim && fields.content === originalFields.content ? items[index].summary : values.summary }
      }
    } else if (next.kind === 'delete') {
      items.splice(index, 1)
    } else {
      const newIndex = index + next.by
      if (newIndex < 0 || newIndex >= items.length) return
      items.splice(newIndex, 0, ...items.splice(index, 1))
    }
    const kept = outline.items.filter((item) => next.kind !== 'delete' || item.id !== next.id)
    if (!pinConfirmed && kept.some((item) => item.sourceRefs.length > 0)) {
      setPinOperation(next)
      setModal('pin')
      return
    }
    const body: OutlineInput = { expectedVersion: outline.version, items }
    await submit({ operation: next, body, key: crypto.randomUUID(), fields, index })
  }

  async function submit(command: SaveCommand, resolving = false) {
    const { operation: next, body, key, index } = command
    retry.current = command
    lock.current = true
    setBusy(true)
    setError(undefined)
    setRecovered(false)
    setModal(next.kind === 'delete' ? 'delete' : undefined)
    try {
      const saved = await outlineApi.save(project.id, body, key)
      const savedTarget = next.kind === 'edit' && !next.id ? saved.items.at(-1) : saved.items.find((item) => item.id === next.id)
      if (saved.version >= outlineRef.current.version) {
        setLatest(saved)
        setSelection(savedTarget?.id ?? saved.items[Math.min(index, saved.items.length - 1)]?.id)
      }
      if (resolving && next.kind === 'edit' && savedTarget && !sameFields(fields, command.fields)) {
        retry.current = null
        setUncertain(false)
        setRecovered(true)
        setOperation({ kind: 'edit', id: savedTarget.id })
        setBaseVersion(saved.version)
        setOriginalFields(fieldsOf(savedTarget))
        return
      }
      setNotice(next.kind === 'delete' ? '목차를 삭제했어요' : next.kind === 'move' ? '목차 순서를 저장했어요' : '발표 구성을 저장했어요')
      close()
    } catch (reason) {
      const unknownResult = isUncertain(reason)
      if (!unknownResult) retry.current = null
      setUncertain(unknownResult)
      if (reason instanceof ApiError && reason.retryAfterSeconds) setRetryUntil(Date.now() + reason.retryAfterSeconds * 1000)
      if (reason instanceof ApiError && reason.code === 'VERSION_CONFLICT') setServerConflict(true)
      setError(reason)
      if (isGone(reason)) onProjectError(reason)
      else onAccessError(reason)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  // 순서 변경은 화면의 선택을 유지하고 같은 버전으로 저장한다
  function move(item: OutlineItem, by: -1 | 1) {
    const next = { kind: 'move', id: item.id, by } as const
    open(next)
  }

  function onEvidenceSaved(next: Outline) {
    const before = outlineRef.current
    setLatest(next)
    if (next.version === before.version + 1 && before.version === baseVersion) setBaseVersion(next.version)
    setNotice('근거를 저장했어요')
  }

  function cancelPin() {
    setModal(pinOperation?.kind === 'delete' ? 'delete' : undefined)
    setPinOperation(undefined)
  }

  const conflictFeedback = conflict || comparison ? <div className={styles.conflict} role="alert">
    <strong>다른 곳에서 발표 구성이 바뀌었어요</strong>
    {comparison ? <>
      {target && <><p>최신 제목은 {target.title}입니다.</p>{target.summary && <p>{target.summary}</p>}</>}
      {operation?.id && !target && <p>이 목차 항목이 삭제되었어요.</p>}
      <Button variant="secondary" onClick={acceptComparison}>{operation?.id && !target ? operation.kind === 'edit' ? '새 목차로 입력 유지' : '닫기' : '최신 구성을 기준으로 계속'}</Button>
    </> : <Button variant="secondary" loading={busy} onClick={() => void compare()}>최신 내용 확인</Button>}
    {Boolean(error) && !(error instanceof ApiError && error.code === 'VERSION_CONFLICT') && <RequestError error={error} />}
  </div> : undefined

  const add = () => open({ kind: 'edit' })

  return <section className={styles.page}>
    <UnsavedGuard dirty={dirty} />
    {!empty && <p className={styles.project}>{project.name}</p>}
    <header className={`${styles.heading} ${empty ? styles.empty : ''}`}>
      <div className={styles.headingTitle}>
        <div className={styles.emptyHeader}>
          <h1>{noMaterials ? '발표 구성을 시작해 볼까요?' : '발표 구성'}</h1>
          {empty && !noMaterials && <Link to={`${projectPath}/materials`}>돌아가기</Link>}
        </div>
        <p className={styles.emptyLead}>{noMaterials
          ? '자료를 추가하면 AI가 근거를 바탕으로 목차를 제안해요. 직접 목차를 작성할 수도 있어요.'
          : empty ? '준비된 자료로 발표 구성을 만들어보세요.' : slots.designReady ? '목차와 근거를 확인한 뒤, 다음 단계에서 PPT 디자인을 고르세요.' : '발표의 목차와 내용을 작성해 보세요.'}</p>
      </div>
      {empty && <div className={styles.ready}>
        {noMaterials ? <div className={styles.callout}><p>AI로 구성하려면 정리가 끝난 자료가 한 개 이상 필요해요.</p><Link className={styles.linkAction} to={`${projectPath}/materials`}>자료 추가</Link></div>
          : readyCount && <p className={styles.readyCount}>사용할 수 있는 자료 {readyCount.count}개{readyCount.more && ' 이상'}</p>}
        {Boolean(materialsError) && <RequestError error={materialsError} action={<Button onClick={() => { setMaterialsError(undefined); setMaterialsReload((value) => value + 1) }}>자료 다시 불러오기</Button>} />}
      </div>}
      <div className={`${styles.actions} ${styles.headerActions}`}>
        {Ai && <Ai projectId={project.id} version={outline.version} outlineHasItems={!empty}
          dirty={dirty || Boolean(operation)} onGenerated={onGenerated} onAccessError={onAiAccessError} />}
        {empty ? <Button variant={noMaterials ? 'text' : 'secondary'} onClick={add}>직접 목차 추가</Button>
          : slots.designReady && <Link className={styles.linkAction} to={`${projectPath}/design`} state={{ fromOutline: true }}>디자인 선택</Link>}
      </div>
    </header>
    {selected && visibleSections && <>
      <div className={styles.workspace}>
        <nav className={styles.flow} aria-label="발표 흐름">
          <h2>발표 흐름</h2>
          <p>{outline.items.length}장</p>
          <ol>{outline.items.map((item, index) => <li key={item.id}>
            <button type="button" aria-current={selected.id === item.id ? 'true' : undefined} onClick={() => { setSelection(item.id); setEvidenceRequest(0) }}>
              <span>{indexLabel(index)}</span>{item.title}
            </button>
          </li>)}</ol>
          <Button variant="text" disabled={outline.items.length >= outlineLimits.items || evidenceDirty} onClick={add}>+ 목차 추가</Button>
        </nav>
        <article key={selected.id} className={styles.detail}>
          <header className={styles.detailHeader}>
            <h2><span>{indexLabel(selected.position)}</span>{selected.title}</h2>
            <Button variant="secondary" onClick={() => open({ kind: 'edit', id: selected.id }, selected)} disabled={evidenceDirty}>내용 편집</Button>
          </header>
          {visibleSections.claim && <section className={styles.claim}><h3>핵심 주장</h3><p>{visibleSections.claim}</p></section>}
          <section className={styles.content}><h3>발표 내용</h3><p>{visibleSections.content || '입력한 발표 내용이 없어요'}</p></section>
          {Evidence && <Evidence projectId={project.id} outline={outline} item={selected} openRequest={evidenceRequest}
            disabled={busy || conflict || uncertain || Boolean(modal)} onSaved={onEvidenceSaved} onReloadOutline={reloadOutline}
            onAccessError={onAccessError} onDirtyChange={setEvidenceDirty} />}
          {outline.items.length > 1 && <div className={styles.orderActions} aria-label="목차 순서 변경">
            <Button variant="text" disabled={selected.position === 0 || evidenceDirty} onClick={() => move(selected, -1)}>위로 이동</Button>
            <Button variant="text" disabled={selected.position === outline.items.length - 1 || evidenceDirty} onClick={() => move(selected, 1)}>아래로 이동</Button>
          </div>}
        </article>
      </div>
    </>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {operation?.kind === 'edit' && <OutlineEditDialog fields={fields} editing={Boolean(operation.id)} busy={busy} recovering={uncertain}
      blocked={Boolean(conflictFeedback) || blockers} error={error} feedback={conflictFeedback ?? (recovered && <p role="status">이전 저장 결과를 확인했어요. 새 입력을 저장하려면 다시 저장해 주세요.</p>)}
      titleError={validation ? values.titleError : undefined} summaryError={validation ? values.summaryError : undefined}
      evidence={slots.renderEvidence && !uncertain ? () => setEvidenceRequest((value) => value + 1) : undefined}
      onChange={(key, value) => setFields((previous) => ({ ...previous, [key]: value }))}
      onSave={() => void run(operation)} onDelete={() => setModal('delete')} onClose={requestClose} />}
    {modal === 'discard' && <Modal open size="confirm" title={uncertain ? '이전 저장 결과를 확인하지 못했어요' : '저장하지 않은 변경이 있어요'} description="닫으면 입력한 내용이 사라져요" onClose={() => setModal(undefined)}
      footer={<><Button variant="secondary" onClick={() => setModal(undefined)}>계속 작성</Button><Button onClick={close}>닫기</Button></>} />}
    {modal === 'delete' && operation?.id && <Modal open size="confirm" title="목차 항목을 삭제할까요?"
      description={`${target?.title ? `${target.title} 항목을 삭제합니다. ` : ''}자료 원문은 남아요.${editDirty ? ' 저장하지 않은 입력도 지워져요.' : ''}`} onClose={() => { if (!busy) setModal(undefined) }}
      footer={<><Button variant="danger" loading={busy} disabled={Boolean(conflictFeedback) || blockers} onClick={() => void run({ kind: 'delete', id: operation.id! })}>삭제</Button>
        <Button variant="secondary" disabled={busy} onClick={() => setModal(undefined)}>취소</Button></>}>
      {conflictFeedback ?? <RequestError error={error} />}
    </Modal>}
    {operation?.kind === 'move' && modal !== 'pin' && <Modal open size="confirm" title="목차 순서를 바꿀까요?" onClose={() => { if (!busy) close() }}
      footer={<><Button loading={busy} disabled={Boolean(conflictFeedback) || blockers} onClick={() => void run(operation)}>순서 저장</Button><Button variant="secondary" disabled={busy} onClick={close}>취소</Button></>}>
      {conflictFeedback ?? <RequestError error={error} />}
    </Modal>}
    {modal === 'pin' && pinOperation && <Modal open size="confirm" title="연결된 근거를 다시 저장할까요?"
      description="구성을 저장하면 남아 있는 근거는 선택한 자료의 최신 개정으로 연결되고 이미 삭제된 자료의 연결은 제거돼요."
      onClose={cancelPin}
      footer={<><Button onClick={() => void run(pinOperation, true)} disabled={Boolean(conflictFeedback) || blockers}>확인하고 저장</Button>
        <Button variant="secondary" onClick={cancelPin}>취소</Button></>}>
      {conflictFeedback}
    </Modal>}
  </section>
}
