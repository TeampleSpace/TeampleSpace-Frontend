import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import type { Element, Presentation, Slide } from '../../../entities/presentation/schema.ts'
import { Button } from '../../../shared/ui/Button.tsx'
import { Modal } from '../../../shared/ui/Modal.tsx'
import layout from '../../../shared/ui/PageLayout.module.css'
import { RequestError } from '../../../shared/ui/RequestError.tsx'
import { StatusPanel } from '../../../shared/ui/StatusPanel.tsx'
import { UnsavedGuard } from '../../../shared/ui/UnsavedGuard.tsx'
import { fitScale } from '../coords.ts'
import { describeElement } from '../describe.ts'
import { useProjectFonts } from '../projectFonts.ts'
import type { EditorSession, SaveStatus, SessionState } from '../session.ts'
import { SlideStage } from './SlideStage.tsx'
import { SlideRevision } from './SlideRevision.tsx'
import styles from './SlideEditor.module.css'

// 여러 요소의 상태 중 가장 먼저 알려야 하는 것
const statusOrder: SaveStatus[] = ['conflict', 'failed', 'saving', 'dirty', 'saved', 'clean']

const saveLabels: Record<SaveStatus, string> = {
  clean: '자동 저장됨',
  saved: '자동 저장됨',
  dirty: '저장 대기',
  saving: '저장 중',
  failed: '저장 실패',
  conflict: '확인이 필요한 수정이 있어요',
}

const typeLabels = { text: '텍스트', shape: '도형', image: '이미지' }

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? 'Cmd' : 'Ctrl'

const shortcuts: [string, string][] = [
  [`${mod} + Z`, '실행 취소'],
  [`${mod} + Shift + Z, ${mod} + Y`, '다시 실행'],
  [`${mod} + C`, '선택한 요소 복사'],
  [`${mod} + X`, '선택한 요소 잘라내기'],
  [`${mod} + V`, '복사한 요소 붙여넣기'],
  [`${mod} + D`, '선택한 요소 복제'],
  ['Delete, Backspace', '선택한 요소 삭제'],
  ['방향키', '선택한 요소 1px 이동, Shift를 함께 누르면 10px 이동'],
  ['Enter', '선택한 글상자 수정'],
  ['Esc', '글 수정 끝내기, 선택 해제'],
  ['Tab', '다음 요소 선택'],
  ['Page Up, Page Down', '이전 슬라이드, 다음 슬라이드'],
  ['Home, End', '첫 슬라이드, 마지막 슬라이드'],
  [`${mod} + S`, '남은 입력 바로 저장'],
  ['?', '단축키 안내 열기'],
]

// 붙여넣기에 쓰는 복사한 요소. 현재 탭에만 둔다
let clipboard: Element | undefined

// 입력창, 선택 상자, 모달 안에서는 단축키를 쓰지 않고 기본 입력을 따른다
function typing(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"], dialog'))
}

// 같은 자리에 겹치지 않게 옮기고 맨 위에 놓는다
function placed(source: Element, slide: Slide): Element {
  const others = slide.elements.filter((element) => !element.deletedAt)
  let { x, y } = source.geometry
  while (others.some((element) => element.geometry.x === x && element.geometry.y === y)) {
    x += 20
    y += 20
  }
  const z = Math.max(0, ...others.map((element) => element.geometry.z)) + 1
  return { ...source, geometry: { ...source.geometry, x, y, z } } as Element
}

const rejectionMessages: Record<number, string> = {
  401: '로그인이 만료되었습니다. 다시 로그인해 주세요',
  403: '이 프로젝트에 더 이상 접근할 수 없습니다',
  404: '프로젝트를 찾을 수 없습니다',
}

// 가장 큰 글자의 첫 줄을 슬라이드 이름으로 쓴다
type ResizerProps = { label: string; storageKey: string; cssVar: string; min: number; max: number; initial: number; side: 'left' | 'right'; className?: string }

