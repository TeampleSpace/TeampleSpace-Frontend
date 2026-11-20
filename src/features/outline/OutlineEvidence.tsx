import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../../shared/api/client.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { Field } from '../../shared/ui/Field.tsx'
import { Modal } from '../../shared/ui/Modal.tsx'
import { RequestError } from '../../shared/ui/RequestError.tsx'
import { StatusPanel } from '../../shared/ui/StatusPanel.tsx'
import { materialsApi } from '../materials/api.ts'
import { isUncertain } from '../materials/errors.ts'
import { kindLabels } from '../materials/model.ts'
import type { Material, MaterialList, MaterialSummary } from '../materials/model.ts'
import { SourceViewer } from '../materials/SourceViewer.tsx'
import { outlineApi } from './api.ts'
import { outlineLimits } from './model.ts'
import type { Outline, OutlineItem, OutlineSource } from './model.ts'
import type { OutlineEvidenceProps } from './OutlinePage.tsx'
import styles from './OutlineEvidence.module.css'

const selectableIds = (item: OutlineItem) => item.sourceRefs.filter((source) => !source.sourceDeleted).map((source) => source.materialId)
const equalIds = (left: string[], right: string[]) => left.length === right.length && left.every((id, index) => id === right[index])

type PickerState = { version: number; original: string[] }

export default function OutlineEvidence(props: OutlineEvidenceProps) {
  const { item, outline, openRequest, disabled, onAccessError } = props
  const [seenRequest, setSeenRequest] = useState(0)
  const [picker, setPicker] = useState<PickerState | null>(null)
  const [viewer, setViewer] = useState<OutlineSource | null>(null)
  const [details, setDetails] = useState<Record<string, Material>>({})
  const sourceIds = item.sourceRefs.filter((source) => !source.sourceDeleted).map((source) => source.materialId).join(',')

  if (openRequest !== seenRequest) {
    setSeenRequest(openRequest)
    if (openRequest && !disabled) setPicker({ version: outline.version, original: selectableIds(item) })
  }

  useEffect(() => {
    const controller = new AbortController()
    if (!sourceIds) return () => controller.abort()
    for (const id of sourceIds.split(',')) {
      void materialsApi.get(id, controller.signal).then((material) => {
        if (!controller.signal.aborted) setDetails((previous) => ({ ...previous, [id]: material }))
      }).catch((reason) => { if (!controller.signal.aborted) onAccessError(reason) })
    }
    return () => controller.abort()
  }, [sourceIds, onAccessError])

  const onCloseViewer = () => setViewer(null)
  const setSaved = (next: Outline) => {
    props.onSaved(next)
    setPicker(null)
  }

  return <section className={styles.section}>
    <header className={styles.header}>
      <h3>연결된 자료 {item.sourceRefs.length}</h3>
      <Button variant="text" onClick={() => setPicker({ version: outline.version, original: selectableIds(item) })} disabled={disabled}>자료에서 찾기</Button>
    </header>
    {item.sourceRefs.length === 0 && <p className={styles.empty}>연결된 근거 자료가 없어요</p>}
    <ul className={styles.sources}>
      {item.sourceRefs.map((source) => {
        const detail = details[source.materialId]
        const gone = source.sourceDeleted
        return <li key={source.materialId}>
          {!gone && detail && <span className={styles.kind}>{kindLabels[detail.kind]}</span>}
          <div className={styles.metadata}>
            <strong>{gone ? '삭제된 자료' : detail?.title ?? '근거 자료'}</strong>
            <p>{gone ? '원문을 볼 수 없어요' : `${detail?.createdBy.name ? `${detail.createdBy.name} 님 · ` : ''}저장된 개정 ${source.sourceVersion}`}</p>
          </div>
          {!gone && <Button variant="text" disabled={disabled} onClick={() => setViewer(source)}>원문 보기</Button>}
        </li>
      })}
    </ul>
    {picker && <EvidencePicker {...props} initial={picker} onClose={() => setPicker(null)} onSaved={setSaved} />}
    {viewer && <SourceViewer key={viewer.revisionId} revisionId={viewer.revisionId}
      material={details[viewer.materialId] ?? { id: viewer.materialId, title: '근거 자료' }}
      onClose={onCloseViewer} onError={onAccessError} />}
  </section>
}

