import { expect, test } from 'vitest'
import { previewSlides } from './templatePreviewSlides.ts'

test('미리보기 요소는 배열 순서가 아니라 서버가 정한 쌓임 순서로 그린다', () => {
  const [{ label, document }] = previewSlides('clean-report', {
    templateId: 'template', templateVersion: 1, canvas: { width: 1280, height: 720, unit: 'px' },
    slides: [{ layoutId: 'cards', elements: [
      { type: 'text', geometry: { x: 80, y: 80, width: 600, height: 60, rotation: 0, z: 1 }, content: { text: '제목' },
        style: { fontFamily: 'Pretendard', fontSize: 40, fontWeight: 700, color: '#212735', align: 'left', lineHeight: 1.2 } },
      { type: 'shape', geometry: { x: 0, y: 0, width: 1280, height: 720, rotation: 0, z: 0 }, content: { shape: 'rect' },
        style: { fill: '#FFFFFF', stroke: null, strokeWidth: 0 } },
    ] }],
  })
  expect(label).toBe('카드')
  expect(document.elements.map((element) => [element.type, element.geometry.z])).toEqual([['shape', 0], ['text', 1]])
})
