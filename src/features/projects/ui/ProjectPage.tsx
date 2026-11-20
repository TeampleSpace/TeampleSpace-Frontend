import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { useShell } from '../../../shared/lib/shellContext.ts'
import { ApiError } from '../../../shared/api/client.ts'
import { Button } from '../../../shared/ui/Button.tsx'
import { Field } from '../../../shared/ui/Field.tsx'
import { Modal } from '../../../shared/ui/Modal.tsx'
import { RequestError } from '../../../shared/ui/RequestError.tsx'
import { StatusPanel } from '../../../shared/ui/StatusPanel.tsx'
import { useSession } from '../../auth/sessionContext.ts'
import { authApi } from '../../auth/api.ts'
import { projectsApi } from '../api.ts'
import type { Project } from '../model.ts'
import { ProjectSettings } from './ProjectSettings.tsx'
import { TeamDialog } from './TeamDialog.tsx'
import type { TeamView } from './TeamDialog.tsx'
import styles from './Projects.module.css'
import page from '../../../shared/ui/PageLayout.module.css'

export default function ProjectPage() {
  const { projectId = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { setCurrentProject } = useShell()
  const { user, setUser, refresh: refreshSession } = useSession()
  const [params, setParams] = useSearchParams()
  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState<unknown>()
  const [actionError, setActionError] = useState<unknown>()
  const [userError, setUserError] = useState<unknown>()
  const [view, setView] = useState<TeamView | 'delete' | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const generation = useRef(0)
  const lock = useRef(false)
  const settings = location.pathname.endsWith('/settings')
  const onAccessError = useCallback((reason: unknown) => {
    if (!(reason instanceof ApiError)) return
    if ([401, 403, 404, 410].includes(reason.status)) {
      generation.current++
      setProject(null); setError(reason)
    }
    if (reason.status === 401) setUser(null)
  }, [setUser])
  const refresh = useCallback(async (value?: Project) => {
    const current = ++generation.current
    if (value) { setProject(value); setError(undefined); return }
    try {
      const next = await projectsApi.get(projectId)
      if (current === generation.current) { setProject(next); setError(undefined) }
    } catch (reason) {
      if (current === generation.current) { setError(reason); onAccessError(reason) }
      throw reason
    }
  }, [projectId, onAccessError])
  useEffect(() => {
    void Promise.resolve().then(() => refresh()).catch(() => {})
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void refresh().catch(() => {}) }, 15000)
    const focus = () => void refresh().catch(() => {})
    window.addEventListener('focus', focus)
    const invalidate = () => { generation.current++ }
    return () => { invalidate(); clearInterval(poll); window.removeEventListener('focus', focus) }
  }, [refresh])
  const accessDenied = error instanceof ApiError && [401, 403, 404, 410].includes(error.status)
  useEffect(() => {
    setCurrentProject(project?.id === projectId && !accessDenied ? { id: project.id, name: project.name } : null)
    return () => setCurrentProject(null)
  }, [project?.id, project?.name, projectId, accessDenied, setCurrentProject])
  useEffect(() => {
    if (!leaving) return
    generation.current++
    navigate('/', { replace: true })
    void refreshSession().catch(() => {})
  }, [leaving, navigate, refreshSession])
  async function refreshUser() {
    try { setUser(await authApi.me()); setUserError(undefined) }
    catch (reason) { setUserError(reason); onAccessError(reason) }
  }
  async function changeTeam(value?: Project) {
    await refresh(value)
    if (value && value.ownerId !== project?.ownerId) await refreshUser()
  }
  const open = (next: TeamView | 'delete') => { setActionError(undefined); setConfirmation(''); setView(next) }
  const close = () => {
    if (busy) return
    setView(null)
    if (params.has('team')) { const next = new URLSearchParams(params); next.delete('team'); setParams(next, { replace: true }) }
  }
  const exit = () => setLeaving(true)
  const currentView = view ?? (params.has('team') ? 'members' : null)
  async function remove() {
    if (!project || confirmation !== project.name || project.ownerId !== user?.id || lock.current) return
    lock.current = true; setBusy(true); setActionError(undefined)
    try { await projectsApi.remove(project.id, project.version, confirmation); exit() }
    catch (reason) { setActionError(reason); onAccessError(reason) }
    finally { lock.current = false; setBusy(false) }
  }

  if (error && (!project || project.id !== projectId || accessDenied)) return <><RequestError error={error} action={<Button onClick={() => void refresh().catch(() => {})}>접근 권한 다시 확인</Button>} />
    <Link to="/">프로젝트 목록으로</Link>{error instanceof ApiError && error.status === 401 && <Link to={`/login?${new URLSearchParams({ returnTo: location.pathname })}`}>다시 로그인</Link>}</>
  if (!project || project.id !== projectId) return <StatusPanel kind="loading" title="프로젝트를 불러오고 있어요" />
  return <>
    <header className={page.header}><h1>{settings ? '프로젝트 설정' : project.name}</h1><Link to={settings ? `/projects/${project.id}` : '/'}>돌아가기</Link></header>
    <RequestError error={error} action={<Button onClick={() => void refresh().catch(() => {})}>최신 정보 다시 확인</Button>} />
    <RequestError error={userError} action={<Button onClick={() => void refreshUser()}>계정 정보 다시 확인</Button>} />
    {settings ? <ProjectSettings key={project.id} project={project} onChange={refresh} onOpen={open} onError={onAccessError} leaving={leaving} />
      : <section className={styles.card}>
        <h2>프로젝트 정보</h2><dl className={styles.details}><dt>발표 주제</dt><dd>{project.topic || '아직 정하지 않았어요'}</dd><dt>발표 조건</dt><dd>{project.presentationConstraints || '아직 정하지 않았어요'}</dd><dt>팀원</dt><dd>{project.memberCount}명</dd></dl>
        <div className={styles.actions}><Button onClick={() => open('members')}>팀원 관리</Button><Button variant="secondary" onClick={() => open('invite')}>팀원 초대</Button><Link to={`/projects/${project.id}/settings`}>프로젝트 설정</Link><Link to={`/projects/${project.id}/outline`}>발표 구성 보기</Link></div>
      </section>}
    <TeamDialog key={`team:${project.id}`} open={!!currentView && currentView !== 'delete'} project={project} initialView={currentView && currentView !== 'delete' ? currentView : 'members'} onClose={close} onChange={changeTeam} onExit={exit} onAccessError={onAccessError} />
    <Modal open={currentView === 'delete'} title="프로젝트를 삭제할까요?" size="confirm" onClose={close}
      description="삭제한 프로젝트는 다시 열 수 없어요. 프로젝트 이름을 정확하게 입력해 주세요"
      footer={<><Button variant="secondary" disabled={busy} onClick={close}>취소</Button><Button variant="danger" loading={busy} disabled={confirmation !== project.name} onClick={() => void remove()}>프로젝트 삭제</Button></>}>
      <Field label="확인할 프로젝트 이름" description={project.name} multiline rows={1} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
      <RequestError error={actionError} action={<Button variant="text" onClick={() => void refresh().catch(() => {})}>최신 정보 확인</Button>} />
    </Modal>
  </>
}
