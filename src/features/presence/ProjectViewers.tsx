import { colorOf, tabLabels } from './viewers.ts'
import type { Tab, Viewer } from './viewers.ts'
import styles from './Presence.module.css'

function initial(name: string) {
  return name.trim().slice(0, 1) || '?'
}

// 프로젝트 화면 위에 지금 함께 보고 있는 팀원과 탭을 보여 준다
export function ProjectViewers({ viewers }: { viewers: Viewer[] }) {
  if (!viewers.length) return null
  return <ul className={styles.viewers} aria-label="지금 함께 보는 팀원">
    {viewers.map((viewer) => <li key={viewer.userId}>
      <span className={styles.avatar} style={{ background: colorOf(viewer.userId) }} aria-hidden="true">{initial(viewer.name)}</span>
      <span>{viewer.name}</span>
      <span className={styles.tab}>{tabLabels[viewer.tab]} 보는 중</span>
    </li>)}
  </ul>
}

// 사이드바 탭 옆에 그 탭을 보는 팀원 머리글자를 작게 붙인다. 같은 내용은 화면 위 목록이 읽어 준다
export function TabViewers({ viewers, tab }: { viewers: Viewer[]; tab: Tab }) {
  const here = viewers.filter((viewer) => viewer.tab === tab)
  if (!here.length) return null
  return <span className={styles.dots} aria-hidden="true" title={here.map((viewer) => viewer.name).join(', ')}>
    {here.slice(0, 3).map((viewer) => <span key={viewer.userId} className={styles.avatar} style={{ background: colorOf(viewer.userId) }}>{initial(viewer.name)}</span>)}
  </span>
}
