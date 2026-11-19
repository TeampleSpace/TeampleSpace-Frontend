import { useCallback } from 'react'
import { useBeforeUnload, useBlocker } from 'react-router'
import type { BlockerFunction } from 'react-router'
import { Button } from './Button.tsx'
import { Modal } from './Modal.tsx'

// when을 주면 미저장 내용을 잃는 이동만 골라서 막는다
export function UnsavedGuard({ dirty, when }: { dirty: boolean; when?: BlockerFunction }) {
  const blocker = useBlocker(when ? (args) => dirty && when(args) : dirty)
  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => {
    if (dirty) { event.preventDefault(); event.returnValue = '' }
  }, [dirty]))
  return <Modal open={blocker.state === 'blocked'} title="저장하지 않은 변경이 있어요" size="confirm"
    description="이동하면 입력한 내용이 사라져요" onClose={() => blocker.state === 'blocked' && blocker.reset()}
    footer={<><Button variant="secondary" onClick={() => blocker.state === 'blocked' && blocker.reset()}>계속 작성</Button>
      <Button onClick={() => blocker.state === 'blocked' && blocker.proceed()}>이동</Button></>} />
}
