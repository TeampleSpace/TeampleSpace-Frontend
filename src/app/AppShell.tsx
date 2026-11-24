import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link, NavLink, Outlet, useLocation, useMatch } from 'react-router'
import { projectsApi } from '../entities/project/api.ts'
import type { Project } from '../entities/project/model.ts'
import { Button } from '../shared/ui/Button.tsx'
import type { CurrentProject } from '../shared/lib/shellContext.ts'
import { RequestBanner } from '../features/requests/ui/RequestBanner.tsx'
import styles from './AppShell.module.css'

// 좁은 화면에서는 사이드바를 상단 막대의 메뉴 서랍으로 연다
const narrowQuery = '(max-width: 800px)'
const narrowMedia = () => typeof window.matchMedia === 'function' ? window.matchMedia(narrowQuery) : null
function subscribeNarrow(change: () => void) {
  const media = narrowMedia()
  media?.addEventListener('change', change)
  return () => media?.removeEventListener('change', change)
}

export default function AppShell() {
  const [currentProject, setCurrentProject] = useState<CurrentProject>(null)
  const match = useMatch('/projects/:projectId/*')
  // 슬라이드 편집 화면은 캔버스를 넓게 쓰도록 사이드바를 기본으로 접는다. 직접 접거나 펴면 그 선택을 따른다
  const editor = useMatch('/projects/:projectId/slides/*')
  const [folded, setFolded] = useState<boolean>()
  const collapsed = folded ?? !!editor
  // 누른 단추가 사라지므로 반대 단추로 포커스를 옮긴다
  function toggle(next: boolean) {
    setFolded(next)
    requestAnimationFrame(() => document.getElementById(next ? 'app-sidebar-open' : 'app-sidebar-close')?.focus())
  }
  const narrow = useSyncExternalStore(subscribeNarrow, () => narrowMedia()?.matches ?? false, () => false)
  // 연 위치를 기억해 화면을 옮기면 서랍이 저절로 닫힌다
  const [menuAt, setMenuAt] = useState<string | null>(null)
  const location = useLocation()
  const menuOpen = narrow && menuAt === location.key
  function openMenu() {
    setMenuAt(location.key)
    requestAnimationFrame(() => document.getElementById('app-menu-close')?.focus())
  }
  function closeMenu() {
    setMenuAt(null)
    requestAnimationFrame(() => document.getElementById('app-menu-open')?.focus())
  }
  const account = useMatch('/account/*')
  const billingReturn = useMatch('/billing/return')
  const showingProjects = !account && !billingReturn
  const [projects, setProjects] = useState<Project[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  const generation = useRef(0)
  const moreLock = useRef(false)
  const loadedPages = useRef(1)
  const refreshing = useRef(false)
  const current = match?.params.projectId === currentProject?.id ? currentProject : null
  const selected = match ? current : projects.find((project) => project.id === expanded) ?? projects[0]
  useEffect(() => {
    const controller = new AbortController()
    const request = ++generation.current
    refreshing.current = true
    async function refreshPages() {
      const items: Project[] = []
      let nextCursor: string | null = null
      for (let page = 0; page < loadedPages.current; page++) {
        const result = await projectsApi.list('', nextCursor ?? undefined, controller.signal)
        if (controller.signal.aborted) return null
        items.push(...result.items.filter((item) => !items.some((existing) => existing.id === item.id)))
        nextCursor = result.nextCursor
        if (!nextCursor) break
      }
      return { items, nextCursor }
    }
    void refreshPages().then((result) => {
      if (!result) return
      if (request !== generation.current) return
      setProjects(result.items); setCursor(result.nextCursor); setError(false)
    }).catch(() => { if (!controller.signal.aborted && request === generation.current) { setError(true); setProjects([]); setCursor(null) } })
      .finally(() => { if (request === generation.current) refreshing.current = false })
    return () => controller.abort()
  }, [location.pathname, revision, currentProject?.name])
  async function more() {
    if (!cursor || moreLock.current || refreshing.current) return
    moreLock.current = true; setLoading(true)
    const request = generation.current
    try {
      const result = await projectsApi.list('', cursor)
      if (request !== generation.current) return
      loadedPages.current++
      setProjects((items) => [...items, ...result.items.filter((item) => !items.some((existing) => existing.id === item.id))])
      setCursor(result.nextCursor); setError(false)
    } catch { if (request === generation.current) setError(true) }
    finally { moreLock.current = false; setLoading(false) }
  }
  return <div className={styles.shell} data-collapsed={!narrow && collapsed || undefined} data-editor={editor ? '' : undefined} data-menu-open={menuOpen || undefined}>
    {narrow && <div className={styles.topBar} inert={menuOpen}>
      <NavLink className={styles.brand} to="/"><span>t</span>TeamPleSpace</NavLink>
      <button type="button" className={styles.menu} aria-label="메뉴 열기" id="app-menu-open" aria-controls="app-sidebar" aria-expanded={menuOpen} onClick={openMenu}><span aria-hidden="true" /></button>
    </div>}
    {menuOpen && <div className={styles.scrim} aria-hidden="true" onClick={closeMenu} />}
    <aside id="app-sidebar" className={styles.sidebar} hidden={narrow ? !menuOpen : collapsed} onKeyDown={(event) => { if (menuOpen && event.key === 'Escape') closeMenu() }}>
      <div className={styles.sidebarHead}>
        <NavLink className={styles.brand} to="/"><span>t</span>TeamPleSpace</NavLink>
        {narrow
          ? <button type="button" className={styles.close} aria-label="메뉴 닫기" id="app-menu-close" aria-controls="app-sidebar" aria-expanded="true" onClick={closeMenu}><span aria-hidden="true" /></button>
          : <button type="button" className={styles.fold} aria-label="메뉴 접기" id="app-sidebar-close" aria-controls="app-sidebar" aria-expanded="true" onClick={() => toggle(true)}><span aria-hidden="true" /></button>}
      </div>
      <nav aria-label="주 메뉴" className={styles.navigation}>
        <NavLink to="/" end><img src="/assets/navigation/home.svg" alt="" />홈</NavLink>
        <Link to="/?search=1" className={styles.search}><img src="/assets/navigation/search.svg" alt="" />프로젝트 검색</Link>
        <Link to="/?create=1"><img src="/assets/navigation/plus.svg" alt="" />새 프로젝트</Link>
        <Link to="/?join=1"><img src="/assets/navigation/link.svg" alt="" />초대 링크로 참여</Link>
      </nav>
      {showingProjects && projects.length > 0 && <nav aria-label="내 프로젝트" className={styles.explorer}>
        <p className={styles.caption}>내 프로젝트</p>
        <ul>{projects.map((project) => {
          const isExpanded = (expanded ?? selected?.id) === project.id
          return <li key={project.id}>
            <div className={styles.projectRow}>
              <button type="button" aria-label={`${project.name} 메뉴`} aria-expanded={isExpanded} onClick={() => setExpanded(isExpanded ? '' : project.id)}><span className={styles.chevron} aria-hidden="true" /></button>
              <NavLink to={`/projects/${project.id}`} end>{project.id === current?.id ? current.name : project.name}</NavLink>
            </div>
            {isExpanded && <div className={styles.projectChildren}>
              <NavLink to={`/projects/${project.id}`} end>프로젝트 개요</NavLink>
              <NavLink to={`/projects/${project.id}/materials`}>자료</NavLink>
              <NavLink to={`/projects/${project.id}/outline`}>발표 구성</NavLink>
              <NavLink to={`/projects/${project.id}/design`}>디자인 설정</NavLink>
              <NavLink to={`/projects/${project.id}/slides`}>슬라이드</NavLink>
            </div>}
          </li>
        })}</ul>
        {cursor && <Button variant="text" loading={loading} onClick={() => void more()}>프로젝트 더 보기</Button>}
      </nav>}
      {showingProjects && error && <div role="status" className={styles.caption}>프로젝트 목록을 불러오지 못했어요<Button variant="text" onClick={() => setRevision((value) => value + 1)}>목록 다시 확인</Button></div>}
      <div className={styles.management}>
      {showingProjects && selected && <nav aria-label="프로젝트 관리" className={styles.managementLinks}>
        <Link to={`/projects/${selected.id}?team=1`}><img src="/assets/navigation/users.svg" alt="" />팀원 관리</Link>
        <NavLink to={`/projects/${selected.id}/settings`}><img src="/assets/navigation/settings.svg" alt="" />프로젝트 설정</NavLink>
      </nav>}
      <NavLink to="/account" className={styles.account}><img src="/assets/navigation/user.svg" alt="" />내 계정</NavLink>
      </div>
    </aside>
    <div className={styles.workspace} inert={menuOpen}>
      {!narrow && collapsed && <button type="button" className={styles.unfold} aria-label="메뉴 펼치기" id="app-sidebar-open" aria-controls="app-sidebar" aria-expanded="false" onClick={() => toggle(false)}><span aria-hidden="true" /></button>}
      {match?.params.projectId && <RequestBanner key={match.params.projectId} projectId={match.params.projectId} />}
      <Outlet context={{ setCurrentProject }} />
    </div>
  </div>
}
