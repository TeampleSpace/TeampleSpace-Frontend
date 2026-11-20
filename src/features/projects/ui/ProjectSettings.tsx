import { useRef, useState } from 'react'
import { Button } from '../../../shared/ui/Button.tsx'
import { Field } from '../../../shared/ui/Field.tsx'
import { RequestError } from '../../../shared/ui/RequestError.tsx'
import { UnsavedGuard } from '../../../shared/ui/UnsavedGuard.tsx'
import { useSession } from '../../auth/sessionContext.ts'
import { projectsApi } from '../api.ts'
import type { Project } from '../model.ts'
import type { TeamView } from './TeamDialog.tsx'
import styles from './Projects.module.css'
import shell from '../../../app/AppShell.module.css'

export function ProjectSettings({ project, onChange, onOpen, onError, leaving }: {
  project: Project; onChange: (value?: Project) => Promise<void>; onOpen: (view: TeamView | 'delete') => void
  onError: (reason: unknown) => void; leaving: boolean
}) {
  const { user } = useSession()
  const [base, setBase] = useState(project)
  const [name, setName] = useState(project.name)
  const [topic, setTopic] = useState(project.topic ?? '')
  const [constraints, setConstraints] = useState(project.presentationConstraints ?? '')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState<unknown>()
  const [saved, setSaved] = useState(false)
  const owner = user?.id === project.ownerId
  const dirty = name !== base.name || topic !== (base.topic ?? '') || constraints !== (base.presentationConstraints ?? '')
  function reset(value: Project) { setBase(value); setName(value.name); setTopic(value.topic ?? ''); setConstraints(value.presentationConstraints ?? ''); setError(undefined) }
  async function save() {
    if (lock.current || !owner || !name.trim()) return
    lock.current = true; setBusy(true); setError(undefined); setSaved(false)
    try {
      const updated = await projectsApi.update(project.id, base.version, { name: name.trim(), topic: topic.trim(), presentationConstraints: constraints.trim() })
      reset(updated); setSaved(true); await onChange(updated)
    } catch (reason) { setError(reason); onError(reason) }
    finally { lock.current = false; setBusy(false) }
  }
  return <div className={`${shell.content} ${styles.settingsContent}`}>
    <p className={styles.muted}>프로젝트의 기본 정보를 관리합니다</p>
    {!owner && <p className={styles.notice}>기본 정보는 프로젝트 소유자가 변경할 수 있어요</p>}
    {project.version !== base.version && <div className={styles.notice}><p>프로젝트 정보가 변경되었어요. 최신 내용을 확인해 주세요</p>
      <Button variant="text" onClick={() => reset(project)}>작성한 내용 대신 최신 정보 불러오기</Button></div>}
    <form className={styles.settingsForm} onSubmit={(event) => { event.preventDefault(); void save() }}>
      <Field label="프로젝트 이름" multiline rows={1} value={name} required maxLength={255} readOnly={!owner} onChange={(event) => setName(event.target.value)} />
      <Field label="발표 주제" multiline rows={1} value={topic} maxLength={10000} readOnly={!owner} onChange={(event) => setTopic(event.target.value)} />
      <Field label="발표 조건" multiline rows={1} value={constraints} maxLength={10000} readOnly={!owner} onChange={(event) => setConstraints(event.target.value)} />
      <p className={styles.information}>{owner ? `소유자 ${user.name}` : '참여 중인 프로젝트'}, 팀원 {project.memberCount}명</p>
      <div className={styles.actions}>{owner && <><Button type="submit" disabled={!dirty || !name.trim()} loading={busy}>저장</Button>
        <Button variant="secondary" disabled={busy} onClick={() => onOpen('transfer')}>소유자 변경</Button></>}
        <Button variant="secondary" disabled={busy} onClick={() => onOpen('leave')}>프로젝트 나가기</Button>
        {owner && <Button variant="dangerOutline" disabled={busy} onClick={() => onOpen('delete')}>프로젝트 삭제</Button>}
      </div>
    </form>
    {saved && <p className="motion-feedback" role="status">프로젝트 정보를 저장했어요</p>}
    <RequestError error={error} action={<Button variant="text" onClick={() => void onChange().catch(setError)}>최신 정보 확인</Button>} />
    <UnsavedGuard dirty={dirty && !leaving} />
  </div>
}
