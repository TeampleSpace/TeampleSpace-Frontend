// 피그마 Product Design의 템플릿 표지 그림에서 읽은 값
// x, w와 글자 크기는 표지 너비에 대한 백분율, y, h는 표지 높이에 대한 백분율이다
export type CoverBox = { kind: 'box'; x: number; y: number; w: number; h: number; color: string }
export type CoverText = { kind: 'text'; x: number; y: number; w: number; size: number; weight: number; color: string; lines: string[] }
export type TemplateCoverSpec = { background: string; items: (CoverBox | CoverText)[] }

export const templateCovers: Record<string, TemplateCoverSpec> = {
  'clean-report': {
    background: '#ffffff',
    items: [
      { kind: 'text', x: 5.62, y: 7.78, w: 78.12, size: 1.88, weight: 700, color: '#285bdd', lines: ['RESEARCH REPORT'] },
      { kind: 'text', x: 5.62, y: 27.78, w: 87.5, size: 6.25, weight: 700, color: '#20242d', lines: ['캠퍼스의 오늘,', '더 나은 내일'] },
      { kind: 'box', x: 5.62, y: 61.67, w: 88.75, h: 0.28, color: '#20242d' },
      { kind: 'text', x: 5.62, y: 68.06, w: 84.38, size: 2.5, weight: 400, color: '#20242d', lines: ['교내 일회용품 사용 현황과 개선 제안'] },
      { kind: 'text', x: 5.62, y: 86.11, w: 70.31, size: 1.72, weight: 400, color: '#20242d', lines: ['TEAM 04     2026.11'] },
    ],
  },
  'blue-focus': {
    background: '#edf2ff',
    items: [
      { kind: 'box', x: 0, y: 0, w: 39.38, h: 100, color: '#285bdd' },
      { kind: 'text', x: 5, y: 5.56, w: 28.12, size: 11.88, weight: 700, color: '#ffffff', lines: ['01'] },
      { kind: 'text', x: 5, y: 75.56, w: 28.91, size: 2.5, weight: 700, color: '#ffffff', lines: ['CAMPUS', 'PROJECT'] },
      { kind: 'text', x: 44.38, y: 23.33, w: 50.94, size: 5.62, weight: 700, color: '#20242d', lines: ['작은 실천이', '만드는 큰 변화'] },
      { kind: 'box', x: 44.38, y: 62.78, w: 8.75, h: 1.39, color: '#285bdd' },
      { kind: 'text', x: 44.38, y: 71.11, w: 48.44, size: 2.5, weight: 400, color: '#20242d', lines: ['일상의 변화에서 시작하는', '캠퍼스 친환경 전환'] },
    ],
  },
  'orange-pitch': {
    background: '#fff0e3',
    items: [
      { kind: 'text', x: 5, y: 6.95, w: 85.94, size: 1.88, weight: 700, color: '#20242d', lines: ['PROJECT PROPOSAL'] },
      { kind: 'box', x: 0, y: 22.22, w: 100, h: 60, color: '#f27c36' },
      { kind: 'text', x: 5, y: 28.89, w: 90.62, size: 7.19, weight: 700, color: '#20242d', lines: ['새로운 가능성을', '제안합니다'] },
      { kind: 'text', x: 5, y: 88.34, w: 84.38, size: 2.03, weight: 400, color: '#20242d', lines: ['팀의 아이디어를 구체적인 실행으로'] },
    ],
  },
  'green-insight': {
    background: '#e8eee8',
    items: [
      { kind: 'text', x: 5, y: 7.78, w: 81.25, size: 1.88, weight: 700, color: '#234b3d', lines: ['SUSTAINABILITY / 2026'] },
      { kind: 'text', x: 5, y: 28.89, w: 57.81, size: 6.56, weight: 700, color: '#234b3d', lines: ['지속가능한', '선택의 시작'] },
      { kind: 'box', x: 70.31, y: 24.44, w: 20.31, h: 36.11, color: '#234b3d' },
      { kind: 'box', x: 61.25, y: 60.56, w: 20.31, h: 27.78, color: '#234b3d' },
      { kind: 'text', x: 5, y: 84.17, w: 50, size: 2.19, weight: 400, color: '#234b3d', lines: ['캠퍼스 환경 조사 보고서'] },
    ],
  },
  'mono-editorial': {
    background: '#20242d',
    items: [
      { kind: 'text', x: 5, y: 7.78, w: 78.12, size: 1.88, weight: 700, color: '#ffffff', lines: ['THE NEXT CHAPTER'] },
      { kind: 'text', x: 5, y: 26.67, w: 89.06, size: 8.12, weight: 700, color: '#ffffff', lines: ['생각을 넘어,', '변화로'] },
      { kind: 'box', x: 5, y: 77.22, w: 17.19, h: 2.22, color: '#f27c36' },
      { kind: 'text', x: 5, y: 87.78, w: 89.06, size: 2.19, weight: 400, color: '#ffffff', lines: ['우리의 관찰과 질문, 그리고 다음 단계'] },
    ],
  },
  'lilac-studio': {
    background: '#ece7f7',
    items: [
      { kind: 'box', x: 5, y: 8.34, w: 0.94, h: 83.33, color: '#7454b4' },
      { kind: 'text', x: 10, y: 7.78, w: 78.12, size: 1.88, weight: 700, color: '#403156', lines: ['IDEA NOTE'] },
      { kind: 'text', x: 10, y: 30.56, w: 82.81, size: 6.25, weight: 700, color: '#403156', lines: ['다르게 생각하고', '함께 만듭니다'] },
      { kind: 'text', x: 10, y: 83.33, w: 82.81, size: 2.19, weight: 400, color: '#403156', lines: ['기획 배경  /  해결 방향  /  실행 계획'] },
    ],
  },
  'data-briefing': {
    background: '#172c4d',
    items: [
      { kind: 'text', x: 5, y: 7.78, w: 78.12, size: 1.88, weight: 700, color: '#94b6ff', lines: ['DATA BRIEF / 2026'] },
      { kind: 'text', x: 5, y: 27.22, w: 57.19, size: 6.56, weight: 700, color: '#ffffff', lines: ['숫자 속에서', '답을 찾다'] },
      { kind: 'box', x: 67.19, y: 57.22, w: 5.62, h: 28.89, color: '#94b6ff' },
      { kind: 'box', x: 75.62, y: 42.5, w: 5.62, h: 43.61, color: '#94b6ff' },
      { kind: 'box', x: 84.06, y: 27.78, w: 5.62, h: 58.33, color: '#94b6ff' },
      { kind: 'text', x: 5, y: 86.11, w: 57.81, size: 1.88, weight: 400, color: '#ffffff', lines: ['관찰을 인사이트로 연결하는 조사 보고'] },
    ],
  },
  'warm-seminar': {
    background: '#faf5e9',
    items: [
      { kind: 'text', x: 5.62, y: 7.78, w: 78.12, size: 1.88, weight: 700, color: '#624738', lines: ['SEMINAR NOTES'] },
      { kind: 'box', x: 5.62, y: 17.78, w: 88.75, h: 0.28, color: '#624738' },
      { kind: 'text', x: 5.62, y: 31.11, w: 87.5, size: 6.41, weight: 700, color: '#624738', lines: ['함께 나누는', '오늘의 이야기'] },
      { kind: 'box', x: 5.62, y: 77.22, w: 88.75, h: 0.28, color: '#624738' },
      { kind: 'text', x: 5.62, y: 86.11, w: 85.94, size: 2.03, weight: 400, color: '#624738', lines: ['사례를 살펴보고, 새로운 관점을 발견합니다'] },
    ],
  },
  'team-story': {
    background: '#ffffff',
    items: [
      { kind: 'box', x: 69.53, y: 0, w: 30.47, h: 50, color: '#285bdd' },
      { kind: 'box', x: 78.12, y: 50, w: 21.88, h: 50, color: '#f27c36' },
      { kind: 'text', x: 5, y: 7.78, w: 56.25, size: 1.88, weight: 700, color: '#285bdd', lines: ['TEAM PROJECT'] },
      { kind: 'text', x: 5, y: 32.22, w: 64.06, size: 5.94, weight: 700, color: '#20242d', lines: ['우리의 아이디어가', '하나의 발표로'] },
      { kind: 'text', x: 5, y: 84.72, w: 67.19, size: 2.03, weight: 400, color: '#20242d', lines: ['자료 수집부터 실행까지 함께한 과정'] },
    ],
  },
}

// 템플릿의 용도 분류. 갤러리의 분류와 상세 설명에 쓰고, 적힌 순서가 갤러리의 표시 순서다
export const templatePurposes: Record<string, string> = {
  'clean-report': '보고서', 'blue-focus': '수업 발표', 'orange-pitch': '제안서', 'green-insight': '보고서',
  'mono-editorial': '세미나', 'lilac-studio': '제안서', 'data-briefing': '보고서', 'warm-seminar': '세미나', 'team-story': '수업 발표',
  editorial: '세미나', 'pitch-dark': '제안서', 'warm-story': '수업 발표', 'grid-analysis': '보고서', 'bold-cover': '제안서',
}
