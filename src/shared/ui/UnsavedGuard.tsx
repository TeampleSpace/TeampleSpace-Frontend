import { useCallback } from 'react'
import { useBeforeUnload, useBlocker } from 'react-router'
import { Button } from './Button.tsx'
import { Modal } from './Modal.tsx'

export function UnsavedGuard({ dirty }: { dirty: boolean }) {
  const blocker = useBlocker(dirty)
  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => {
    if (dirty) { event.preventDefault(); event.returnValue = '' }
  }, [dirty]))
  return <Modal open={blocker.state === 'blocked'} title="저장하지 않은 변경이 있어요" size="confirm"
    description="이동하면 입력한 내용이 사라져요" onClose={() => blocker.state === 'blocked' && blocker.reset()}
    footer={<><Button variant="secondary" onClick={() => blocker.state === 'blocked' && blocker.reset()}>계속 작성</Button>
      <Button onClick={() => blocker.state === 'blocked' && blocker.proceed()}>이동</Button></>} />
}
