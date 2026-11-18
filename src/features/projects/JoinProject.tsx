import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '../../shared/ui/Button.tsx'
import { Field } from '../../shared/ui/Field.tsx'
import { Modal } from '../../shared/ui/Modal.tsx'
import { invitationToken } from './model.ts'
import styles from './Projects.module.css'

export function JoinProject({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [link, setLink] = useState('')
  const [invalid, setInvalid] = useState(false)
  const navigate = useNavigate()
  return <Modal open={open} title="초대받은 프로젝트에 참여" description="초대 링크를 확인하고 팀 공간에 참여하세요" size="form" onClose={onClose}
    footer={<><Button variant="secondary" onClick={onClose}>취소</Button><Button form="join-project" type="submit">초대 확인</Button></>}>
    <form id="join-project" className={styles.form} onSubmit={(event) => {
      event.preventDefault()
      const token = invitationToken(link, window.location.origin)
      if (!token) { setInvalid(true); return }
      onClose(); navigate(`/invite/${token}`)
    }}><Field label="초대 링크" value={link} onChange={(event) => { setLink(event.target.value); setInvalid(false) }} required autoFocus
      placeholder={`${window.location.origin}/invite/`}
      error={invalid ? '이 서비스의 올바른 초대 링크를 입력해 주세요' : undefined} /></form>
  </Modal>
}
