// 끄는 요소를 다른 요소와 슬라이드의 같은 선에 맞춘다. 좌표는 모두 문서 단위다
// ponytail: 회전한 요소도 회전 전 상자로 맞춘다. 회전 요소가 많아지면 회전 뒤 경계로 바꾼다

type Box = { x: number; y: number; width: number; height: number }
export type Guide = { axis: 'x' | 'y'; at: number }

const lines = (start: number, size: number) => [start, start + size / 2, start + size]

// 가장 가까운 기준선 하나로 붙인다. 기준선과의 거리가 threshold보다 멀면 그대로 둔다
function nearest(edges: number[], targets: number[], threshold: number) {
  let best: { offset: number; at: number } | undefined
  for (const edge of edges) {
    for (const target of targets) {
      const offset = target - edge
      if (Math.abs(offset) <= threshold && (!best || Math.abs(offset) < Math.abs(best.offset))) best = { offset, at: target }
    }
  }
  return best
}

export function snap(moving: Box, others: Box[], canvas: { width: number; height: number }, threshold: number) {
  const x = nearest(lines(moving.x, moving.width),
    [...lines(0, canvas.width), ...others.flatMap((box) => lines(box.x, box.width))], threshold)
  const y = nearest(lines(moving.y, moving.height),
    [...lines(0, canvas.height), ...others.flatMap((box) => lines(box.y, box.height))], threshold)
  const guides: Guide[] = []
  if (x) guides.push({ axis: 'x', at: x.at })
  if (y) guides.push({ axis: 'y', at: y.at })
  return { dx: x?.offset ?? 0, dy: y?.offset ?? 0, guides }
}
