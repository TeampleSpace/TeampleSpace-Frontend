import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { z } from 'zod'
import { invitationSchema } from './model.ts'
import { projectsApi } from './api.ts'
import { useSession } from '../auth/sessionContext.ts'
import { SessionStatus } from '../auth/Session.tsx'
import { Button } from '../../shared/ui/Button.tsx'
import { RequestError } from '../../shared/ui/RequestError.tsx'
import { StatusPanel } from '../../shared/ui/StatusPanel.tsx'
import styles from './Projects.module.css'

export default function Invitation() {
  const { token = '' } = useParams()
  const session = useSession()
  const navigate = useNavigate()
  const [invitation, setInvitation] = useState<z.infer<typeof invitationSchema> | null>(null)
  const [error, setError] = useState<unknown>()
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const lock = useRef(false)
  const returnTo = `/invite/${encodeURIComponent(token)}`
  useEffect(() => {
    const controller = new AbortController()
    void projectsApi.invitation(token, controller.signal).then((value) => {
      if (!controller.signal.aborted) { setInvitation(value); setError(undefined) }
    }).catch((reason) => { if (!controller.signal.aborted) { setInvitation(null); setError(reason) } })
    return () => controller.abort()
  }, [token, session.user?.id, session.user?.onboardingStatus, revision])
  async function accept() {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(undefined)
    try {
      await projectsApi.invitation(token)
      const result = await projectsApi.accept(token)
      navigate(`/projects/${result.projectId}`, { replace: true })
    } catch (reason) { setError(reason) }
    finally { lock.current = false; setBusy(false) }
  }
  return <div className={styles.invitePage}>
    <h1>초대받은 프로젝트에 참여</h1>
    <p>초대 링크를 확인하고 팀 공간에 참여하세요</p>
    {session.loading || session.error ? <SessionStatus /> : error ? <RequestError error={error} action={<Button onClick={() => setRevision((value) => value + 1)}>초대 다시 확인</Button>} />
      : !invitation ? <StatusPanel kind="loading" title="초대를 확인하고 있어요" />
      : <><section className={styles.card}><h2>{invitation.projectName}</h2><p>{invitation.inviterName}님이 초대했어요</p>
        <p className={styles.small}>유효 기간 {new Date(invitation.expiresAt).toLocaleString('ko-KR')}</p></section>
        {!session.user ? <Link to={`/login?${new URLSearchParams({ returnTo })}`}>로그인하고 초대 확인</Link>
          : session.user.onboardingStatus === 'pending' ? <Link to={`/onboarding?${new URLSearchParams({ returnTo })}`}>가입을 마치고 초대 확인</Link>
          : <Button loading={busy} onClick={() => void accept()}>{invitation.alreadyMember ? '참여 중인 프로젝트 열기' : '프로젝트 참여'}</Button>}
      </>}
    <Link to="/">홈으로 돌아가기</Link>
  </div>
}