// 칸 경계를 끌거나 방향키로 폭을 바꾸고 이 브라우저에만 기억한다. 폭은 편집 격자의 CSS 변수로 넘긴다
function Resizer({ label, storageKey, cssVar, min, max, initial, side, className }: ResizerProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey))
      return saved >= min && saved <= max ? saved : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    const grid = ref.current?.closest<HTMLElement>('[data-resizable]')
    grid?.style.setProperty(cssVar, `${width}px`)
  }, [cssVar, width])
  const resize = (next: number) => {
    const clamped = Math.round(Math.min(max, Math.max(min, next)))
    setWidth(clamped)
    try { localStorage.setItem(storageKey, String(clamped)) } catch { /* 저장이 막혀도 이번 화면에서는 유지한다 */ }
  }
  // 오른쪽 칸은 왼쪽으로 끌거나 왼쪽 방향키를 누를 때 넓어진다
  const grow = side === 'right' ? 1 : -1
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const handle = event.currentTarget
    handle.focus()
    const box = handle.parentElement!.getBoundingClientRect()
    handle.setPointerCapture(event.pointerId)
    const move = (moved: PointerEvent) => resize(side === 'right' ? moved.clientX - box.left : box.right - moved.clientX)
    const end = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }
  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      className={`${styles.resizer} ${className ?? ''}`}
      data-side={side}
      onPointerDown={startResize}
      onKeyDown={(event) => {
        const step = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0
        if (!step) return
        event.preventDefault()
        resize(width + step * grow)
      }}
    />
  )
}

function slideName(slide: Slide, index: number): string {
  let title: { text: string; size: number } | undefined
  for (const element of slide.elements) {
    if (element.type !== 'text' || element.deletedAt) continue
    const text = element.content.text.trim().split('\n')[0]
    if (text && (!title || element.style.fontSize > title.size)) {
      title = { text, size: element.style.fontSize }
    }
  }
  return title?.text ?? `슬라이드 ${index + 1}`
}

// 충돌 안내에 보여 줄 요소 내용. 위치는 서로 다를 때만 덧붙인다
function summarize(element: Element | undefined, other: Element | undefined): string {
  if (!element) return '불러오는 중'
  const label = element.type === 'text' ? element.content.text : describeElement(element)
  const { x, y } = element.geometry
  const moved = other && (other.geometry.x !== x || other.geometry.y !== y)
  return moved || element.type !== 'text' ? `${label} (위치 X ${x}, Y ${y})` : label
}

type Props = {
  projectId: string
  projectName: string
  session: EditorSession
  // 주소에 있는 슬라이드. 없거나 모르는 값이면 첫 슬라이드를 연다
  slideId?: string
  // 개발 서버에서만 넘긴다. 편집을 확인할 예제 문서를 만든다
  onCreateSample?: () => Promise<void>
  // 문서가 없을 때 보여 줄 PPT 생성 버튼
  generate?: ReactNode
  // 서버가 AI 수정을 지원할 때만 요청 버튼을 보여 준다
  aiRevision?: boolean
}

