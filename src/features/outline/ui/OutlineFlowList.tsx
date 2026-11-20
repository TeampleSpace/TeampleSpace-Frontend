import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { OutlineItem } from '../model.ts'
import styles from './Outline.module.css'

export type MoveDestination = { anchor: string; side: 'before' | 'after' }

type Drag = { items: OutlineItem[]; id: string; pointer: number; startY: number; x: number; y: number; moving: boolean }
type Props = {
  items: OutlineItem[]
  selectedId: string
  disabled: boolean
  onSelect: (id: string) => void
  onMove: (id: string, destination: MoveDestination) => void
}

function destinationAt(list: HTMLOListElement, drag: Drag): MoveDestination | undefined {
  const bounds = list.getBoundingClientRect()
  if (drag.x < bounds.left || drag.x > bounds.right || drag.y < bounds.top || drag.y > bounds.bottom) return
  const rows = Array.from(list.children)
  for (const [i, row] of rows.entries()) {
    const rect = row.getBoundingClientRect()
    if (drag.y <= rect.bottom || i === rows.length - 1) {
      const anchor = (row as HTMLElement).dataset.id!
      const side = drag.y < rect.top + rect.height / 2 ? 'before' : 'after'
      const neighbor = side === 'before' ? row.previousElementSibling : row.nextElementSibling
      if (anchor === drag.id || (neighbor as HTMLElement | null)?.dataset.id === drag.id) return
      return { anchor, side }
    }
  }
}

function edgeScroll(y: number, top: number, bottom: number) {
  if (y < top + 28) return -8
  if (y > bottom - 28) return 8
  return 0
}

export function OutlineFlowList({ items, selectedId, disabled, onSelect, onMove }: Props) {
  const list = useRef<HTMLOListElement>(null)
  const drag = useRef<Drag | null>(null)
  const suppressClick = useRef(false)
  const [movingId, setMovingId] = useState('')
  const [marker, setMarker] = useState<MoveDestination>()

  function clear() {
    drag.current = null
    setMovingId('')
    setMarker(undefined)
  }

  useEffect(() => {
    if (!movingId || disabled) return
    let frame: number
    function track() {
      const node = list.current
      const current = drag.current
      if (!current || !node) return
      const rect = node.getBoundingClientRect()
      if (current.x >= rect.left && current.x <= rect.right && current.y >= rect.top && current.y <= rect.bottom) {
        const scroll = edgeScroll(current.y, Math.max(rect.top, 0), Math.min(rect.bottom, window.innerHeight))
        const previous = node.scrollTop
        node.scrollTop += scroll
        if (scroll && node.scrollTop === previous) window.scrollBy(0, edgeScroll(current.y, 0, window.innerHeight))
      }
      const next = destinationAt(node, current)
      setMarker((old) => old?.anchor === next?.anchor && old?.side === next?.side ? old : next)
      frame = requestAnimationFrame(track)
    }
    frame = requestAnimationFrame(track)
    function cancel(event: KeyboardEvent) { if (event.key === 'Escape') clear() }
    window.addEventListener('keydown', cancel)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', cancel) }
  }, [movingId, disabled])

  function start(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (!event.isPrimary || event.button !== 0) return
    suppressClick.current = false
    if (disabled || items.length < 2) return
    if (event.pointerType === 'touch' && !(event.target as Element).closest('[data-grip]')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { items, id, pointer: event.pointerId, startY: event.clientY, x: event.clientX, y: event.clientY, moving: false }
  }

  function update(event: PointerEvent) {
    const current = drag.current
    if (!current || event.pointerId !== current.pointer) return
    current.x = event.clientX
    current.y = event.clientY
    if (!current.moving && Math.abs(current.y - current.startY) >= 5) {
      current.moving = true
      suppressClick.current = true
      setMovingId(current.id)
    }
  }

  return <ol ref={list} onPointerMove={update} onPointerCancel={clear} onLostPointerCapture={clear}
    onPointerUp={(event) => {
      const current = drag.current
      if (!current || event.pointerId !== current.pointer) return
      const next = current.moving && current.items === items && !disabled && destinationAt(event.currentTarget, { ...current, x: event.clientX, y: event.clientY })
      clear()
      if (next) onMove(current.id, next)
    }}>
    {items.map((item, index) => <li key={item.id} data-id={item.id} data-moving={movingId === item.id || undefined}
      data-insert={marker?.anchor === item.id ? marker.side : undefined}>
      <button type="button" aria-current={selectedId === item.id ? 'true' : undefined}
        onPointerDown={(event) => start(event, item.id)}
        onClick={(event) => { if (!event.detail || !suppressClick.current) onSelect(item.id) }}>
        <span>{String(index + 1).padStart(2, '0')}</span>{item.title}
        {items.length > 1 && !disabled && <i aria-hidden="true" data-grip="" className={styles.grip} title="끌어서 순서 변경" />}
      </button>
    </li>)}
  </ol>
}
