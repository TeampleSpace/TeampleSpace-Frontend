import { useState } from 'react'
import { Link, NavLink, Outlet, useMatch } from 'react-router'
import type { CurrentProject } from './shellContext.ts'
import styles from './AppShell.module.css'

export default function AppShell() {
  const [currentProject, setCurrentProject] = useState<CurrentProject>(null)
  const match = useMatch('/projects/:projectId/*')
  const current = match?.params.projectId === currentProject?.id ? currentProject : null
  return <div className={styles.shell}>
    <aside className={styles.sidebar}>
      <NavLink className={styles.brand} to="/"><span>t</span>TeamPleSpace</NavLink>
      <nav aria-label="주 메뉴" className={styles.navigation}>
        <NavLink to="/" end><img src="/assets/navigation/home.svg" alt="" />홈</NavLink>
        <Link to="/?search=1" className={styles.search}><img src="/assets/navigation/search.svg" alt="" />프로젝트 검색</Link>
        <Link to="/?create=1"><img src="/assets/navigation/plus.svg" alt="" />새 프로젝트</Link>
        <Link to="/?join=1"><img src="/assets/navigation/link.svg" alt="" />초대 링크로 참여</Link>
      </nav>
      {current && <nav aria-label="현재 프로젝트" className={styles.navigation}>
        <p>내 프로젝트</p><NavLink to={`/projects/${current.id}`} end>{current.name}</NavLink>
        <Link to={`/projects/${current.id}?team=1`}><img src="/assets/navigation/users.svg" alt="" />팀원 관리</Link>
        <NavLink to={`/projects/${current.id}/settings`}><img src="/assets/navigation/settings.svg" alt="" />프로젝트 설정</NavLink>
      </nav>}
      <NavLink to="/account" className={styles.account}><img src="/assets/navigation/user.svg" alt="" />내 계정</NavLink>
    </aside>
    <div className={styles.workspace}><Outlet context={{ setCurrentProject }} /></div>
  </div>
}
