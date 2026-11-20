import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'
import type { BlockerFunction } from 'react-router'
import { useShell } from '../../app/shellContext.ts'
import { ApiError } from '../../shared/api/client.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { RequestError } from '../../shared/ui/RequestError.tsx'
import { StatusPanel } from '../../shared/ui/StatusPanel.tsx'
import { UnsavedGuard } from '../../shared/ui/UnsavedGuard.tsx'
import { useSession } from '../auth/sessionContext.ts'
import { projectsApi } from '../projects/api.ts'
import type { Project } from '../projects/model.ts'
import { materialsApi } from './api.ts'
import { SourceViewer } from './SourceViewer.tsx'
import { isAccessLoss, isGone, isUncertain } from './errors.ts'
import { MaterialDetail } from './MaterialDetail.tsx'
import type { ManageAction } from './MaterialDetail.tsx'
import { MaterialCreateDialog } from './MaterialCreateDialog.tsx'
import type { InputType } from './MaterialCreateDialog.tsx'
import { MaterialDialogs } from './MaterialDialogs.tsx'
import { MaterialNote } from './MaterialNote.tsx'
import { MaterialJob } from './MaterialJob.tsx'
import { MaterialAiSummary } from './MaterialAiSummary.tsx'
import { formatWhen, kindLabels, kindLine, materialKindSchema, statusLabels } from './model.ts'
import type { Material, MaterialKind, MaterialList, MaterialSummary } from './model.ts'
import styles from './Materials.module.css'

// 프로젝트를 확인한 뒤 자료 화면을 연다. 접근 권한이 사라지면 기존 내용을 가린다
export default function MaterialsPage() {
  const { projectId = '' } = useParams()
  const location = useLocation()
  const { setCurrentProject } = useShell()
  const { setUser } = useSession()
  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState<unknown>()
  const [revision, setRevision] = useState(0)

  const deny = useCallback((reason: unknown) => {
    setProject(null); setError(reason)
    if (reason instanceof ApiError && reason.status === 401) setUser(null)
  }, [setUser])
  // 자료 요청에서 접근 권한이 사라진 것을 알게 된 경우
  const onError = useCallback((reason: unknown, scope?: 'project') => {
    if (isAccessLoss(reason) || (scope === 'project' && isGone(reason))) deny(reason)
  }, [deny])

  useEffect(() => {
    const controller = new AbortController()
    void projectsApi.get(projectId, controller.signal).then((data) => {
      if (!controller.signal.aborted) { setProject(data); setError(undefined) }
    }).catch((reason) => { if (!controller.signal.aborted) deny(reason) })
    return () => controller.abort()
  }, [projectId, revision, deny])
  const current = project?.id === projectId ? project : null
  useEffect(() => {
    setCurrentProject(current ? { id: current.id, name: current.name } : null)
    return () => setCurrentProject(null)
  }, [current, setCurrentProject])

  if (error) return <>
    <RequestError error={error} action={<Button onClick={() => { setError(undefined); setRevision((value) => value + 1) }}>접근 권한 다시 확인</Button>} />
    <Link to="/">프로젝트 목록으로</Link>
    {error instanceof ApiError && error.status === 401 && <Link to={`/login?${new URLSearchParams({ returnTo: location.pathname })}`}>다시 로그인</Link>}
  </>
  if (!current) return <StatusPanel kind="loading" title="자료를 불러오고 있어요" />
  return <Materials key={current.id} project={current} onError={onError} />
}

const kinds: (MaterialKind | '')[] = ['', 'file', 'link', 'memo']
const summaryOf = ({ id, projectId, kind, title, status, version, pageCount, createdBy, createdAt, updatedAt }: Material): MaterialSummary =>
  ({ id, projectId, kind, title, status, version, pageCount, createdBy, createdAt, updatedAt })

