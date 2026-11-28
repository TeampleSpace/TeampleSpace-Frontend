import { shape, slide, text } from './studioSlide.ts'

// 피그마 Slide Layouts의 계열별 표지. 갤러리 카드에 쓴다
// 스위스 그리드의 빨강은 생성한 발표와 같게 흰 글자 대비를 맞춘 #df3121을 쓴다
const covers = new Map([
  ['pop-pitch', slide('pop-pitch-cover', '표지', [
    shape([0, 0, 1280, 720], 'rect', '#fff7e8', null, 0, 0, 0),
    shape([700, -120, 700, 700], 'ellipse', '#ffd23f', null, 0, 0, 0),
    shape([1040, 420, 340, 340], 'ellipse', '#ff7a2f', null, 0, 0, 0),
    shape([760, 470, 120, 120], 'ellipse', null, '#1d1b19', 4, 0, 0),
    shape([64, 72, 240, 44], 'rect', '#1d1b19', null, 0, 22, 0),
    text([64, 84, 240, 19], 'PROJECT PROPOSAL', 'Pretendard', 800, 16, '#ffd23f', 'center', 1.2, 0),
    text([64, 190, 760, 190], '캠퍼스 일회용품,\n줄일 수 있을까?', 'Gmarket Sans TTF', 700, 76, '#1d1b19', 'left', 1.25, 0),
    text([64, 410, 620, 72], '학생 설문과 현장 조사로 살펴본\n교내 일회용품 사용 실태와 개선 방향', 'Pretendard', 500, 24, '#4a4540', 'left', 1.5, 0),
    shape([64, 600, 150, 44], 'rect', '#ffffff', '#1d1b19', 2, 22, 0),
    text([64, 612, 150, 19], 'TEAM 04', 'Pretendard', 800, 16, '#1d1b19', 'center', 1.2, 0),
    shape([226, 600, 170, 44], 'rect', '#ffffff', '#1d1b19', 2, 22, 0),
    text([226, 612, 170, 19], '2026. 11. 24', 'Pretendard', 800, 16, '#1d1b19', 'center', 1.2, 0),
  ])],
  ['green-natural', slide('green-natural-cover', '표지', [
    shape([0, 0, 1280, 720], 'rect', '#f3eee4', null, 0, 0, 0),
    shape([780, 180, 620, 620], 'ellipse', '#a9c2a6', null, 0, 0, 0),
    shape([940, -120, 420, 420], 'ellipse', '#2f5d46', null, 0, 0, 0),
    shape([760, 520, 140, 140], 'ellipse', '#c9734a', null, 0, 0, 0),
    shape([860, 250, 280, 420], 'rect', '#fbf8f2', null, 0, 140, 0),
    text([912, 420, 176, 52], '2026\nSPRING', 'Pretendard', 700, 20, '#2f5d46', 'center', 1.3, 0),
    text([72, 96, 500, 22], 'CAMPUS GREEN REPORT', 'Pretendard', 700, 16, '#2f5d46', 'left', 1.4, 0),
    text([72, 220, 680, 160], '캠퍼스 일회용품,\n줄일 수 있을까', 'Pretendard', 700, 64, '#1f2a24', 'left', 1.25, 0),
    text([72, 410, 600, 70], '학생 설문과 현장 조사로 살펴본\n교내 일회용품 사용 실태와 개선 방향', 'Pretendard', 400, 22, '#4a5149', 'left', 1.6, 0),
    shape([72, 600, 40, 2], 'rect', '#2f5d46', null, 0, 0, 0),
    text([128, 590, 500, 22], '4조  김민지 이도윤 박서연', 'Pretendard', 500, 16, '#4a5149', 'left', 1.4, 0),
  ])],
  ['swiss-grid', slide('swiss-grid-cover', '표지', [
    shape([0, 0, 1280, 720], 'rect', '#ffffff', null, 0, 0, 0),
    shape([48, 48, 120, 120], 'rect', '#df3121', null, 0, 0, 0),
    text([448, 48, 380, 48], 'TEAM 04\n2026. 11. 24', 'Pretendard', 700, 16, '#0a0a0a', 'left', 1.5, 0),
    text([848, 48, 384, 48], '교내 일회용품\n사용 실태 조사', 'Pretendard', 700, 16, '#0a0a0a', 'left', 1.5, 0),
    shape([48, 300, 1184, 2], 'rect', '#0a0a0a', null, 0, 0, 0),
    text([48, 330, 1184, 218], '캠퍼스 일회용품,\n줄일 수 있을까', 'Pretendard', 900, 104, '#0a0a0a', 'left', 1.05, 0),
    text([848, 600, 384, 27], '학생 설문과 현장 조사로 살펴본 사용 실태와 개선 방향', 'Pretendard', 500, 18, '#333333', 'left', 1.5, 0),
  ])],
  ['bento-pastel', slide('bento-pastel-cover', '표지', [
    shape([0, 0, 1280, 720], 'rect', '#f4f1fa', null, 0, 0, 0),
    shape([48, 48, 760, 624], 'rect', '#7b5cd6', null, 0, 32, 0),
    text([96, 96, 500, 22], 'IDEA NOTE  2026', 'Pretendard', 800, 16, '#e2d9fa', 'left', 1.4, 0),
    text([96, 250, 680, 154], '캠퍼스 일회용품,\n줄일 수 있을까', 'Pretendard', 800, 64, '#ffffff', 'left', 1.2, 0),
    text([96, 440, 620, 64], '학생 설문과 현장 조사로 살펴본\n교내 일회용품 사용 실태와 개선 방향', 'Pretendard', 500, 20, '#e2d9fa', 'left', 1.6, 0),
    shape([832, 48, 400, 300], 'rect', '#c4eedf', null, 0, 32, 0),
    shape([1052, 198, 220, 220], 'ellipse', '#ffffff', null, 0, 0, 0),
    text([864, 80, 300, 20], 'KEYWORD', 'Pretendard', 800, 14, '#4e3796', 'left', 1.4, 0),
    text([864, 108, 300, 38], '다회용 컵', 'Pretendard', 800, 32, '#221b33', 'left', 1.2, 0),
    shape([832, 372, 188, 300], 'rect', '#fff0a6', null, 0, 32, 0),
    text([856, 404, 140, 20], 'TEAM', 'Pretendard', 800, 14, '#4e3796', 'left', 1.4, 0),
    text([856, 432, 140, 44], '4조', 'Pretendard', 800, 40, '#221b33', 'left', 1.1, 0),
    shape([1044, 372, 188, 300], 'rect', '#ffdccb', null, 0, 32, 0),
    text([1068, 404, 140, 20], 'DATE', 'Pretendard', 800, 14, '#4e3796', 'left', 1.4, 0),
    text([1068, 432, 140, 40], '11.24', 'Pretendard', 800, 36, '#221b33', 'left', 1.1, 0),
  ])],
  ['corporate', slide('corporate-cover', '표지', [
    shape([0, 0, 1280, 720], 'rect', '#0f2a4a', null, 0, 0, 0),
    shape([0, 560, 1280, 160], 'rect', '#ffffff', null, 0, 0, 0),
    shape([0, 556, 1280, 4], 'rect', '#c9a227', null, 0, 0, 0),
    shape([64, 120, 80, 6], 'rect', '#c9a227', null, 0, 0, 0),
    text([64, 150, 900, 160], '캠퍼스 일회용품,\n줄일 수 있을까', 'Pretendard', 700, 64, '#ffffff', 'left', 1.25, 0),
    text([64, 340, 800, 35], '학생 설문과 현장 조사로 살펴본 교내 일회용품 사용 실태와 개선 방향', 'Pretendard', 400, 22, '#b9c6d8', 'left', 1.6, 0),
    text([64, 604, 400, 20], '발표 팀', 'Pretendard', 700, 14, '#7b8494', 'left', 1.4, 0),
    text([64, 628, 400, 25], '4조  김민지 이도윤 박서연', 'Pretendard', 700, 18, '#1a2433', 'left', 1.4, 0),
    text([560, 604, 300, 20], '발표일', 'Pretendard', 700, 14, '#7b8494', 'left', 1.4, 0),
    text([560, 628, 300, 25], '2026년 11월 24일', 'Pretendard', 700, 18, '#1a2433', 'left', 1.4, 0),
    shape([1040, 600, 176, 64], 'rect', '#0f2a4a', null, 0, 0, 0),
    text([1040, 620, 176, 23], 'REPORT', 'Pretendard', 800, 18, '#c9a227', 'center', 1.3, 0),
  ])],
])

export function layoutCover(templateKey: string) {
  return covers.get(templateKey)
}
