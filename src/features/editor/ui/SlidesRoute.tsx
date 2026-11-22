import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Link, useParams } from 'react-router'
import { projectsApi } from '../../../entities/project/api.ts'
import type { Project } from '../../../entities/project/model.ts'
import { api } from '../../../entities/session/api.ts'
import { emptySchema } from '../../../entities/session/model.ts'
import { useSession } from '../../../entities/session/sessionContext.ts'
import { ApiError } from '../../../shared/api/client.ts'
import { useShell } from '../../../shared/lib/shellContext.ts'
import { Button } from '../../../shared/ui/Button.tsx'
import { RequestError } from '../../../shared/ui/RequestError.tsx'
import { StatusPanel } from '../../../shared/ui/StatusPanel.tsx'
import PresentationGeneration from '../../generation/ui/PresentationGeneration.tsx'
import { createEditorSession } from '../session.ts'
import { SlideEditor } from './SlideEditor.tsx'

export default function SlidesRoute() {
  const { projectId = '', slideId } = useParams()
  return <ProjectSlides key={projectId} projectId={projectId} slideId={slideId} />
}

function ProjectSlides({ projectId, slideId }: { projectId: string; slideId?: string }) {
  const { setCurrentProject } = useShell()
  const { setUser } = useSession()
  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState<unknown>()
  const [revision, setRevision] = useState(0)
  // 편집 세션은 프로젝트 화면에 머무는 동안 하나만 쓴다
  const [session] = useState(() =>
    createEditorSession({ client: api, fetchImpl: (input, init) => fetch(input, init), projectId }),
  )
  const rejected = useSyncExternalStore(session.subscribe, () => session.getState().rejected)

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

  useEffect(() => {
    session.start()
    return () => session.stop()
  }, [session])

  // 편집 중에 로그인이 끝나면 로그인 화면으로 보낸다
  useEffect(() => {
    if (rejected?.status === 401) setUser(null)
  }, [rejected, setUser])

  if (error) return <>
    <RequestError error={error} action={<Button onClick={() => {
      setError(undefined)
      setRevision((value) => value + 1)
    }}>다시 불러오기</Button>} />
    <Link to="/">프로젝트 목록으로</Link>
  </>
  if (!project) return <StatusPanel kind="loading" title="프로젝트를 불러오고 있어요" />
  // 생성이 끝나 문서가 생겨도 완료 안내가 이어서 보이도록 생성 모달은 편집기 바깥에 둔다
  return <PresentationGeneration projectId={projectId} projectName={project.name} onCompleted={session.refresh}>
    {(generate) => <SlideEditor projectId={projectId} projectName={project.name} session={session} slideId={slideId}
      generate={generate}
      // 개발 서버에서 AI 없이 편집을 확인하는 용도다
      onCreateSample={import.meta.env.DEV ? async () => {
        await api.request(`/projects/${projectId}/sample-presentation`, emptySchema, { method: 'POST' })
        await session.refresh()
      } : undefined} />}
  </PresentationGeneration>
}
