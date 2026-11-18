import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useSession } from '../auth/sessionContext.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { Field } from '../../shared/ui/Field.tsx'
import { RequestError } from '../../shared/ui/RequestError.tsx'
import { StatusPanel } from '../../shared/ui/StatusPanel.tsx'
import { CreateProject } from './CreateProject.tsx'
import { JoinProject } from './JoinProject.tsx'
import { projectsApi } from './api.ts'
import type { Project } from './model.ts'
import styles from './Projects.module.css'

export default function ProjectHome() {
  const { user } = useSession()
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const [result, setResult] = useState<{ query: string; items: Project[]; nextCursor: string | null } | null>(null)
  const [error, setError] = useState<unknown>()
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const generation = useRef(0)
  const moreLock = useRef(false)
  useEffect(() => {
    const current = ++generation.current
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setError(undefined)
      void projectsApi.list(query, undefined, controller.signal).then((data) => {
        if (current === generation.current) setResult({ query, ...data })
      }).catch((reason) => { if (!controller.signal.aborted && current === generation.current) setError(reason) })
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, revision])
  useEffect(() => { if (params.has('search')) document.getElementById('project-search')?.focus() }, [params])
  const visible = result?.query === query ? result : null
  const setModal = (key?: 'create' | 'join') => {
    const next = new URLSearchParams(params); next.delete('create'); next.delete('join')
    if (key) next.set(key, '1')
    setParams(next, { replace: true })
  }
  async function more() {
    if (!visible?.nextCursor || moreLock.current) return
    moreLock.current = true; setBusy(true)
    const current = generation.current
    try {
      const data = await projectsApi.list(query, visible.nextCursor)
      if (generation.current === current) setResult((previous) => previous?.query === query
        ? { query, items: [...previous.items, ...data.items.filter((item) => !previous.items.some((existing) => existing.id === item.id))], nextCursor: data.nextCursor } : previous)
    } catch (reason) { if (current === generation.current) setError(reason) }
    finally { moreLock.current = false; setBusy(false) }
  }
  return <div className={styles.home}>
    <header className={styles.header}><div className={styles.greeting}><p className={styles.muted}>내 프로젝트</p><h1>{user?.name}님, 하던 작업을 이어가세요</h1></div><Button onClick={() => setModal('create')}>새 프로젝트</Button></header>
    <Field label="프로젝트 검색" id="project-search" value={query} type="search"
      onChange={(event) => { const next = new URLSearchParams(params); next.set('q', event.target.value); setParams(next, { replace: true }) }} placeholder="프로젝트 이름으로 검색" />
    {error ? <RequestError error={error} action={<Button onClick={() => setRevision((value) => value + 1)}>다시 시도</Button>} />
      : !visible ? <StatusPanel kind="loading" title="프로젝트를 불러오고 있어요" />
      : visible.items.length === 0 ? <StatusPanel kind="empty" title={query ? '검색 결과가 없어요' : '첫 프로젝트를 만들어 보세요'}
        description={query ? '다른 프로젝트 이름으로 검색해 보세요' : '프로젝트를 만들거나 초대받은 팀 공간에 참여할 수 있어요'}
        action={query ? <Button variant="secondary" onClick={() => setParams({})}>검색 초기화</Button> : <Button onClick={() => setModal('create')}>새 프로젝트</Button>} />
      : <div className={styles.grid}>{visible.items.map((project) => <article className={styles.card} key={project.id}>
        <div className={styles.row}><div className={styles.greeting}><p className={styles.small}>최근 변경 {new Date(project.updatedAt).toLocaleDateString('ko-KR')}</p>
          <h2><Link to={`/projects/${project.id}`}>{project.name}</Link></h2><p className={styles.muted}>팀원 {project.memberCount}명</p></div><Link to={`/projects/${project.id}`}>프로젝트 열기</Link></div>
        {project.topic && <p className={styles.notice}>{project.topic}</p>}
        <div className={styles.actions}><Link to={`/projects/${project.id}?team=1`}>팀원 관리</Link><Link to={`/projects/${project.id}/settings`}>프로젝트 설정</Link></div>
      </article>)}</div>}
    {visible?.nextCursor && <Button variant="secondary" loading={busy} onClick={() => void more()}>프로젝트 더 보기</Button>}
    <div className={styles.row}><p className={styles.muted}>내가 참여한 프로젝트만 표시돼요</p><Button variant="text" onClick={() => setModal('join')}>초대 링크로 참여</Button></div>
    <CreateProject open={params.has('create')} onClose={() => setModal()} />
    <JoinProject open={params.has('join')} onClose={() => setModal()} />
  </div>
}
