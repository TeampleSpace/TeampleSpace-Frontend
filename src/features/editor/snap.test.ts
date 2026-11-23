import { expect, test } from 'vitest'
import { snap } from './snap.ts'

const canvas = { width: 1280, height: 720 }
const box = { x: 100, y: 100, width: 200, height: 100 }

test('슬라이드 가운데와 다른 요소의 가장자리에 가까우면 그 선에 붙인다', () => {
  // 가로 가운데 640에서 4만큼 벗어난 요소를 가운데로 붙인다
  expect(snap({ ...box, x: 444 }, [], canvas, 6)).toEqual({ dx: -4, dy: 0, guides: [{ axis: 'x', at: 640 }] })
  // 다른 요소의 아래 선 260에 위 선을 맞춘다
  const other = { x: 600, y: 160, width: 100, height: 100 }
  expect(snap({ ...box, x: 900, y: 263 }, [other], canvas, 6)).toEqual({ dx: 0, dy: -3, guides: [{ axis: 'y', at: 260 }] })
})

test('기준선이 멀면 옮긴 그대로 두고 가장 가까운 선 하나만 고른다', () => {
  expect(snap({ ...box, x: 455, y: 333 }, [], canvas, 6)).toEqual({ dx: 0, dy: 0, guides: [] })
  const near = { x: 302, y: 500, width: 10, height: 10 }
  const nearer = { x: 299, y: 600, width: 10, height: 10 }
  // 오른쪽 선 300은 299에 1, 302에 2만큼 떨어져 있어 299에 붙는다
  expect(snap(box, [near, nearer], canvas, 6).guides).toContainEqual({ axis: 'x', at: 299 })
})
