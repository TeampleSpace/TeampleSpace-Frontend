import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../../shared/api/client.ts'
import { Button } from '../../../shared/ui/Button.tsx'
import { Modal } from '../../../shared/ui/Modal.tsx'
import { RequestError } from '../../../shared/ui/RequestError.tsx'
import { StatusPanel } from '../../../shared/ui/StatusPanel.tsx'
import { useSession } from '../../../entities/session/sessionContext.ts'
import { allMembers, projectsApi } from '../../../entities/project/api.ts'
import { memberPermissions } from '../../../entities/project/model.ts'
import type { Member, Project } from '../../../entities/project/model.ts'
import styles from './Projects.module.css'

export type TeamView = 'members' | 'invite' | 'remove' | 'transfer' | 'leave'
export function TeamDialog({ project, initialView, open = true, onClose, onChange, onExit, onAccessError }: {
  open?: boolean
  project: Project; initialView: TeamView; onClose: () => void; onChange: (project?: Project) => Promise<void>
  onExit: () => void; onAccessError: (error: unknown) => void
}) {
  const { user } = useSession()
  const [view, setView] = useState(initialView)
  const [members, setMembers] = useState<Member[] | null>(null)
  const [targetId, setTargetId] = useState('')
  const [error, setError] = useState<unknown>()
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [pendingRemoval, setPendingRemoval] = useState<{ member: Member; mutation: string; key: string } | null>(null)
  const lock = useRef(false)
  const userId = user?.id ?? ''
  const isOwner = project.ownerId === userId
  const target = members?.find((member) => member.userId === targetId)
  const self = members?.find((member) => member.userId === userId)

  const [previous, setPrevious] = useState({ open, initialView })
  if (previous.open !== open || previous.initialView !== initialView) {
    setPrevious({ open, initialView })
    if (open) {
      setView(initialView); setMembers(null); setTargetId(''); setError(undefined)
      setCopied(false); setCopyFailed(false); setLink(null); setPendingRemoval(null)
    }
  }

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    void allMembers(project.id, controller.signal).then((data) => {
      if (!controller.signal.aborted) { setMembers(data); setError(undefined) }
    }).catch((reason) => { if (!controller.signal.aborted) { setError(reason); onAccessError(reason) } })
    return () => controller.abort()
  }, [project.id, revision, onAccessError, open, initialView])

  async function act(work: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(undefined)
    try { await work() }
    catch (reason) { setError(reason); onAccessError(reason) }
    finally { lock.current = false; setBusy(false) }
  }
  async function remove(member: Member) {
    const permissions = memberPermissions(project, member, userId)
    if (!permissions.canRemove && !permissions.canLeave) return
    const command = pendingRemoval ?? { member, mutation: crypto.randomUUID(), key: crypto.randomUUID() }
    setPendingRemoval(command)
    await act(async () => {
      try {
        await projectsApi.removeMember(project.id, command.member.userId, command.member.membershipVersion, command.mutation, command.key)
      } catch (reason) {
        if (reason instanceof ApiError && reason.status < 500 && reason.code !== 'REQUEST_IN_PROGRESS') setPendingRemoval(null)
        throw reason
      }
      setPendingRemoval(null)
      if (command.member.userId === userId) onExit()
      else { setView('members'); setTargetId(''); setRevision((value) => value + 1); await onChange() }
    })
  }
  const close = () => { if (!busy) onClose() }
  async function copy() {
    if (!link || lock.current) return
    lock.current = true; setBusy(true); setCopied(false); setCopyFailed(false)
    try { await navigator.clipboard.writeText(link.url); setCopied(true) }
    catch { setCopyFailed(true) }
    finally { lock.current = false; setBusy(false) }
  }
  const title = view === 'members' ? '팀원 관리' : view === 'invite' ? '팀원 초대' : view === 'transfer' ? '새 소유자를 선택하세요' : view === 'leave' ? '프로젝트에서 나갈까요?' : `${target?.name ?? '팀원'}님을 내보낼까요?`
  return <Modal open={open} title={title} description={project.name} size={view === 'members' ? 'team' : view === 'invite' ? 'invite' : 'confirm'} onClose={close}>
    <div className={styles.teamContent}>
      {!members && !error && <StatusPanel kind="loading" title="팀원을 불러오고 있어요" />}
      {view === 'members' && members && <>
        <p>프로젝트 팀원 {members.length}명</p>
        <ul className={styles.members}>{members.map((member) => <li className={styles.member} key={member.userId}>
          <span>{member.name}{member.userId === userId ? ' (나)' : ''}</span><span className={styles.muted}>{member.isOwner ? '프로젝트 소유자' : '팀원'}</span>
          {memberPermissions(project, member, userId).canRemove && <Button variant="text" onClick={() => { setTargetId(member.userId); setView('remove'); setError(undefined) }}>내보내기</Button>}
        </li>)}</ul>
        <div><Button loading={busy} onClick={() => void act(async () => { setLink(await projectsApi.invite(project.id)); setView('invite') })}>팀원 초대</Button></div>
        <p className={styles.small}>팀원은 프로젝트 자료와 팀 메모를 볼 수 있어요.</p>
        {isOwner && <div><Button variant="text" onClick={() => { setView('transfer'); setError(undefined) }}>소유자 변경</Button></div>}
      </>}
      {view === 'invite' && <>
        <h3 className={styles.inviteHeading}>초대 링크</h3>
        {!link ? <Button loading={busy} onClick={() => void act(async () => setLink(await projectsApi.invite(project.id)))}>초대 링크 만들기</Button> : <>
          <a className={styles.inviteLink} href={link.url} target="_blank" rel="noopener noreferrer">{link.url}</a>
          <p className={styles.muted}>팀원에게 이 링크를 보내세요.</p>
          <div><Button loading={busy} onClick={() => void copy()}>초대 링크 복사</Button></div>
          <p className={styles.copyStatus} role="status">{copyFailed || copied
            ? <span className="motion-feedback" key={copyFailed ? 'failed' : 'copied'}>{copyFailed ? '복사하지 못했어요. 위 링크를 직접 복사해 주세요.' : '초대 링크를 복사했어요'}</span>
            : null}</p>
          <div className={styles.inviteExpiry}><p className={styles.small}>유효 기간 {new Date(link.expiresAt).toLocaleString('ko-KR')}</p>
            <p className={styles.small}>새 링크를 발급하면 기존 링크를 사용할 수 없어요</p>
            <div><Button variant="secondary" loading={busy} onClick={() => void act(async () => { setLink(await projectsApi.invite(project.id, true)); setCopied(false); setCopyFailed(false) })}>새 링크 발급</Button></div></div>
        </>}
      </>}
      {view === 'transfer' && members && <>
        <p>프로젝트의 관리 권한을 넘겨요. 팀원의 편집 권한은 유지돼요</p>
        {members.filter((member) => memberPermissions(project, member, userId).canTransfer).map((member) => <label className={styles.choice} key={member.userId}>
          <input type="radio" name="new-owner" value={member.userId} checked={targetId === member.userId} onChange={() => setTargetId(member.userId)} disabled={busy} />{member.name}
        </label>)}
        {members.length < 2 && <p>소유권을 넘길 팀원을 먼저 초대해 주세요</p>}
        <div className={styles.actions}><Button disabled={!target || !memberPermissions(project, target, userId).canTransfer} loading={busy}
          onClick={() => { if (target) void act(async () => { const next = await projectsApi.transfer(project.id, target.userId, project.version); await onChange(next); onClose() }) }}>{target ? `${target.name}님에게 변경` : '팀원을 선택해 주세요'}</Button>
          <Button variant="secondary" disabled={busy} onClick={close}>취소</Button></div>
      </>}
      {view === 'remove' && target && <><p>내보낸 팀원은 이 프로젝트에 더 이상 접근할 수 없어요</p>
        <div className={styles.actions}><Button variant="danger" loading={busy} onClick={() => void remove(target)}>내보내기</Button><Button variant="secondary" disabled={busy} onClick={close}>취소</Button></div>
      </>}
      {view === 'leave' && members && <>
        <p>{isOwner ? '소유권을 다른 팀원에게 넘긴 뒤 나갈 수 있어요' : '프로젝트에서 나가면 자료와 발표자료에 접근할 수 없어요'}</p>
        <div className={styles.actions}>{isOwner ? <Button onClick={() => setView('transfer')}>소유자 변경</Button> : <Button variant="danger" loading={busy} disabled={!self} onClick={() => { if (self) void remove(self) }}>프로젝트 나가기</Button>}
          <Button variant="secondary" disabled={busy} onClick={close}>취소</Button></div>
      </>}
      {pendingRemoval && !!error && <p>결과를 확인하지 못했어요. 다시 시도하면 같은 요청을 확인해요</p>}
      <RequestError error={error} action={!busy && !pendingRemoval ? <Button variant="text" onClick={() => { setRevision((value) => value + 1); void onChange().catch(setError) }}>최신 정보 확인</Button> : undefined} />
    </div>
  </Modal>
}
