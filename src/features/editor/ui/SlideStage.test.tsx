// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import { exampleSnapshot } from '../../../mocks/example.ts'
import { SlideStage } from './SlideStage.tsx'

const presentation = exampleSnapshot.presentation!
const slide = presentation.slides[0]
// 다른 요소와 겹치는 선이 없는 아래쪽 글상자를 끈다
const target = slide.elements.find((element) => element.geometry.width === 600)!

beforeAll(() => {
  // jsdom에는 포인터 고정이 없다
  HTMLElement.prototype.setPointerCapture = () => undefined
})
afterEach(cleanup)

function mount() {
  const onChange = vi.fn()
  const view = render(<SlideStage canvas={presentation.canvas} slide={slide} scale={1} locked={() => false}
    onSelect={vi.fn()} onEditingChange={vi.fn()} onChange={onChange} onCommit={vi.fn()} />)
  const hit = view.container.querySelector<HTMLElement>(`[data-element="${target.id}"]`)!
  return { ...view, hit, onChange }
}

// 요소 가운데가 슬라이드 가로 가운데에서 3만큼 벗어나도록 끄는 거리
const offCenter = presentation.canvas.width / 2 - (target.geometry.x + target.geometry.width / 2) + 3

test('끄는 동안 가까운 기준선을 안내선으로 보여 주고 놓으면 그 선에 맞춰 저장한다', () => {
  const { container, hit, onChange } = mount()
  fireEvent.pointerDown(hit, { clientX: 0, clientY: 0, pointerId: 1 })
  fireEvent.pointerMove(hit, { clientX: offCenter, clientY: 0, pointerId: 1 })
  const guide = container.querySelector<HTMLElement>('[data-guide="x"]')
  expect(guide?.style.left).toBe(`${presentation.canvas.width / 2}px`)
  fireEvent.pointerUp(hit, { pointerId: 1 })
  expect(container.querySelector('[data-guide]')).toBeNull()
  const saved = onChange.mock.calls[0][1].geometry
  expect(saved.x + target.geometry.width / 2).toBe(presentation.canvas.width / 2)
})

test('Alt를 누르고 끌면 맞추지 않고 옮긴 그대로 저장한다', () => {
  const { container, hit, onChange } = mount()
  fireEvent.pointerDown(hit, { clientX: 0, clientY: 0, pointerId: 1 })
  fireEvent.pointerMove(hit, { clientX: offCenter, clientY: 0, pointerId: 1, altKey: true })
  expect(container.querySelector('[data-guide]')).toBeNull()
  fireEvent.pointerUp(hit, { pointerId: 1 })
  expect(onChange.mock.calls[0][1].geometry.x).toBe(Math.round(target.geometry.x + offCenter))
})

test('맞춤으로 이동 거리가 줄어도 끌어서 놓았으면 맞춘 위치를 저장한다', () => {
  // 가운데에서 1만큼 벗어난 자리까지 Alt로 옮겨 둔 상태를 만든다
  const { hit, onChange, unmount } = mount()
  const nearCenter = presentation.canvas.width / 2 - (target.geometry.x + target.geometry.width / 2) - 1
  fireEvent.pointerDown(hit, { clientX: 0, clientY: 0, pointerId: 1 })
  fireEvent.pointerMove(hit, { clientX: nearCenter, clientY: 0, pointerId: 1, altKey: true })
  fireEvent.pointerUp(hit, { pointerId: 1 })
  const placed = onChange.mock.calls[0][1].geometry
  unmount()

  const moved = { ...slide, elements: slide.elements.map((element) => element.id === target.id ? { ...element, geometry: placed } : element) }
  const save = vi.fn()
  const view = render(<SlideStage canvas={presentation.canvas} slide={moved} scale={1} locked={() => false}
    onSelect={vi.fn()} onEditingChange={vi.fn()} onChange={save} onCommit={vi.fn()} />)
  const again = view.container.querySelector<HTMLElement>(`[data-element="${target.id}"]`)!
  // 가운데 쪽으로 4만큼 끌면 맞춤으로 실제 이동은 1이다
  fireEvent.pointerDown(again, { clientX: 0, clientY: 0, pointerId: 1 })
  fireEvent.pointerMove(again, { clientX: 4, clientY: 0, pointerId: 1 })
  fireEvent.pointerUp(again, { pointerId: 1 })
  expect(save.mock.calls[0][1].geometry.x + target.geometry.width / 2).toBe(presentation.canvas.width / 2)
})
