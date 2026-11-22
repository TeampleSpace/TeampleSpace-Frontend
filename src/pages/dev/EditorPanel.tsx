import { useEffect, useState, useSyncExternalStore } from 'react'
import { fitScale } from '../../features/editor/coords.ts'
import type { EditorSession, SaveStatus } from '../../features/editor/session.ts'
import { describeElement as describe } from '../../features/editor/describe.ts'
import { SlideStage } from '../../features/editor/ui/SlideStage.tsx'
import { Button } from '../../shared/ui/Button.tsx'
import { StatusPanel } from '../../shared/ui/StatusPanel.tsx'
import styles from './EditorLab.module.css'

const statusLabels: Record<SaveStatus, string> = {
  clean: '변경 없음',
  dirty: '저장 대기',
  saving: '저장 중',
  saved: '저장됨',
  failed: '저장 실패',
  conflict: '충돌',
}

// 여러 요소의 상태 중 가장 먼저 알려야 하는 것
const statusOrder: SaveStatus[] = ['conflict', 'failed', 'saving', 'dirty', 'saved', 'clean']

export function EditorPanel({
  label,
  session,
  zoom,
  slideIndex,
}: {
  label: string
  session: EditorSession
  // 0이면 영역 너비에 맞춘다
  zoom: number
  slideIndex: number
}) {
  const state = useSyncExternalStore(session.subscribe, session.getState)
  const [selectedId, setSelectedId] = useState<string>()
  const [editingId, setEditingId] = useState<string>()
  // 문서를 불러온 뒤에 생기는 영역이라 요소가 붙는 시점부터 너비를 잰다
  const [area, setArea] = useState<HTMLDivElement | null>(null)
  const [areaWidth, setAreaWidth] = useState(0)

  useEffect(() => {
    if (!area) return
    const observer = new ResizeObserver(([entry]) => setAreaWidth(entry.contentRect.width))
    observer.observe(area)
    return () => observer.disconnect()
  }, [area])

  const view = state.view
  if (!view) {
    return (
      <section className={styles.panel} aria-label={label}>
        <h2>{label}</h2>
        <StatusPanel kind="loading" title="문서를 불러오는 중이에요" />
      </section>
    )
  }

  const slide = view.slides[slideIndex] ?? view.slides[0]
  const elements = slide.elements
  const online = state.connection === 'online'
  const scale =
    zoom > 0 ? zoom : fitScale(view.canvas, { width: areaWidth || 1, height: Infinity })
  const overall = statusOrder.find((status) =>
    elements.some((element) => state.elements[element.id]?.status === status),
  )

  function select(id: string | undefined) {
    // 선택이 다른 요소로 옮겨 가면 이전 요소의 편집 묶음을 닫는다
    if (selectedId && selectedId !== id) session.endEdit(selectedId)
    setSelectedId(id)
  }

  function startEditing(id: string) {
    select(id)
    setEditingId(id)
  }

  const conflicts = elements.filter(
    (element) => state.elements[element.id]?.status === 'conflict',
  )
  const sources = elements.filter((element) => element.sourceRefs.length > 0)

  return (
    <section className={styles.panel} aria-label={label}>
      <h2>{label}</h2>
      <p role="status" className={styles.status}>
        {online
          ? statusLabels[overall ?? 'clean']
          : '연결 끊김. 입력한 내용은 이 탭에 남아 있고 다시 연결될 때까지 새 편집을 막아요'}
      </p>

      <div ref={setArea} className={styles.stageArea}>
        <SlideStage
          canvas={view.canvas}
          slide={slide}
          scale={scale}
          selectedId={selectedId}
          editingId={editingId}
          locked={(id) => !online || state.elements[id]?.status === 'conflict'}
          onSelect={select}
          onEditingChange={(id) => (id ? startEditing(id) : setEditingId(undefined))}
          onChange={(id, patch, input) => session.edit(id, patch, input)}
          onCommit={(id) => session.endEdit(id)}
        />
      </div>

      {conflicts.map((element) => {
        const latest = state.elements[element.id]?.serverLatest
        return (
          <div key={element.id} role="alert" className={styles.conflict}>
            <p>다른 팀원이 먼저 수정했어요. 내 입력으로 덮어쓰지 않았어요</p>
            <p>
              서버의 최신 내용
              <br />
              {latest?.type === 'text' ? latest.content.text : '불러오는 중'}
            </p>
            <p>
              내 입력
              <br />
              {element.type === 'text' ? element.content.text : describe(element)}
            </p>
            <div className={styles.row}>
              <Button
                variant="secondary"
                disabled={!latest}
                onClick={() => session.resolveConflict(element.id, 'server')}
              >
                최신 내용으로 계속
              </Button>
              <Button
                variant="secondary"
                disabled={!latest}
                onClick={() => {
                  session.resolveConflict(element.id, 'mine')
                  if (element.type === 'text') startEditing(element.id)
                }}
              >
                내 입력으로 다시 편집
              </Button>
            </div>
          </div>
        )
      })}

      {/* 끌기 없이 키보드로도 요소를 고르고 편집할 수 있는 목록 */}
      <h3>요소</h3>
      <ul className={styles.elements}>
        {elements.map((element) => {
          const status = state.elements[element.id]?.status ?? 'clean'
          return (
            <li key={element.id}>
              <button
                type="button"
                className={styles.elementButton}
                aria-pressed={element.id === selectedId}
                onClick={() => select(element.id)}
              >
                {describe(element)}
              </button>
              {element.type === 'text' && (
                <button
                  type="button"
                  className={styles.elementButton}
                  disabled={!online || status === 'conflict'}
                  aria-label={`${describe(element)} 편집`}
                  onClick={() => startEditing(element.id)}
                >
                  편집
                </button>
              )}
              {status === 'failed' && (
                <button
                  type="button"
                  className={styles.elementButton}
                  aria-label={`${describe(element)} 저장 다시 시도`}
                  onClick={() => session.retry(element.id)}
                >
                  다시 시도
                </button>
              )}
              <span className={styles.meta}>
                {statusLabels[status]}, 버전 {element.version}
              </span>
            </li>
          )
        })}
      </ul>

      <h3>출처</h3>
      <ul className={styles.elements}>
        {sources.flatMap((element) =>
          element.sourceRefs.map((source, index) => (
            <li key={`${element.id}-${index}`} className={styles.meta}>
              {describe(element)}: 자료 {source.materialId.slice(0, 8)}, 개정 {source.sourceVersion}
              {source.page ? `, ${source.page}쪽` : ''}
              {source.excerpt ? `, 인용 ${source.excerpt}` : ''}
              {source.sourceDeleted ? ', 삭제된 자료' : ''}
            </li>
          )),
        )}
      </ul>

      <p className={styles.meta}>
        배율 {Math.round(scale * 100)}%, 중복 이벤트 {state.stats.duplicateEvents}건, 지난 버전
        이벤트 {state.stats.staleEvents}건, 스냅샷 {state.stats.snapshots}회
      </p>
    </section>
  )
}
