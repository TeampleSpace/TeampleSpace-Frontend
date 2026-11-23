import { useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import type {
  Element,
  ElementPatch,
  Presentation,
  Slide,
  TextElement,
} from '../../../entities/presentation/schema.ts'
import { deltaToDoc } from '../coords.ts'
import { describeElement } from '../describe.ts'
import { snap } from '../snap.ts'
import type { Guide } from '../snap.ts'
import { textStyle } from '../textStyle.ts'
import { SlideRenderer } from './SlideRenderer.tsx'
import styles from './SlideStage.module.css'

// moved는 맞춤 전 포인터가 움직인 거리로, 클릭과 끌기를 가른다
type Drag = { id: string; startX: number; startY: number; dx: number; dy: number; moved: number; guides: Guide[] }

// 이 거리 안으로 가까워지면 기준선에 붙인다. 화면 픽셀 단위다
const snapDistance = 6

// 한글 조합 입력을 받는 글상자. 조합 중인지 함께 알린다
function TextEditor({
  element,
  readOnly,
  onInput,
  onDone,
}: {
  element: TextElement
  readOnly: boolean
  onInput: (value: string, composing: boolean) => void
  // Esc로 끝냈으면 키보드로 이어서 조작할 수 있게 요소로 포커스를 돌려준다
  onDone: (escaped: boolean) => void
}) {
  const composing = useRef(false)
  const escaped = useRef(false)
  const { x, y, width, height } = element.geometry

  return (
    <textarea
      className={styles.textEditor}
      style={{ left: x, top: y, width, height, ...textStyle(element) }}
      aria-label="텍스트 편집"
      autoFocus
      readOnly={readOnly}
      // 화면용 문서의 글을 그대로 보여 준다. 내 입력이 없을 때 온 다른 사람의 수정도 바로 보인다
      value={element.content.text}
      onChange={(event) => onInput(event.target.value, composing.current)}
      onCompositionStart={() => {
        composing.current = true
      }}
      onCompositionEnd={(event) => {
        // 조합이 끝난 글자부터 저장 대기 시간을 센다
        composing.current = false
        onInput(event.currentTarget.value, false)
      }}
      onBlur={() => onDone(escaped.current)}
      onKeyDown={(event) => {
        // 입력 중의 키는 요소 조작으로 넘기지 않는다
        event.stopPropagation()
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
          escaped.current = true
          event.currentTarget.blur()
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
    />
  )
}

type Props = {
  canvas: Presentation['canvas']
  slide: Slide
  // 화면 배율. 문서 좌표는 바꾸지 않는다
  scale: number
  selectedId?: string
  editingId?: string
  // 연결이 끊겼거나 충돌을 해결하기 전이라 편집을 받지 않는 요소
  locked: (elementId: string) => boolean
  onSelect: (elementId: string | undefined) => void
  onEditingChange: (elementId: string | undefined) => void
  onChange: (elementId: string, patch: ElementPatch, input?: { composing?: boolean }) => void
  // 끌어 놓기나 글 수정처럼 한 번의 조작이 끝났다
  onCommit: (elementId: string) => void
}

const arrows: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

// 슬라이드 위에서 요소를 고르고 옮기고 글을 고치는 영역. 저장은 호출한 쪽이 맡는다
export function SlideStage({
  canvas,
  slide,
  scale,
  selectedId,
  editingId,
  locked,
  onSelect,
  onEditingChange,
  onChange,
  onCommit,
}: Props) {
  const [drag, setDrag] = useState<Drag>()
  const stage = useRef<HTMLDivElement>(null)
  // 위에 그려진 요소가 먼저 잡히도록 그리는 순서와 같게 둔다
  const elements = slide.elements
    .filter((element) => !element.deletedAt)
    .sort((a, b) => a.geometry.z - b.geometry.z)
  const byId = (id: string) => elements.find((element) => element.id === id)

  // 끄는 동안에는 화면에서만 미리 옮겨 보여 준다
  const moved = (element: Element): Element =>
    drag && element.id === drag.id
      ? ({
          ...element,
          geometry: {
            ...element.geometry,
            x: element.geometry.x + drag.dx,
            y: element.geometry.y + drag.dy,
          },
        } as Element)
      : element
  const shown = drag ? { ...slide, elements: slide.elements.map(moved) } : slide

  function onPointerDown(event: PointerEvent<HTMLDivElement>, id: string) {
    event.stopPropagation()
    onSelect(id)
    if (locked(id)) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ id, startX: event.clientX, startY: event.clientY, dx: 0, dy: 0, moved: 0, guides: [] })
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag) return
    // 화면에서 움직인 거리를 현재 배율로 나눠 문서 좌표로 바꾼다
    const delta = deltaToDoc(event.clientX - drag.startX, event.clientY - drag.startY, scale)
    const geometry = byId(drag.id)?.geometry
    const moved = Math.abs(delta.x) + Math.abs(delta.y)
    // Alt를 누르고 끌면 맞추지 않고 그대로 옮긴다
    if (!geometry || event.altKey) {
      setDrag({ ...drag, dx: delta.x, dy: delta.y, moved, guides: [] })
      return
    }
    const others = elements.filter((element) => element.id !== drag.id).map((element) => element.geometry)
    const fit = snap({ ...geometry, x: geometry.x + delta.x, y: geometry.y + delta.y }, others, canvas, snapDistance / scale)
    setDrag({ ...drag, dx: delta.x + fit.dx, dy: delta.y + fit.dy, moved, guides: fit.guides })
  }

  function onPointerUp() {
    if (!drag) return
    setDrag(undefined)
    const geometry = byId(drag.id)?.geometry
    // 거의 움직이지 않았으면 클릭으로 본다. 맞춤으로 줄어든 이동은 그대로 저장한다
    if (!geometry || drag.moved < 2) return
    // 맞춘 축은 계산한 좌표를 그대로 두고 나머지 축만 정수로 맞춘다. 홀수 크기 요소도 가운데에 놓인다
    const place = (value: number, axis: Guide['axis']) =>
      drag.guides.some((guide) => guide.axis === axis) ? Math.round(value * 100) / 100 : Math.round(value)
    const x = place(geometry.x + drag.dx, 'x')
    const y = place(geometry.y + drag.dy, 'y')
    if (x === geometry.x && y === geometry.y) return
    // 놓는 순간 한 번의 명령으로 저장한다. 좌표 항목은 통째로 보낸다
    onChange(drag.id, { geometry: { ...geometry, x, y } })
    onCommit(drag.id)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>, element: Element) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(element.id)
      if (event.key === 'Enter' && element.type === 'text' && !locked(element.id)) {
        onEditingChange(element.id)
      }
      return
    }
    if (event.key === 'Escape') {
      onSelect(undefined)
      return
    }
    const arrow = arrows[event.key]
    if (!arrow || locked(element.id)) return
    // 끌기 대신 방향키로 옮긴다. Shift를 누르면 10씩 옮긴다
    event.preventDefault()
    const step = event.shiftKey ? 10 : 1
    onSelect(element.id)
    onChange(element.id, {
      geometry: {
        ...element.geometry,
        x: element.geometry.x + arrow[0] * step,
        y: element.geometry.y + arrow[1] * step,
      },
    })
  }

  const editing = editingId ? byId(editingId) : undefined

  return (
    <div ref={stage} onPointerDown={() => onSelect(undefined)}>
      <SlideRenderer canvas={canvas} slide={shown} scale={scale} hiddenElementId={editingId}>
        {elements.map(moved).map((element) => {
          const { x, y, width, height, rotation } = element.geometry
          return (
            <div
              key={element.id}
              role="button"
              tabIndex={0}
              aria-label={describeElement(element)}
              aria-pressed={element.id === selectedId}
              data-element={element.id}
              className={[styles.hit, element.id === selectedId ? styles.selected : '']
                .filter(Boolean)
                .join(' ')}
              style={
                {
                  left: x,
                  top: y,
                  width,
                  height,
                  transform: rotation ? `rotate(${rotation}deg)` : undefined,
                  // 선택 표시 굵기가 배율에 따라 달라지지 않게 한다
                  '--stage-scale': scale,
                } as CSSProperties
              }
              onPointerDown={(event) => onPointerDown(event, element.id)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => setDrag(undefined)}
              onDoubleClick={() => {
                if (element.type === 'text' && !locked(element.id)) onEditingChange(element.id)
              }}
              onKeyDown={(event) => onKeyDown(event, element)}
            />
          )
        })}
        {drag?.guides.map((guide) => (
          <div
            key={`${guide.axis}${guide.at}`}
            className={guide.axis === 'x' ? styles.guideX : styles.guideY}
            data-guide={guide.axis}
            style={
              {
                left: guide.axis === 'x' ? guide.at : 0,
                top: guide.axis === 'y' ? guide.at : 0,
                width: guide.axis === 'y' ? canvas.width : 0,
                height: guide.axis === 'x' ? canvas.height : 0,
                '--stage-scale': scale,
              } as CSSProperties
            }
          />
        ))}
        {editing?.type === 'text' && (
          <TextEditor
            key={editing.id}
            element={editing}
            readOnly={locked(editing.id)}
            onInput={(value, composing) =>
              onChange(editing.id, { content: { text: value } }, { composing })
            }
            onDone={(escaped) => {
              onCommit(editing.id)
              onEditingChange(undefined)
              if (!escaped) return
              const hit = stage.current?.querySelector<HTMLElement>(`[data-element="${editing.id}"]`)
              requestAnimationFrame(() => hit?.focus())
            }}
          />
        )}
      </SlideRenderer>
    </div>
  )
}
