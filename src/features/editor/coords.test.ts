import { expect, test } from 'vitest'
import { clientToDoc, deltaToDoc, fitScale } from './coords.ts'

const canvas = { width: 1280, height: 720 }

test('영역에 맞춘 배율은 좁은 쪽을 기준으로 한다', () => {
  expect(fitScale(canvas, { width: 640, height: 720 })).toBe(0.5)
  expect(fitScale(canvas, { width: 1280, height: 360 })).toBe(0.5)
})

test('화면에서 움직인 거리를 배율로 나눠 문서 좌표 거리로 바꾼다', () => {
  expect(deltaToDoc(50, 25, 0.5)).toEqual({ x: 100, y: 50 })
  expect(deltaToDoc(150, 75, 1.5)).toEqual({ x: 100, y: 50 })
})

test('캔버스가 스크롤되거나 떨어져 있어도 같은 문서 좌표가 나온다', () => {
  // 문서 좌표 (200, 100)을 배율 0.5로 그린 화면 위치
  const stage = { left: 300, top: 80 }
  expect(clientToDoc(400, 130, stage, 0.5)).toEqual({ x: 200, y: 100 })
  // 같은 점을 배율 1.5로 스크롤된 상태에서 본 경우
  const scrolled = { left: -120, top: -40 }
  expect(clientToDoc(180, 110, scrolled, 1.5)).toEqual({ x: 200, y: 100 })
})
