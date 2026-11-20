import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router'
import type { Element, Presentation, Slide } from '../../../entities/presentation/schema.ts'
import { Button } from '../../../shared/ui/Button.tsx'
import { Modal } from '../../../shared/ui/Modal.tsx'
import layout from '../../../shared/ui/PageLayout.module.css'
import { RequestError } from '../../../shared/ui/RequestError.tsx'
import { StatusPanel } from '../../../shared/ui/StatusPanel.tsx'
import { UnsavedGuard } from '../../../shared/ui/UnsavedGuard.tsx'
import { fitScale } from '../coords.ts'
import { describeElement } from '../describe.ts'
import type { EditorSession, SaveStatus, SessionState } from '../session.ts'
import { SlideStage } from './SlideStage.tsx'
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

const rejectionMessages: Record<number, string> = {
  401: '로그인이 만료되었습니다. 다시 로그인해 주세요',
  403: '이 프로젝트에 더 이상 접근할 수 없습니다',
  404: '프로젝트를 찾을 수 없습니다',
}

// 가장 큰 글자의 첫 줄을 슬라이드 이름으로 쓴다
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
}

export function SlideEditor({ projectId, projectName, session, slideId, onCreateSample }: Props) {
  const state = useSyncExternalStore(session.subscribe, session.getState)
  const base = `/projects/${projectId}/slides`
  const view = state.view

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
  if (!view) return <NoPresentation projectId={projectId} onCreateSample={onCreateSample} />

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
      <header className={layout.header}>
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

      <div className={styles.editor}>
        <nav aria-label="슬라이드 목록" className={styles.slides}>
          <h2>슬라이드 {view.slides.length}</h2>
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
}: {
  session: EditorSession
  state: SessionState
  canvas: Presentation['canvas']
  slide: Slide
  heading: string
}) {
  const [selectedId, setSelectedId] = useState<string>()
  const [editingId, setEditingId] = useState<string>()
  const [zoom, setZoom] = useState(0)
  // 닫아 둔 충돌 안내. 요소 정보에서 다시 열 수 있다
  const [dismissed, setDismissed] = useState<string>()
  const [area, setArea] = useState<HTMLDivElement | null>(null)
  const [areaWidth, setAreaWidth] = useState(0)
  const selectedRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!area) return
    const observer = new ResizeObserver(([entry]) => setAreaWidth(entry.contentRect.width))
    observer.observe(area)
    return () => observer.disconnect()
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
  const scale = zoom > 0 ? zoom : fitScale(canvas, { width: areaWidth || 1, height: Infinity })
  const modified = slide.elements.some((element) =>
    ['dirty', 'saving', 'failed', 'conflict'].includes(statusOf(element.id)),
  )
  const selected = slide.elements.find((element) => element.id === selectedId)
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

  return (
    <>
      <section aria-label="슬라이드 편집" className={styles.stage}>
        <div className={styles.stageHead}>
          <h2>{heading}</h2>
          {modified && <span>수정됨</span>}
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
          />
        </div>
        <div className={styles.stageFoot}>
          <p>요소를 클릭해 선택하고 더블클릭해 글을 수정해요. 방향키로도 옮길 수 있어요</p>
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
                  onCommit={(value) =>
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
    </>
  )
}

// 요소 위치 한 칸. 입력란을 벗어나거나 Enter를 누를 때 반영한다
// 다른 요소를 골라 입력란이 사라질 때도 입력하던 값을 먼저 반영한다
function PositionField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string
  value: number
  disabled: boolean
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState<string>()
  const latest = useRef({ draft, value, onCommit })
  useEffect(() => {
    latest.current = { draft, value, onCommit }
  })

  function commit() {
    const current = latest.current
    if (current.draft === undefined || current.draft.trim() === '') return
    const next = Number(current.draft)
    if (Number.isFinite(next) && next !== current.value) current.onCommit(next)
  }
  useEffect(() => commit, [])

  return (
    <label>
      {label}
      <input
        type="number"
        step={1}
        value={draft ?? value}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          commit()
          setDraft(undefined)
        }}
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
}: {
  projectId: string
  onCreateSample?: () => Promise<void>
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
          <Link className={styles.primaryLink} to={`/projects/${projectId}/outline`}>
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
