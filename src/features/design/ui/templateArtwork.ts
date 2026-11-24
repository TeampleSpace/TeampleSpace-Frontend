import { shape, slide, text } from './studioSlide.ts'

// 피그마 Components의 템플릿 시안 중 목차와 본문. 시안은 640x360이라 좌표와 글자 크기를 두 배로 그린다
type Palette = { background: string; ink: string; accent: string }

const palettes: Record<string, Palette> = {
  'clean-report': { background: '#ffffff', ink: '#20242d', accent: '#285bdd' },
  'blue-focus': { background: '#edf2ff', ink: '#20242d', accent: '#285bdd' },
  'orange-pitch': { background: '#fff0e3', ink: '#20242d', accent: '#f27c36' },
  'green-insight': { background: '#e8eee8', ink: '#234b3d', accent: '#234b3d' },
  'mono-editorial': { background: '#20242d', ink: '#ffffff', accent: '#f27c36' },
  'lilac-studio': { background: '#ece7f7', ink: '#403156', accent: '#7454b4' },
  'data-briefing': { background: '#172c4d', ink: '#ffffff', accent: '#94b6ff' },
  'warm-seminar': { background: '#faf5e9', ink: '#624738', accent: '#b97043' },
  'team-story': { background: '#ffffff', ink: '#20242d', accent: '#285bdd' },
}

const font = 'Pretendard'
const agenda = ['문제를 발견하다', '근거를 살펴보다', '실행을 제안하다']
const findings = ['현황을 이해하기', '핵심 원인을 찾기', '다음 행동을 정하기']

function frame({ background, ink, accent }: Palette, title: string) {
  return [
    shape([0, 0, 1280, 720], 'rect', background, null, 0, 0, 0),
    text([64, 60, 1140, 72], title, font, 700, 56, ink, 'left', 1.3, 0),
    shape([64, 168, 1152, 6], 'rect', accent, null, 0, 0, 0),
    text([64, 650, 1040, 26], 'TEAM PROJECT', font, 400, 20, ink, 'left', 1.3, 0),
  ]
}

function contents(key: string, palette: Palette) {
  return slide(`${key}-contents`, '목차', [
    ...frame(palette, '오늘 이야기할 내용'),
    ...agenda.flatMap((label, index) => {
      const top = 238 + index * 130
      return [
        text([64, top, 100, 58], `0${index + 1}`, font, 700, 44, palette.accent, 'left', 1.3, 0),
        text([204, top + 6, 960, 54], label, font, 400, 42, palette.ink, 'left', 1.3, 0),
      ]
    }),
  ])
}

function body(key: string, palette: Palette) {
  return slide(`${key}-body`, '본문', [
    ...frame(palette, '관찰에서 발견한 세 가지'),
    ...findings.flatMap((label, index) => {
      const left = 64 + index * 398
      return [
        shape([left, 250, 88, 10], 'rect', palette.accent, null, 0, 0, 0),
        text([left, 310, 360, 52], label, font, 700, 40, palette.ink, 'left', 1.3, 0),
        text([left, 410, 360, 78], '수집한 자료를 바탕으로\n핵심 내용을 정리합니다.', font, 400, 30, palette.ink, 'left', 1.3, 0),
      ]
    }),
  ])
}

// 목차와 본문 시안이 있는 템플릿만 돌려준다
export function templateArtwork(templateKey: string) {
  const palette = palettes[templateKey]
  return palette ? [contents(templateKey, palette), body(templateKey, palette)] : undefined
}