export function SlideEditor({ projectId, projectName, session, slideId, onCreateSample, generate, aiRevision = false }: Props) {
  const state = useSyncExternalStore(session.subscribe, session.getState)
  const navigate = useNavigate()
  const base = `/projects/${projectId}/slides`
  const view = state.view
  useProjectFonts(projectId, view?.slides.flatMap((slide) =>
    slide.elements.flatMap((element) => element.type === 'text' ? [element.style.fontFamily] : [])) ?? [])

  if (state.rejected) {
    return (
      <>
        <StatusPanel
          kind="error"
          title={rejectionMessages[state.rejected.status] ?? '편집을 이어갈 수 없습니다'}
        />
        <Link to="/">프로젝트 목록으로</Link>
      </>
    )
  }
  if (!state.loaded) {
    return state.connection === 'offline' ? (
      <StatusPanel
        kind="error"
        title="슬라이드를 불러오지 못했어요"
        description="연결 상태를 확인하고 다시 시도해 주세요"
        action={<Button onClick={session.reconnect}>다시 연결</Button>}
      />
    ) : (
      <StatusPanel kind="loading" title="슬라이드를 불러오고 있어요" />
    )
  }
  if (!view) return <NoPresentation projectId={projectId} onCreateSample={onCreateSample} generate={generate} />

  const index = Math.max(0, view.slides.findIndex((slide) => slide.id === slideId))
  const slide = view.slides[index]
  const online = state.connection === 'online'
  const statuses = Object.values(state.elements).map((element) => element.status)
  const overall = statusOrder.find((status) => statuses.includes(status)) ?? 'clean'
  const failed = Object.keys(state.elements).filter((id) => state.elements[id].status === 'failed')
  // 다른 슬라이드에 남은 충돌은 그 슬라이드로 가서 확인한다
  const conflictElsewhere = view.slides.find(
    (candidate) =>
      candidate.id !== slide.id &&
      candidate.elements.some((element) => state.elements[element.id]?.status === 'conflict'),
  )

  return (
    <>
      {/* 편집 화면을 떠날 때 남은 입력을 먼저 보내고, 보내지 못한 입력이 있을 때만 막는다 */}
      <UnsavedGuard
        dirty={state.pending}
        when={({ nextLocation }) => !nextLocation.pathname.startsWith(base) && session.flush()}
      />
      <header className={`${layout.header} ${styles.header}`}>
        <div className={styles.title}>
          <h1>{projectName}</h1>
          <p role="status">
            {online ? saveLabels[overall] : '연결 끊김'}
            {online && failed.length > 0 && (
              <Button variant="text" onClick={() => failed.forEach((id) => session.retry(id))}>
                다시 시도
              </Button>
            )}
          </p>
        </div>
        <Link to={`/projects/${projectId}?team=1`}>팀원 {state.memberCount}명</Link>
      </header>

      {!online && (
        <div role="alert" className={styles.banner}>
          <p>연결이 끊겼어요. 미전송 입력은 현재 탭에만 남아 있어요. 다시 연결되면 이어서 저장해요.</p>
          <Button variant="secondary" onClick={session.reconnect}>
            다시 연결
          </Button>
        </div>
      )}
      {conflictElsewhere && (
        <div role="alert" className={styles.banner}>
          <p>다른 슬라이드에 확인이 필요한 수정이 있어요.</p>
          <Link to={`${base}/${conflictElsewhere.id}`}>확인하러 가기</Link>
        </div>
      )}

      <div className={styles.editor} data-resizable>
        <nav aria-label="슬라이드 목록" className={styles.slides}>
          <Resizer label="슬라이드 목록 폭" storageKey="teamplespace.slideListWidth" cssVar="--list-width" min={120} max={360} initial={144} side="right" />
          <h2>슬라이드 {view.slides.length}장</h2>
          <ol>
            {view.slides.map((candidate, position) => (
              <li key={candidate.id}>
                <Link
                  to={`${base}/${candidate.id}`}
                  aria-current={candidate.id === slide.id ? 'page' : undefined}
                >
                  {slideName(candidate, position)}
                </Link>
              </li>
            ))}
          </ol>
        </nav>
        <Workspace
          key={slide.id}
          session={session}
          state={state}
          canvas={view.canvas}
          slide={slide}
          heading={`${String(index + 1).padStart(2, '0')} / ${slideName(slide, index)}`}
          label={`${String(index + 1).padStart(2, '0')}번 - ${slideName(slide, index)}`}
          aiRevision={aiRevision}
          onGo={(target) => {
            const last = view.slides.length - 1
            const next = { prev: index - 1, next: index + 1, first: 0, last }[target]
            if (next >= 0 && next <= last && next !== index) navigate(`${base}/${view.slides[next].id}`)
          }}
        />
      </div>
    </>
  )
}

