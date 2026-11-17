// 화면 픽셀과 문서 좌표 사이의 변환
// 문서에는 확대 배율을 저장하지 않고 항상 캔버스 단위 좌표만 남긴다

type Size = { width: number; height: number }

// 캔버스 전체가 영역 안에 들어오는 배율
export function fitScale(canvas: Size, area: Size): number {
  return Math.min(area.width / canvas.width, area.height / canvas.height)
}

// 화면에서 움직인 거리를 문서 좌표 거리로 바꾼다
export function deltaToDoc(dx: number, dy: number, scale: number) {
  return { x: dx / scale, y: dy / scale }
}

// 화면 위 한 점을 문서 좌표로 바꾼다. stage는 확대가 적용된 캔버스의 화면 위치다
export function clientToDoc(
  clientX: number,
  clientY: number,
  stage: { left: number; top: number },
  scale: number,
) {
  return deltaToDoc(clientX - stage.left, clientY - stage.top, scale)
}
