import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { z } from 'zod'
import { invitationSchema, invitationToken } from '../../../entities/project/model.ts'
import { projectsApi } from '../../../entities/project/api.ts'
import { useSession } from '../../../entities/session/sessionContext.ts'
import { SessionStatus } from '../../../entities/session/SessionStatus.tsx'
import { Button } from '../../../shared/ui/Button.tsx'
import { Field } from '../../../shared/ui/Field.tsx'
import { Modal } from '../../../shared/ui/Modal.tsx'
import { RequestError } from '../../../shared/ui/RequestError.tsx'
import { StatusPanel } from '../../../shared/ui/StatusPanel.tsx'
import buttons from '../../../shared/ui/Button.module.css'
import styles from './Projects.module.css'

export function InvitationDialog({ open, onClose, token = '' }: { open: boolean; onClose: () => void; token?: string }) {
  const session = useSession()
  const navigate = useNavigate()
  const [link, setLink] = useState(token ? `${window.location.origin}/invite/${token}` : '')
  const [requested, setRequested] = useState(token)
  const [result, setResult] = useState<{ token: string; invitation: z.infer<typeof invitationSchema> } | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [error, setError] = useState<unknown>()
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const lock = useRef(false)
  const invitation = result?.token === requested ? result.invitation : null
  const returnTo = `/invite/${encodeURIComponent(requested)}`
  const [previous, setPrevious] = useState({ open, token })
  if (previous.open !== open || previous.token !== token) {
    setPrevious({ open, token })
    if (open) {
      setLink(token ? `${window.location.origin}/invite/${token}` : '')
      setRequested(token); setResult(null); setError(undefined); setInvalid(false)
    }
  }
  useEffect(() => {
    if (!open || !requested) return
    const controller = new AbortController()
    void projectsApi.invitation(requested, controller.signal).then((value) => {
      if (!controller.signal.aborted) { setResult({ token: requested, invitation: value }); setError(undefined) }
    }).catch((reason) => { if (!controller.signal.aborted) { setResult(null); setError(reason) } })
    return () => controller.abort()
  }, [open, requested, session.user?.id, session.user?.onboardingStatus, revision])
  async function accept() {
    if (lock.current || !invitation || !session.user || session.user.onboardingStatus !== 'completed') return
    lock.current = true; setBusy(true); setError(undefined)
    try {
      await projectsApi.invitation(requested)
      const next = await projectsApi.accept(requested)
      navigate(`/projects/${next.projectId}`, { replace: true })
    } catch (reason) { setError(reason) }
    finally { lock.current = false; setBusy(false) }
  }
  function preview() {
    const next = invitationToken(link, window.location.origin)
    if (!next) { setInvalid(true); return }
    setError(undefined); setRequested(next); setRevision((value) => value + 1)
  }
  const close = () => { if (!busy) onClose() }
  const ready = !session.loading && !session.error && invitation && !error
  return <Modal open={open} title="초대받은 프로젝트에 참여" description="초대 링크를 확인하고 팀 공간에 참여하세요" size="form" onClose={close}
    footer={<>
      <Button variant="secondary" disabled={busy} onClick={close}>취소</Button>
      {ready ? !session.user ? <Link className={`${buttons.button} ${buttons.primary}`} to={`/login?${new URLSearchParams({ returnTo })}`}>로그인하고 초대 확인</Link>
        : session.user.onboardingStatus === 'pending' ? <Link className={`${buttons.button} ${buttons.primary}`} to={`/onboarding?${new URLSearchParams({ returnTo })}`}>가입을 마치고 초대 확인</Link>
          : <Button loading={busy} onClick={() => void accept()}>{invitation.alreadyMember ? '참여 중인 프로젝트 열기' : '프로젝트 참여'}</Button>
        : <Button form="invitation-preview" type="submit" disabled={!!requested && !error}>초대 확인</Button>}
    </>}>
    <form id="invitation-preview" className={styles.invitationForm} onSubmit={(event) => { event.preventDefault(); if (!busy) preview() }}>
      <Field label="초대 링크" value={link} readOnly={busy} onChange={(event) => {
        setLink(event.target.value); setRequested(''); setResult(null); setInvalid(false); setError(undefined)
      }} placeholder={`${window.location.origin}/invite/`} error={invalid ? '이 서비스의 올바른 초대 링크를 입력해 주세요' : undefined} />
      {session.loading || session.error ? <SessionStatus /> : error ? <RequestError error={error} action={<Button type="button" onClick={preview}>초대 다시 확인</Button>} />
        : requested && !invitation ? <StatusPanel kind="loading" title="초대를 확인하고 있어요" />
          : invitation ? <section className={styles.invitationSummary}>
            <h3>{invitation.projectName}</h3><p className={styles.muted}>{invitation.inviterName}님이 초대했어요</p>
            <p className={styles.small}>유효 기간 {new Date(invitation.expiresAt).toLocaleString('ko-KR')}</p>
          </section> : <p className={styles.muted}>초대 링크를 확인하면 프로젝트 정보가 표시돼요</p>}
    </form>
  </Modal>
}

export default function Invitation() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  return <div className={styles.invitationBackground}>
    <Link to="/">TeamPleSpace</Link>
    <InvitationDialog token={token} open onClose={() => navigate('/', { replace: true })} />
  </div>
}
