import { templateCovers } from './templateCovers.ts'
import styles from './TemplateCover.module.css'

// 템플릿의 표지 그림. 표지가 없는 템플릿이면 아무것도 그리지 않는다
export function TemplateCover({ templateKey }: { templateKey: string }) {
  const cover = templateCovers[templateKey]
  if (!cover) return null
  return <div className={styles.cover} data-template={templateKey} style={{ background: cover.background }} aria-hidden="true">
    {cover.items.map((item, index) => item.kind === 'box'
      ? <span key={index} className={styles.box}
        style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.w}%`, height: `${item.h}%`, background: item.color }} />
      : <span key={index} className={styles.text}
        style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.w}%`, fontSize: `${item.size}cqw`, fontWeight: item.weight, color: item.color }}>
        {item.lines.map((line, row) => <span key={row}>{line}</span>)}
      </span>)}
  </div>
}