// 슬라이드 하나의 캔버스와 요소 정보. 슬라이드를 바꾸면 선택을 새로 시작한다
function Workspace({
  session,
  state,
  canvas,
  slide,
  heading,
  label,
  aiRevision,
  onGo,
}: {
  session: EditorSession
  state: SessionState
  canvas: Presentation['canvas']
  slide: Slide
  heading: string
  label: string
  aiRevision: boolean
  onGo: (target: 'prev' | 'next' | 'first' | 'last') => void
}) {

  const [selectedId, setSelectedId] = useState<string>()
  const [editingId, setEditingId] = useState<string>()
  const [zoom, setZoom] = useState(0)
  // 닫아 둔 충돌 안내. 요소 정보에서 다시 열 수 있다
  const [dismissed, setDismissed] = useState<string>()
  const [area, setArea] = useState<HTMLDivElement | null>(null)
  // 맞춤 배율에 쓰는 편집 영역 크기. 높이는 화면 아래까지 남은 공간이다
  const [areaSize, setAreaSize] = useState({ width: 0, height: 0 })
  const selectedRef = useRef<string | undefined>(undefined)
  const [help, setHelp] = useState(false)
  // 단축키 결과 안내. 화면 읽기 도구에도 읽힌다
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!area) return
    const measure = () => {
      const style = getComputedStyle(area)
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
      // 아래 안내 줄과 여백만큼 남기고 슬라이드 전체가 한 화면에 들어오게 한다
      const height = window.innerHeight - area.getBoundingClientRect().top - padding - 72
      setAreaSize({ width: area.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), height: Math.max(height, 240) })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(area)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [area])

  // 다른 슬라이드로 가거나 화면을 떠날 때 남은 입력을 바로 저장한다
  useEffect(
    () => () => {
      if (selectedRef.current) session.endEdit(selectedRef.current)
    },
    [session],
  )

  const online = state.connection === 'online'
  const statusOf = (id: string) => state.elements[id]?.status ?? 'clean'
  const locked = (id: string) => !online || statusOf(id) === 'conflict'
  const scale = zoom > 0 ? zoom : fitScale(canvas, { width: areaSize.width || 1, height: areaSize.height || Infinity })
  const modified = slide.elements.some((element) =>
    ['dirty', 'saving', 'failed', 'conflict'].includes(statusOf(element.id)),
  )
  const selected = slide.elements.find((element) => element.id === selectedId && !element.deletedAt)
  const conflict = slide.elements.find((element) => statusOf(element.id) === 'conflict')
  const latest = conflict ? state.elements[conflict.id]?.serverLatest : undefined

  function select(id: string | undefined) {
    // 선택이 다른 요소로 옮겨 가면 이전 요소의 편집 묶음을 닫는다
    if (selectedId && selectedId !== id) session.endEdit(selectedId)
    if (editingId && editingId !== id) setEditingId(undefined)
    selectedRef.current = id
    setSelectedId(id)
  }

  function startEditing(id: string) {
    select(id)
    setEditingId(id)
  }

  function resolve(keep: 'server' | 'mine') {
    if (!conflict) return
    session.resolveConflict(conflict.id, keep)
    if (keep === 'server') return
    // 내 입력을 다시 열어 두고 이어서 고치게 한다. 다른 요소로 옮기거나 편집을 끝내면 저장한다
    if (conflict.type !== 'text') return select(conflict.id)
    startEditing(conflict.id)
    // 이미 열려 있던 입력창이면 모달이 닫힌 뒤 포커스를 다시 준다
    requestAnimationFrame(() => area?.querySelector('textarea')?.focus())
  }

  // 새로 생긴 요소를 고르고 키보드로 이어서 다룰 수 있게 포커스를 준다
  function focusElement(id: string) {
    select(id)
    requestAnimationFrame(() => area?.querySelector<HTMLElement>(`[data-element="${id}"]`)?.focus())
  }

  function run(work: Promise<unknown>, done?: string) {
    work.then(() => done && setMessage(done)).catch((error: unknown) =>
      setMessage(error instanceof Error && !(error instanceof TypeError) ? error.message : '처리하지 못했어요. 다시 시도해 주세요'))
  }

  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || typing(event.target)) return
    const command = event.ctrlKey || event.metaKey
    // 한글 자판에서도 같은 자리의 글쇠로 동작하도록 글쇠 위치를 먼저 본다
    const key = command ? (event.code || `Key${event.key.toUpperCase()}`) : event.key
    const handle = (action: () => void) => {
      event.preventDefault()
      action()
    }
    if (!command) {
      if (event.altKey) return
      if (key === '?' || (event.shiftKey && (key === '/' || event.code === 'Slash'))) return handle(() => setHelp(true))
      if (key === 'PageUp') return handle(() => onGo('prev'))
      if (key === 'PageDown') return handle(() => onGo('next'))
      if (key === 'Home') return handle(() => onGo('first'))
      if (key === 'End') return handle(() => onGo('last'))
      if ((key === 'Delete' || key === 'Backspace') && selected) {
        return handle(() => {
          const id = selected.id
          run(session.deleteElement(id).then(() => select(undefined)), `삭제했어요. ${mod} + Z로 되돌릴 수 있어요`)
        })
      }
      return
    }
    if (event.altKey) return
    // 페이지의 글을 골라 둔 상태면 브라우저 복사를 그대로 둔다
    const hasTextSelection = Boolean(window.getSelection()?.toString())
    if (key === 'KeyS') return handle(() => setMessage(session.flush() ? '저장하지 못한 입력이 있어요' : '저장했어요'))
    if (key === 'KeyZ' || key === 'KeyY') {
      const redo = key === 'KeyY' || event.shiftKey
      return handle(() =>
        run(
          (redo ? session.redo() : session.undo()).then((applied) => {
            if (!applied) throw new Error(redo ? '다시 실행할 작업이 없어요' : '되돌릴 작업이 없어요')
          }),
          redo ? '다시 실행했어요' : '되돌렸어요',
        ))
    }
    if ((key === 'KeyC' || key === 'KeyX') && selected && !hasTextSelection) {
      return handle(() => {
        if (selected.type === 'image') return setMessage('이미지는 아직 복사할 수 없어요')
        clipboard = selected
        if (key === 'KeyC') return setMessage('복사했어요')
        const id = selected.id
        run(session.deleteElement(id).then(() => select(undefined)), '잘라냈어요')
      })
    }
    if (key === 'KeyV' && clipboard) {
      const source = clipboard
      return handle(() => run(session.createElement(slide.id, placed(source, slide)).then((created) => focusElement(created.id)), '붙여넣었어요'))
    }
    if (key === 'KeyD' && selected) {
      return handle(() => {
        if (selected.type === 'image') return setMessage('이미지는 아직 복제할 수 없어요')
        run(session.createElement(slide.id, placed(selected, slide)).then((created) => focusElement(created.id)), '복제했어요')
      })
    }
  })

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onShortcut(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  return (
    <>
      <section aria-label="슬라이드 편집" className={styles.stage}>
        <div className={styles.stageHead}>
          <h2>{heading}</h2>
          <div className={styles.stageActions}>
            {modified && <span>수정됨</span>}
            {aiRevision && (
              <SlideRevision
                session={session}
                slide={slide}
                label={label}
                busy={modified}
                disabled={!online || !slide.elements.some((element) => element.type === 'text' && !element.deletedAt)}
              />
            )}
          </div>
        </div>
        <div ref={setArea} className={styles.stageArea}>
          <SlideStage
            canvas={canvas}
            slide={slide}
            scale={scale}
            selectedId={selectedId}
            editingId={editingId}
            locked={locked}
            onSelect={select}
            onEditingChange={(id) => (id ? startEditing(id) : setEditingId(undefined))}
            onChange={(id, patch, input) => session.edit(id, patch, input)}
            onCommit={(id) => session.endEdit(id)}
            cursors={state.cursors
              .filter((cursor) => cursor.slideId === slide.id)
              .map((cursor) => ({ ...cursor, name: state.memberNames[cursor.userId] ?? '팀원' }))}
            onPointer={(point) => (point ? session.movePointer(slide.id, point.x, point.y) : session.movePointer(null))}
          />
        </div>
        <div className={styles.stageFoot}>
          <p>요소를 클릭해 선택하고 더블클릭해 글을 수정해요. 끌면 다른 요소와 가운데에 맞춰지고 Alt를 누르면 그대로 옮겨요</p>
          <p aria-live="polite" className={styles.shortcutMessage}>{message}</p>
          <Button variant="text" onClick={() => setHelp(true)}>
            단축키
          </Button>
          <label>
            배율
            <select value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>
              <option value={0}>맞춤</option>
              <option value={0.5}>50%</option>
              <option value={1}>100%</option>
              <option value={1.5}>150%</option>
            </select>
          </label>
        </div>
      </section>

      <aside aria-label="요소 정보" className={styles.inspector}>
        <Resizer label="요소 편집 패널 폭" storageKey="teamplespace.inspectorWidth" cssVar="--inspector-width" min={200} max={420} initial={240} side="left" className={styles.inspectorResizer} />
        {!online ? (
          <>
            <h2>슬라이드 요소 편집</h2>
            <p>연결이 복구되면 편집할 수 있어요. 미전송 입력은 현재 탭에만 보관돼요.</p>
          </>
        ) : !selected ? (
          <>
            <h2>슬라이드 요소 편집</h2>
            <p>텍스트나 도형을 선택해 수정하세요. 드래그해 위치를 옮길 수 있어요.</p>
          </>
        ) : (
          <>
            <h2>{typeLabels[selected.type]}</h2>
            {statusOf(selected.id) === 'conflict' && (
              <div role="alert" className={styles.notice}>
                <p>다른 팀원이 먼저 수정했어요</p>
                <Button variant="secondary" onClick={() => setDismissed(undefined)}>
                  내용 확인
                </Button>
              </div>
            )}
            {statusOf(selected.id) === 'failed' && (
              <div role="alert" className={styles.notice}>
                <p>저장하지 못했어요. 입력한 내용은 남아 있어요</p>
                <Button variant="secondary" onClick={() => session.retry(selected.id)}>
                  다시 시도
                </Button>
              </div>
            )}
            {selected.type === 'text' && (
              <>
                <Button
                  variant="secondary"
                  disabled={locked(selected.id)}
                  onClick={() => startEditing(selected.id)}
                >
                  슬라이드에서 글 수정
                </Button>
                <h3>글꼴</h3>
                <ul className={styles.chips}>
                  <li>{selected.style.fontFamily}</li>
                  <li>{selected.style.fontSize}</li>
                  <li>{selected.style.fontWeight >= 600 ? '굵게' : '보통'}</li>
                </ul>
              </>
            )}
            {selected.type === 'image' && <p>{selected.content.alt}</p>}
            <h3>위치</h3>
            <div className={styles.position}>
              {(['x', 'y'] as const).map((axis) => (
                <PositionField
                  key={`${selected.id}-${axis}`}
                  label={axis.toUpperCase()}
                  value={selected.geometry[axis]}
                  disabled={locked(selected.id)}
                  onChange={(value) =>
                    session.edit(selected.id, { geometry: { ...selected.geometry, [axis]: value } })
                  }
                />
              ))}
            </div>
            <h3>크기</h3>
            <p>
              너비 {selected.geometry.width}, 높이 {selected.geometry.height}
            </p>
          </>
        )}
      </aside>

      <Modal
        open={Boolean(conflict) && dismissed !== conflict?.id}
        title="같은 요소가 수정됐어요"
        description="내용을 확인하고 이어서 편집하세요."
        size="confirm"
        onClose={() => setDismissed(conflict?.id)}
        footer={
          <>
            <Button disabled={!latest} onClick={() => resolve('server')}>
              최신 내용으로 계속
            </Button>
            <Button variant="secondary" disabled={!latest} onClick={() => resolve('mine')}>
              내 입력으로 다시 편집
            </Button>
          </>
        }
      >
        <p className={styles.compare}>서버의 최신 내용: {summarize(latest, conflict)}</p>
        <p className={styles.compare}>내가 입력한 내용: {summarize(conflict, latest)}</p>
      </Modal>
      <Modal open={help} title="단축키" description="글을 고치는 중에는 입력창의 기본 단축키가 먼저 적용돼요." onClose={() => setHelp(false)}>
        <dl className={styles.shortcuts}>
          {shortcuts.map(([keys, action]) => (
            <div key={keys}>
              <dt>{keys}</dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
      </Modal>
    </>
  )
}

// 요소 위치 한 칸. 입력하는 대로 편집 세션에 반영해 다른 입력과 같은 방식으로 저장하고 보호한다
function PositionField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  // 입력하는 동안에는 지우는 중인 빈 값도 그대로 보여 준다
  const [draft, setDraft] = useState<string>()

  return (
    <label>
      {label}
      <input
        type="number"
        step={1}
        value={draft ?? value}
        disabled={disabled}
        onChange={(event) => {
          const text = event.target.value
          setDraft(text)
          const next = Number(text)
          if (text.trim() !== '' && Number.isFinite(next) && next !== value) onChange(next)
        }}
        onBlur={() => setDraft(undefined)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      px
    </label>
  )
}

// 아직 발표 자료를 만들기 전
function NoPresentation({
  projectId,
  onCreateSample,
  generate,
}: {
  projectId: string
  onCreateSample?: () => Promise<void>
  generate?: ReactNode
}) {
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<unknown>()

  return (
    <>
      <header className={layout.header}>
        <div className={styles.intro}>
          <h1>아직 만든 PPT가 없어요.</h1>
          <p>발표 구성을 정하고 디자인을 고르면, 팀원들과 함께 편집할 PPT가 만들어져요.</p>
        </div>
      </header>
      <section className={styles.steps}>
        <h2>자료 모으기, 발표 구성, 디자인 선택, PPT 생성</h2>
        <div className={styles.row}>
          {generate}
          <Link className={generate ? styles.secondaryLink : styles.primaryLink} to={`/projects/${projectId}/outline`}>
            발표 구성으로 이동
          </Link>
          {onCreateSample && (
            <Button
              variant="secondary"
              loading={creating}
              onClick={() => {
                setCreating(true)
                setError(undefined)
                onCreateSample()
                  .catch(setError)
                  .finally(() => setCreating(false))
              }}
            >
              개발용 예제 문서 만들기
            </Button>
          )}
        </div>
        <RequestError error={error} />
      </section>
    </>
  )
}
