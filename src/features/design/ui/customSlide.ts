import type { Slide } from '../../../entities/presentation/schema.ts'
import { shape, slide, text } from './studioSlide.ts'

// 직접 입력한 글꼴과 대표 색상을 본문 슬라이드에 적용한다
export function customSlide(font: string, color: string, projectName = '발표 제목'): Slide {
  return slide('custom-preview', '본문', [
    shape([0, 0, 1280, 720], 'rect', '#ffffff', null, 0, 0, 0),
    text([96, 84, 1000, 30], projectName, font, 600, 20, color, 'left', 1.4, 0),
    text([96, 132, 1060, 160], '발표 제목과\n핵심 메시지', font, 700, 56, color, 'left', 1.25, 0),
    shape([96, 318, 72, 6], 'rect', color, null, 0, 0, 0),
    text([96, 366, 1060, 220], '발표에서 다룰 문제와 배경을 소개합니다.\n핵심 주장과 근거를 짧게 정리합니다.\n듣는 사람이 다음 행동을 이해할 수 있게 제안합니다.',
      font, 400, 26, '#4b5563', 'left', 1.8, 0),
    text([96, 640, 1060, 24], '근거 자료의 이름과 쪽수가 여기에 표시됩니다', font, 400, 16, '#9ca3af', 'left', 1.4, 0),
  ]).document
}
