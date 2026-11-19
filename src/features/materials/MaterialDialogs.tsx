import { useRef, useState } from 'react'
import { ApiError } from '../../shared/api/client.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { Field } from '../../shared/ui/Field.tsx'
import { Modal } from '../../shared/ui/Modal.tsx'
import { RequestError } from '../../shared/ui/RequestError.tsx'
import { materialsApi } from './api.ts'
import { isGone } from './errors.ts'
import { limits } from './model.ts'
import type { Material } from './model.ts'
import styles from './Materials.module.css'

// 이름 변경과 삭제 확인. 저장은 자료 버전을 비교한다
export function MaterialDialogs({ material, view, onClose, onChanged, onDeleted, onRefresh, onError }: {
  material: Material; view: 'rename' | 'delete'; onClose: () => void
  onChanged: (next: Material) => void; onDeleted: (id: string) => void
  onRefresh: () => Promise<unknown>; onError: (reason: unknown) => void
}) {
  const [title, setTitle] = useState(material.title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const lock = useRef(false)
  const name = title.replace(/\s+/g, ' ').trim()
  const close = () => { if (!busy) onClose() }

  async function act(work: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(undefined)
    try { await work() }
    catch (reason) { setError(reason); onError(reason) }
    finally { lock.current = false; setBusy(false) }
  }
  const rename = () => {
    if (!name || name.length > limits.title) return
    if (name === material.title) { onClose(); return }
    void act(async () => { onChanged(await materialsApi.update(material.id, material.version, { title: name })); onClose() })
  }
  const remove = () => void act(async () => {
    try { await materialsApi.remove(material.id, material.version) }
    // 응답을 못 받고 다시 보냈을 때 이미 지워졌으면 삭제된 것으로 본다
    catch (reason) { if (!isGone(reason)) throw reason }
    onDeleted(material.id)
  })
  const refresh = <Button variant="text" disabled={busy} onClick={() => void onRefresh().then(() => setError(undefined)).catch(setError)}>최신 정보 확인</Button>
  const forbidden = error instanceof ApiError && error.code === 'FORBIDDEN'

  if (view === 'rename') return <Modal open title="자료 이름 변경" size="confirm" onClose={close}
    footer={<><Button loading={busy} disabled={!name || name.length > limits.title} onClick={rename}>저장</Button><Button variant="secondary" disabled={busy} onClick={close}>취소</Button></>}>
    <Field label="자료 이름" multiline rows={1} maxLength={limits.title} value={title} data-autofocus
      error={title && !name ? '이름을 입력해 주세요' : undefined}
      onChange={(event) => setTitle(event.target.value)}
      onKeyDown={(event) => {
        // 한글 조합 중의 Enter는 저장으로 보지 않는다
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); rename() }
      }} />
    <RequestError error={error} action={refresh} />
  </Modal>

  return <Modal open title="자료를 삭제할까요?" size="confirm" onClose={close}
    description={`${material.title} 자료가 목록에서 사라져요`}
    footer={<><Button variant="danger" loading={busy} disabled={!material.canDelete} onClick={remove}>삭제</Button><Button variant="secondary" disabled={busy} onClick={close} data-autofocus>취소</Button></>}>
    <p className={styles.info}>슬라이드 내용은 남고, 연결된 자료는 삭제됨으로 표시돼요.</p>
    {(forbidden || !material.canDelete) && <p role="alert" className={styles.dangerText}>프로젝트 소유자와 이 자료를 추가한 사람만 삭제할 수 있어요</p>}
    {!forbidden && <RequestError error={error} action={refresh} />}
  </Modal>
}
