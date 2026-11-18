import { NavLink, Outlet } from 'react-router'
import styles from './AppShell.module.css'

export default function AppShell() {
  return <div className={styles.shell}>
    <aside className={styles.sidebar}>
      <NavLink className={styles.brand} to="/"><span>t</span>TeamPleSpace</NavLink>
      <nav aria-label="주 메뉴" className={styles.navigation}>
        <NavLink to="/" end><img src="/assets/navigation/home.svg" alt="" />홈</NavLink>
        <NavLink to="/?search=1" className={styles.search}><img src="/assets/navigation/search.svg" alt="" />프로젝트 검색</NavLink>
        <NavLink to="/?create=1"><img src="/assets/navigation/plus.svg" alt="" />새 프로젝트</NavLink>
        <NavLink to="/?join=1"><img src="/assets/navigation/link.svg" alt="" />초대 링크로 참여</NavLink>
      </nav>
      <NavLink to="/account" className={styles.account}><img src="/assets/navigation/user.svg" alt="" />내 계정</NavLink>
    </aside>
    <div className={styles.workspace}><Outlet /></div>
  </div>
}
