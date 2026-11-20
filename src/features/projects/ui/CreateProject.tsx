import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { ApiError } from '../../../shared/api/client.ts'
import { Button } from '../../../shared/ui/Button.tsx'
import { Field } from '../../../shared/ui/Field.tsx'
import { Modal } from '../../../shared/ui/Modal.tsx'
import { RequestError } from '../../../shared/ui/RequestError.tsx'
import { projectsApi } from '../../../entities/project/api.ts'
import type { ProjectInput } from '../../../entities/project/model.ts'
import styles from './Projects.module.css'

export function CreateProject({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [constraints, setConstraints] = useState('')
  const [pending, setPending] = useState<{ body: ProjectInput; key: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const lock = useRef(false)
  async function submit() {
    if (lock.current || !name.trim()) return
    lock.current = true; setBusy(true); setError(undefined)
    const command = pending ?? { body: { name: name.trim(), topic: topic.trim(), presentationConstraints: constraints.trim() }, key: crypto.randomUUID() }
    setPending(command)
    try {
      const project = await projectsApi.create(command.body, command.key)
      setPending(null); setName(''); setTopic(''); setConstraints(''); onClose()
      navigate(`/projects/${project.id}`)
    } catch (reason) {
      if (reason instanceof ApiError && reason.status < 500 && reason.code !== 'REQUEST_IN_PROGRESS') setPending(null)
      setError(reason)
    } finally { lock.current = false; setBusy(false) }
  }
  return <Modal open={open} title="새 프로젝트" description="프로젝트 이름만 정하면 시작할 수 있어요" size="form" onClose={() => { if (!busy) onClose() }}
    footer={<><Button variant="secondary" disabled={busy} onClick={onClose}>취소</Button><Button type="submit" form="create-project" loading={busy} disabled={!name.trim()}>{pending && error ? '같은 요청 다시 확인' : '프로젝트 만들기'}</Button></>}>
    <form id="create-project" className={styles.form} onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <Field label="프로젝트 이름" value={name} onChange={(event) => setName(event.target.value)} required maxLength={255} disabled={!!pending} autoFocus />
      <Field label="발표 주제 (선택)" value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={10000} disabled={!!pending} />
      <Field label="발표 조건 (선택)" value={constraints} onChange={(event) => setConstraints(event.target.value)} maxLength={10000} disabled={!!pending} />
      <p className={styles.small}>프로젝트를 만든 뒤 팀원을 초대할 수 있어요</p>
      {pending && !!error && <p role="status">생성 결과를 확인하지 못했어요. 같은 요청을 다시 확인하면 중복 생성을 막을 수 있어요</p>}
      <RequestError error={error} />
    </form>
  </Modal>
}