type PickerProps = OutlineEvidenceProps & { initial: PickerState; onClose: () => void }

function EvidencePicker({ projectId, item, outline, initial, onClose, onSaved, onReloadOutline, onAccessError, onDirtyChange }: PickerProps) {
  const [version, setVersion] = useState(initial.version)
  const [original, setOriginal] = useState(initial.original)
  const [selected, setSelected] = useState(initial.original)
  const [query, setQuery] = useState('')
  const [list, setList] = useState<MaterialList>()
  const [listError, setListError] = useState<unknown>()
  const [moreBusy, setMoreBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState<unknown>()
  const [busy, setBusy] = useState(false)
  const [retryUntil, setRetryUntil] = useState(0)
  const [serverConflict, setServerConflict] = useState(false)
  const [compare, setCompare] = useState<OutlineItem>()
  const [deleted, setDeleted] = useState(false)
  const [discard, setDiscard] = useState(false)
  const latestRequest = useRef(0)
  const pending = useRef<{ key: string; input: string } | null>(null)
  const lock = useRef(false)
  const dirty = !equalIds(selected, original)
  const conflict = serverConflict || version !== outline.version

  useEffect(() => { onDirtyChange(dirty || busy); return () => onDirtyChange(false) }, [dirty, busy, onDirtyChange])

  const load = useCallback(async (request: number, signal?: AbortSignal, cursor?: string) => {
    try {
      const result = await materialsApi.list(projectId, { status: 'ready', q: query.trim(), cursor }, signal)
      if (!signal?.aborted && request === latestRequest.current) {
        const ready = result.items.filter((material) => material.status === 'ready')
        setList((previous) => ({ ...result, items: cursor && previous ? [...previous.items, ...ready.filter((material) => !previous.items.some((old) => old.id === material.id))] : ready }))
        setListError(undefined)
      }
    } catch (reason) {
      if (!signal?.aborted && request === latestRequest.current) { setListError(reason); onAccessError(reason) }
    } finally {
      if (!signal?.aborted && request === latestRequest.current) { setLoading(false); setMoreBusy(false) }
    }
  }, [projectId, query, onAccessError])

  useEffect(() => {
    const controller = new AbortController()
    const request = ++latestRequest.current
    const timer = window.setTimeout(() => { void load(request, controller.signal) }, query ? 250 : 0)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [load, query, revision])

  useEffect(() => {
    if (!retryUntil) return
    const timer = window.setTimeout(() => setRetryUntil(0), Math.max(0, retryUntil - Date.now()))
    return () => window.clearTimeout(timer)
  }, [retryUntil])

  function toggle(id: string) {
    setSelected((previous) => previous.includes(id) ? previous.filter((value) => value !== id) : previous.length < outlineLimits.sources ? [...previous, id] : previous)
  }

  function requestClose() {
    if (busy) return
    if (dirty) setDiscard(true)
    else onClose()
  }

  async function compareLatest() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(undefined)
    try {
      const next = await onReloadOutline(item.id)
      const actual = next.items.find((entry) => entry.id === item.id)
      if (actual) setCompare(actual)
      else setDeleted(true)
    } catch (reason) { setError(reason) }
    finally { lock.current = false; setBusy(false) }
  }

  function acceptLatest() {
    if (!compare) return
    setVersion(outline.version)
    setOriginal(selectableIds(compare))
    setServerConflict(false)
    setCompare(undefined)
    pending.current = null
  }

  async function save() {
    if (lock.current || conflict || retryUntil) return
    if (!dirty && !item.sourceRefs.some((source) => source.sourceDeleted)) { onClose(); return }
    const body = { expectedVersion: version, sourceIds: selected }
    const input = JSON.stringify(body)
    if (pending.current?.input !== input) pending.current = { input, key: crypto.randomUUID() }
    lock.current = true
    setBusy(true)
    setError(undefined)
    try { onSaved(await outlineApi.saveSources(item.id, body, pending.current.key)) }
    catch (reason) {
      if (!isUncertain(reason)) pending.current = null
      if (reason instanceof ApiError) {
        if (reason.code === 'VERSION_CONFLICT' || reason.code === 'NOT_FOUND') setServerConflict(true)
        if (reason.retryAfterSeconds) setRetryUntil(Date.now() + reason.retryAfterSeconds * 1000)
      }
      setError(reason)
      onAccessError(reason)
    } finally { lock.current = false; setBusy(false) }
  }

  const itemRow = (material: MaterialSummary) => {
    const checked = selected.includes(material.id)
    return <label key={material.id} className={styles.choice} data-selected={checked || undefined}>
      <input type="checkbox" checked={checked} onChange={() => toggle(material.id)} disabled={busy || (!checked && selected.length >= outlineLimits.sources)} />
      <span>{material.title} <small>{material.kind === 'file' ? ' · 처리 완료' : ` · ${kindLabels[material.kind]}`}</small></span>
    </label>
  }
  const loadMore = () => {
    if (!list?.nextCursor || moreBusy) return
    setMoreBusy(true)
    void load(++latestRequest.current, undefined, list.nextCursor)
  }

  return <>
    <Modal open size="confirm" title="연결할 자료를 선택하세요" onClose={requestClose}
      footer={<><Button variant="secondary" onClick={requestClose} disabled={busy}>취소</Button><Button loading={busy} disabled={conflict || retryUntil > 0} onClick={() => void save()}>{selected.length ? `${selected.length}개 연결` : '연결 해제'}</Button></>}>
      <div className={styles.picker}>
        <Field label="자료 검색" type="search" value={query} maxLength={255} placeholder="자료 이름으로 검색" disabled={busy}
          onChange={(event) => { setQuery(event.target.value); setLoading(true); setListError(undefined); setMoreBusy(false) }} />
        {loading ? <StatusPanel kind="loading" title="자료를 불러오고 있어요" /> : <>
          {list?.items.length ? <div className={styles.choices}>{list.items.map(itemRow)}</div>
            : !listError && <StatusPanel kind="empty" title={query ? '일치하는 자료가 없어요' : '연결할 수 있는 자료가 없어요'} />}
          {list?.nextCursor && <Button variant="text" loading={moreBusy} disabled={busy} onClick={loadMore}>자료 더 보기</Button>}
        </>}
        {Boolean(listError) && <RequestError error={listError} action={<Button variant="secondary" onClick={() => { setLoading(true); setListError(undefined); setRevision((value) => value + 1) }}>자료 다시 불러오기</Button>} />}
        {selected.length === outlineLimits.sources && <p className={styles.empty}>목차 한 개에 근거 자료를 20개까지 연결할 수 있어요.</p>}
        {original.length > 0 && <p className={styles.empty}>연결을 저장하면 선택한 자료의 최신 개정이 근거로 저장돼요.</p>}
        {item.sourceRefs.some((source) => source.sourceDeleted) && <p className={styles.empty}>저장하면 삭제된 자료의 연결을 제거해요.</p>}
        {conflict && <div className={styles.conflict} role="alert">
          <strong>다른 곳에서 발표 구성이 바뀌었어요</strong>
          {deleted ? <p>목차가 삭제되었어요. 이 항목에 근거 자료를 연결할 수 없어요.</p>
            : compare ? <><p>최신 구성의 근거 자료는 {compare.sourceRefs.length}개예요.</p><Button variant="secondary" onClick={acceptLatest}>내 선택을 유지하고 계속</Button></>
            : <Button variant="secondary" loading={busy} onClick={() => void compareLatest()}>최신 근거 확인</Button>}
        </div>}
        {!(error instanceof ApiError && error.code === 'VERSION_CONFLICT') && <RequestError error={error} />}
      </div>
    </Modal>
    {discard && <Modal open size="confirm" title="저장하지 않은 선택이 있어요" description="닫으면 선택한 자료가 저장되지 않아요" onClose={() => setDiscard(false)}
      footer={<><Button variant="secondary" onClick={() => setDiscard(false)}>계속 선택</Button><Button onClick={onClose}>닫기</Button></>} />}
  </>
}
