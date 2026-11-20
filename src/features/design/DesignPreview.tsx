import styles from './DesignPage.module.css'

export type SlideExample = { title: string; lines: string[] }
export type PreviewStyle = { backgroundColor: string; headingColor: string; font?: string }

const sample: SlideExample = {
  title: '발표 제목과 핵심 메시지',
  lines: ['발표에서 다룰 문제와 배경을 소개합니다.', '핵심 주장과 근거를 짧게 정리합니다.', '발표를 듣는 사람이 다음 행동을 이해할 수 있게 제안합니다.'],
}

export function DesignPreview({ projectName, slide = sample, preview, variant = 'full' }: {
  projectName?: string
  slide?: SlideExample
  preview: PreviewStyle
  variant?: 'full' | 'thumbnail' | 'detail'
}) {
  return <div className={`${styles.slideFrame} ${styles[variant]}`} aria-hidden={variant === 'thumbnail' || undefined}>
    <div className={styles.slide} style={{ backgroundColor: preview.backgroundColor, fontFamily: preview.font }}>
      {projectName && <p className={styles.slideContext}>{projectName}</p>}
      <p className={styles.slideTitle} style={{ color: preview.headingColor }}>{slide.title}</p>
      {!!slide.lines.length && <ul className={styles.slideBody}>{slide.lines.slice(0, 3).map((line, index) => <li key={index}>{line}</li>)}</ul>}
    </div>
  </div>
}