function Materials({ project, onError }: { project: Project; onError: (reason: unknown, scope?: 'project') => void }) {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const kind = materialKindSchema.safeParse(params.get('kind')).data ?? ''
  const paramId = params.get('material')
  const key = `${q}\n${kind}`
  const [input, setInput] = useState(q)
  // 입력란에 반영한 주소 검색어와 이 화면이 주소에 쓴 검색어
  const [seenQ, setSeenQ] = useState(q)
  const [ownQ, setOwnQ] = useState(q)
  const [list, setList] = useState<(MaterialList & { key: string; pages: number }) | null>(null)
  const [listError, setListError] = useState<unknown>()
  const [listRevision, setListRevision] = useState(0)
  const [moreBusy, setMoreBusy] = useState(false)
  // 주소에 선택한 자료가 없을 때 보여 줄 자료
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const [pinnedFrom, setPinnedFrom] = useState<unknown>(null)
  const [detail, setDetail] = useState<Material | null>(null)
  const [detailError, setDetailError] = useState<{ id: string; reason: unknown } | null>(null)
  const [detailRevision, setDetailRevision] = useState(0)
  const [noteDirty, setNoteDirty] = useState(false)
  const [view, setView] = useState<ManageAction | null>(null)
  // 열려 있는 자료 추가 모달. edit이 있으면 마크다운 자료 수정이다
  const [create, setCreate] = useState<{ type: InputType; edit?: { material: Material; markdown: string } } | null>(null)
  const [createDirty, setCreateDirty] = useState(false)
  const [manageError, setManageError] = useState<unknown>()
  // 원문을 보고 있는 자료
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [retry, setRetry] = useState<{ busy: boolean; error?: unknown }>({ busy: false })
  const skipGuard = useRef(false)
  const retryKey = useRef<{ id: string; key: string } | null>(null)
  const generation = useRef(0)
  const loadedPages = useRef({ key: '', count: 1 })
  const moreLock = useRef(false)
  const selectedId = paramId ?? pinnedId
  const visibleList = list?.key === key ? list : null
  const visible = detail?.id === selectedId ? detail : null

  // 검색어는 입력이 멈춘 뒤 주소에 반영한다. 기록은 쌓지 않는다
  useEffect(() => {
    const value = input.trim()
    if (value === q) return
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params)
      if (value) next.set('q', value); else next.delete('q')
      setOwnQ(value)
      setParams(next, { replace: true })
    }, 250)
    return () => clearTimeout(timer)
  }, [input, q, params, setParams])
  // 뒤로가기처럼 밖에서 바뀐 검색어만 입력란에 되돌린다
  if (q !== seenQ) {
    setSeenQ(q)
    if (q !== ownQ) { setOwnQ(q); setInput(q) }
  }

  const loadList = useCallback(async (signal?: AbortSignal, silent = false) => {
    if (silent && moreLock.current) return
    const current = ++generation.current
    try {
      const data = await materialsApi.list(project.id, { q, kind }, signal)
      const pagesToLoad = silent && loadedPages.current.key === key ? loadedPages.current.count : 1
      let pages = 1
      while (pages < pagesToLoad && data.nextCursor) {
        if (signal?.aborted || current !== generation.current) return
        const next = await materialsApi.list(project.id, { q, kind, cursor: data.nextCursor }, signal)
        data.items.push(...next.items.filter((item) => !data.items.some((old) => old.id === item.id)))
        data.nextCursor = next.nextCursor
        pages++
      }
      // 이전 검색의 응답이 새 결과를 덮지 않게 한다
      if (signal?.aborted || current !== generation.current) return
      loadedPages.current = { key, count: pages }
      setList({ ...data, key, pages })
      setListError(undefined)
    } catch (reason) {
      if (signal?.aborted || current !== generation.current) return
      if (!silent) setListError(reason)
      onError(reason, 'project')
    }
  }, [project.id, q, kind, key, onError])
  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(() => loadList(controller.signal))
    return () => controller.abort()
  }, [loadList, listRevision])

  // 목록이 바뀌면 보여 줄 자료를 정한다. 메모를 쓰는 중에는 옮기지 않는다
  if (visibleList && visibleList !== pinnedFrom && !noteDirty) {
    setPinnedFrom(visibleList)
    if (!pinnedId || !visibleList.items.some((item) => item.id === pinnedId)) setPinnedId(visibleList.items[0]?.id ?? null)
  }

  const apply = useCallback((next: Material) => {
    setDetail((previous) => previous?.id === next.id ? next : previous)
    setList((previous) => previous && { ...previous, items: previous.items.map((item) => item.id === next.id ? summaryOf(next) : item) })
  }, [])
  const detailFailure = useCallback((id: string, reason: unknown) => {
    setDetailError({ id, reason })
    if (isGone(reason)) {
      setDetail((previous) => previous?.id === id ? null : previous)
    }
    onError(reason)
  }, [onError])
  useEffect(() => {
    if (!selectedId) return
    const controller = new AbortController()
    void materialsApi.get(selectedId, controller.signal).then((data) => {
      if (!controller.signal.aborted) { setDetail(data); setDetailError(null) }
    }).catch((reason) => {
      if (!controller.signal.aborted) detailFailure(selectedId, reason)
    })
    return () => controller.abort()
  }, [selectedId, detailRevision, detailFailure])

  // 이벤트 구독이 열리기 전까지는 처리 중인 자료를 다시 조회해 상태를 확인한다
  const processing = visible?.status === 'processing'
  const listProcessing = visibleList?.items.some((item) => item.status === 'processing') ?? false
  useEffect(() => {
    const controller = new AbortController()
    const refreshDetail = () => {
      if (!selectedId) return
      void materialsApi.get(selectedId, controller.signal).then((data) => {
        if (!controller.signal.aborted) apply(data)
      }).catch((reason) => { if (!controller.signal.aborted) detailFailure(selectedId, reason) })
    }
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      refreshDetail()
      void loadList(undefined, true)
    }
    window.addEventListener('focus', refresh)
    const timer = processing || listProcessing ? setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (processing) refreshDetail()
      if (listProcessing) void loadList(undefined, true)
    }, 2000) : undefined
    return () => { controller.abort(); window.removeEventListener('focus', refresh); clearInterval(timer) }
  }, [processing, listProcessing, selectedId, apply, loadList, detailFailure])

  const searchWith = (change: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params)
    change(next)
    return `?${next}`
  }
  const clearSelection = () => {
    setPinnedId(null); setDetail(null); setDetailError(null); setView(null)
    const next = new URLSearchParams(params)
    next.delete('material')
    // 자료가 사라진 뒤의 이동은 미저장 확인을 거치지 않는다
    skipGuard.current = true
    try { setParams(next, { replace: true }) } finally { skipGuard.current = false }
    setListRevision((value) => value + 1)
  }
  const blocks: BlockerFunction = ({ currentLocation, nextLocation }) => {
    if (skipGuard.current) return false
    if (createDirty || currentLocation.pathname !== nextLocation.pathname) return true
    return (new URLSearchParams(nextLocation.search).get('material') ?? pinnedId) !== selectedId
  }

  async function more() {
    if (!visibleList?.nextCursor || moreLock.current) return
    moreLock.current = true
    const request = ++generation.current
    setMoreBusy(true)
    try {
      const data = await materialsApi.list(project.id, { q, kind, cursor: visibleList.nextCursor })
      if (request !== generation.current) return
      loadedPages.current = { key, count: visibleList.pages + 1 }
      setList((previous) => previous?.key === key ? {
        ...previous, nextCursor: data.nextCursor, counts: data.counts, pages: previous.pages + 1,
        items: [...previous.items, ...data.items.filter((item) => !previous.items.some((old) => old.id === item.id))],
      } : previous)
    } catch (reason) { setListError(reason); onError(reason, 'project') }
    finally { moreLock.current = false; setMoreBusy(false) }
  }

  async function reprocess() {
    if (!visible || retry.busy) return
    // 결과를 모르는 재시도는 같은 키로 다시 보낸다
    const pending = retryKey.current?.id === visible.id ? retryKey.current : { id: visible.id, key: crypto.randomUUID() }
    retryKey.current = pending
    setRetry({ busy: true })
    try {
      const result = await materialsApi.reprocess(pending.id, pending.key)
      retryKey.current = null
      apply(result.material); setRetry({ busy: false })
    } catch (reason) {
      if (!isUncertain(reason)) retryKey.current = null
      setRetry({ busy: false, error: reason }); onError(reason)
      if (reason instanceof ApiError && reason.code === 'MATERIAL_STATE_CONFLICT') setDetailRevision((value) => value + 1)
    }
  }

  // 마크다운 자료는 현재 개정의 본문을 읽어 와서 고친다
  async function editMemo(material: Material) {
    setManageError(undefined)
    try {
      const source = await materialsApi.source(material.id)
      setCreate({ type: 'memo', edit: { material, markdown: source.markdown ?? '' } })
    } catch (reason) { setManageError(reason); onError(reason) }
  }
  function created(material: Material) {
    const edited = !!create?.edit
    setCreate(null); setCreateDirty(false)
    setDetail((previous) => previous?.id === material.id || edited ? material : previous)
    setListRevision((value) => value + 1)
    setDetailRevision((value) => value + 1)
    // 팀 메모를 쓰는 중이면 새 자료로 옮기지 않는다
    if (edited || noteDirty) return
    const next = new URLSearchParams(params)
    next.set('material', material.id)
    skipGuard.current = true
    try { setParams(next) } finally { skipGuard.current = false }
  }

  const add = (type: InputType) => setCreate({ type })
  const heading = <div className={styles.heading}>
    <div className={styles.headingTitle}><h1>자료</h1><p>팀 자료를 추가하고 원문을 확인하세요.</p></div>
    <Button variant="secondary" onClick={() => add('file')}>자료 추가</Button>
  </div>
  const overlays = <>
    {create && <MaterialCreateDialog key={create.edit?.material.id ?? 'new'} project={project} initial={create.type} edit={create.edit}
      onClose={() => { setCreate(null); setCreateDirty(false) }} onDone={created} onDirtyChange={setCreateDirty} onError={onError} />}
    <UnsavedGuard dirty={noteDirty || createDirty} when={blocks} />
  </>

  // 새 검색을 불러오는 동안에도 이전 목록과 입력란을 그대로 둔다
  const shown = visibleList ?? list
  // 어느 상태에서도 모달이 같은 자리에 있어야 열어 둔 입력을 잃지 않는다
  if (!shown && listError) return <><div className={styles.page}><p className={styles.project}>{project.name}</p>{heading}
    <RequestError error={listError} action={<Button onClick={() => setListRevision((value) => value + 1)}>다시 불러오기</Button>} /></div>{overlays}</>
  if (!shown) return <><div className={styles.page}><p className={styles.project}>{project.name}</p>{heading}<StatusPanel kind="loading" title="자료를 불러오고 있어요" /></div>{overlays}</>

  // 자료가 하나도 없는 프로젝트
  if (visibleList?.counts.all === 0 && !q && !paramId) return <><div className={styles.empty}>
    <p className={styles.project}>{project.name}</p>
    <h1>아직 자료가 없어요</h1>
    <p className={styles.emptyLead}>PDF, 웹 링크 또는 메모를 추가하세요.</p>
    <div className={styles.types}>
      <section className={styles.type}><h2>PDF 파일</h2><p>PDF를 올리면 본문을 추출해요.</p><Button onClick={() => add('file')}>PDF 추가</Button></section>
      <section className={styles.type}><h2>웹 링크</h2><p>웹페이지 주소를 붙여 넣으세요.</p><Button variant="secondary" onClick={() => add('link')}>링크 추가</Button></section>
      <section className={styles.type}><h2>직접 쓴 메모</h2><p>회의 내용이나 아이디어를 마크다운으로 적으세요.</p><Button variant="secondary" onClick={() => add('memo')}>메모 작성</Button></section>
    </div>
    <p className={styles.hint}>추가한 자료는 프로젝트 팀원과 공유돼요.</p>
  </div>{overlays}</>

  const gone = detailError?.id === selectedId && isGone(detailError.reason)
  return <><div className={styles.page}>
    <p className={styles.project}>{project.name}</p>
    {heading}
    <div className={styles.workspace}>
      <div className={styles.list}>
        <label className={styles.search}>
          <img src="/assets/materials/search.svg" alt="" width={16} height={16} />
          <input type="search" aria-label="자료 검색" placeholder="자료 검색" value={input} maxLength={255} onChange={(event) => setInput(event.target.value)} />
        </label>
        <nav className={styles.filters} aria-label="자료 유형">
          {kinds.map((value) => <Link key={value} replace aria-current={kind === value ? 'true' : undefined}
            to={searchWith((next) => { if (value) next.set('kind', value); else next.delete('kind'); next.delete('material') })}>
            {value ? kindLabels[value] : '전체'} {shown.counts[value || 'all']}
          </Link>)}
        </nav>
        <RequestError error={listError} action={<Button variant="text" onClick={() => setListRevision((value) => value + 1)}>다시 불러오기</Button>} />
        {shown.items.length === 0
          ? <p className={styles.listNote} role="status">{!visibleList ? '자료를 불러오고 있어요' : q ? '검색 결과 0개' : '이 유형의 자료가 없어요'}</p>
          : <ul className={styles.rows} aria-busy={!visibleList || undefined}>{shown.items.map((item) => <li key={item.id}>
            <Link className={styles.row} aria-current={item.id === selectedId ? 'true' : undefined} to={searchWith((next) => next.set('material', item.id))}>
              <span className={styles.rowMeta}>{kindLine(item)}{item.status !== 'ready' && <> · <span className={item.status === 'failed' ? styles.failed : undefined}>{statusLabels[item.status]}</span></>}</span>
              <span className={styles.rowTitle}>{item.title}</span>
              <span className={styles.rowMeta}>{item.createdBy.name} · {formatWhen(item.createdAt)}</span>
            </Link>
          </li>)}</ul>}
        {visibleList?.nextCursor && <Button variant="secondary" loading={moreBusy} onClick={() => void more()}>더 보기</Button>}
      </div>

      <div className={styles.detail}>
        {visible && <MaterialDetail material={visible} retrying={retry.busy} retryError={retry.error}
          onRetry={() => void reprocess()} onManage={setView}
          actions={visible.status === 'ready' && visible.currentRevision ? <Button variant="secondary" onClick={() => setViewingId(visible.id)}>원문 보기</Button> : undefined}
          jobControls={<MaterialJob key={visible.job?.id ?? visible.id} material={visible} onChanged={apply} onError={onError} />}
          summary={visible.status === 'ready' && visible.currentRevision && <MaterialAiSummary key={visible.currentRevision.id}
            material={visible} onChanged={apply} onError={onError} />}
          extraMenu={visible.kind === 'memo' && visible.status === 'ready' ? (close) => <Button variant="text" role="menuitem" onClick={() => { close(); void editMemo(visible) }}>내용 수정</Button> : undefined}>
          <RequestError error={manageError} />
          <MaterialNote key={visible.id} materialId={visible.id} onDirtyChange={setNoteDirty} onError={onError} />
        </MaterialDetail>}
        {!visible && selectedId && gone && <div className={styles.guidance}>
          <p>{detailError?.reason instanceof ApiError && detailError.reason.code === 'MATERIAL_DELETED' ? '삭제된 자료예요' : '자료를 찾을 수 없어요'}</p>
          <p>다른 팀원이 삭제했거나 주소가 바뀌었을 수 있어요.</p>
          <div className={styles.actions}><Button onClick={clearSelection}>자료 목록 보기</Button></div>
        </div>}
        {!visible && selectedId && !gone && (detailError?.id === selectedId
          ? <RequestError error={detailError.reason} action={<Button onClick={() => setDetailRevision((value) => value + 1)}>다시 불러오기</Button>} />
          : <StatusPanel kind="loading" title="자료를 불러오고 있어요" />)}
        {!selectedId && !visibleList && <StatusPanel kind="loading" title="자료를 불러오고 있어요" />}
        {!selectedId && visibleList && (q && visibleList.counts.all === 0 ? <div className={styles.guidance}>
          <p>‘{q}’에 대한 자료가 없어요</p>
          <p>검색어를 바꾸거나 새로운 자료를 추가해 보세요.</p>
          <div className={styles.actions}><Button onClick={() => setInput('')}>검색 지우기</Button><Button variant="secondary" onClick={() => add('file')}>자료 추가</Button></div>
        </div> : <div className={styles.guidance}><p>이 유형의 자료가 없어요</p><p>다른 유형을 고르거나 전체 자료를 확인해 보세요.</p></div>)}
      </div>
    </div>
    {visible && view && <MaterialDialogs key={`${visible.id}:${view}`} material={visible} view={view} onClose={() => setView(null)}
      onChanged={apply} onDeleted={clearSelection} onError={onError}
      onRefresh={() => materialsApi.get(visible.id).then(apply)} />}
    {visible && viewingId === visible.id && <SourceViewer key={visible.id} material={visible} onClose={() => setViewingId(null)} onError={onError} />}
  </div>{overlays}</>
}
