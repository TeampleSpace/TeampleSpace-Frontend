import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Button } from '../../shared/ui/Button.tsx'
import { Field } from '../../shared/ui/Field.tsx'
import { RequestError } from '../../shared/ui/RequestError.tsx'
import { StatusPanel } from '../../shared/ui/StatusPanel.tsx'
import { CreateProject } from './CreateProject.tsx'
import { JoinProject } from './JoinProject.tsx'
import { projectsApi } from './api.ts'
import type { Project } from './model.ts'
import { ProjectCard } from './ProjectCard.tsx'
import { GettingStarted, HowItWorks } from './GettingStarted.tsx'
import shell from '../../app/AppShell.module.css'
import buttons from '../../shared/ui/Button.module.css'
import styles from './Projects.module.css'

export default function ProjectHome() {
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const searching = params.has('search') || Boolean(query)
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
  useEffect(() => { if (searching) document.getElementById('project-search')?.focus() }, [searching])
  const visible = result?.query === query ? result : null
  const displayed = visible ?? (searching ? result : null)
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
  const empty = visible?.items.length === 0
  return <div className={searching ? styles.searchPage : styles.home}>
    {searching ? <header className={shell.header}><h1>프로젝트</h1><Link className={`${buttons.button} ${buttons.text}`} to="/">돌아가기</Link></header>
      : <header className={styles.header}><h1>내 프로젝트</h1>
        {visible && !empty && <Button onClick={() => setModal('create')}>새 프로젝트</Button>}</header>}
    <div className={searching ? styles.searchContent : styles.homeContent}>
    {searching && <>
      <p className={styles.muted} role="status">{visible ? empty ? '검색 결과가 없습니다.' : `검색된 프로젝트 ${visible.items.length}개${visible.nextCursor ? ' 이상' : ''}` : '검색하고 있어요'}</p>
      <Field label="프로젝트 검색" id="project-search" value={query} type="search"
        onChange={(event) => { const next = new URLSearchParams(params); next.set('q', event.target.value); setParams(next, { replace: true }) }} placeholder="프로젝트 이름으로 검색" />
    </>}
    {error ? <RequestError error={error} action={<Button onClick={() => setRevision((value) => value + 1)}>다시 시도</Button>} />
      : !visible && !displayed?.items.length ? <div className={styles.pending} aria-busy="true"><StatusPanel kind="loading" title="프로젝트를 불러오고 있어요" /></div>
      : empty ? searching ? <><p className={styles.searchEmpty}>다른 이름으로 검색해 보세요.</p><div><Button onClick={() => setParams({ search: '1' }, { replace: true })}>검색 지우기</Button></div></>
        : <GettingStarted onCreate={() => setModal('create')} onJoin={() => setModal('join')} />
      : <div className={styles.grid} aria-busy={!visible}>{displayed?.items.map((project) => <ProjectCard project={project} key={project.id} />)}</div>}
    {visible?.nextCursor && <Button variant="secondary" loading={busy} onClick={() => void more()}>프로젝트 더 보기</Button>}
    {!searching && visible && <>
      {!empty && <div className={styles.row}><p className={styles.muted}>참여 중인 프로젝트 {visible.items.length}개{visible.nextCursor ? ' 이상' : ''}</p><Button variant="text" onClick={() => setModal('join')}>초대 링크로 참여</Button></div>}
      <HowItWorks />
    </>}
    </div>
    <CreateProject open={params.has('create')} onClose={() => setModal()} />
    <JoinProject open={params.has('join')} onClose={() => setModal()} />
  </div>
}
