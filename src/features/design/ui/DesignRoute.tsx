import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { useShell } from '../../../shared/lib/shellContext.ts'
import { ApiError } from '../../../shared/api/client.ts'
import { Button } from '../../../shared/ui/Button.tsx'
import { RequestError } from '../../../shared/ui/RequestError.tsx'
import { StatusPanel } from '../../../shared/ui/StatusPanel.tsx'
import { useSession } from '../../auth/sessionContext.ts'
import { projectsApi } from '../../projects/api.ts'
import type { Project } from '../../projects/model.ts'
import DesignPage from './DesignPage.tsx'

export default function DesignRoute() {
  const { projectId = '' } = useParams()
  return <ProjectDesign key={projectId} projectId={projectId} />
}

function ProjectDesign({ projectId }: { projectId: string }) {
  const { state } = useLocation()
  const { setCurrentProject } = useShell()
  const { setUser } = useSession()
  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState<unknown>()
  const [revision, setRevision] = useState(0)

  const deny = useCallback((reason: unknown) => {
    setProject(null)
    setError(reason)
    if (reason instanceof ApiError && reason.status === 401) setUser(null)
  }, [setUser])

  useEffect(() => {
    const controller = new AbortController()
    void projectsApi.get(projectId, controller.signal).then((data) => {
      if (!controller.signal.aborted) setProject(data)
    }).catch((reason) => { if (!controller.signal.aborted) deny(reason) })
    return () => controller.abort()
  }, [projectId, revision, deny])

  useEffect(() => {
    setCurrentProject(project ? { id: project.id, name: project.name } : null)
    return () => setCurrentProject(null)
  }, [project, setCurrentProject])

  if (error) return <>
    <RequestError error={error} action={<Button onClick={() => {
      setError(undefined)
      setRevision((value) => value + 1)
    }}>다시 불러오기</Button>} />
    <Link to="/">프로젝트 목록으로</Link>
  </>
  if (!project) return <StatusPanel kind="loading" title="프로젝트를 불러오고 있어요" />
  return <DesignPage projectId={projectId} projectName={project.name} fromOutline={state?.fromOutline === true} onAccessError={deny} />
}
