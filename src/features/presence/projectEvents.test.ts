import { expect, test, vi } from 'vitest'
import { openEventStream } from '../editor/sse.ts'
import { subscribeProjectEvents } from './projectEvents.ts'

vi.mock('../editor/sse.ts', () => ({ openEventStream: vi.fn(), StreamRejectedError: class extends Error {} }))

test('같은 프로젝트의 여러 기능이 구독 하나를 같이 쓰고 끊기면 모두에게 알린다', async () => {
  let drop: (error: Error) => void = () => {}
  vi.mocked(openEventStream).mockImplementationOnce(({ onOpen, onMessage }) => new Promise((_, reject) => {
    onOpen()
    onMessage({ event: 'memo.updated', data: '{}' })
    drop = reject
  })).mockImplementation(({ signal }) => new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve())))
  const first = { onMessage: vi.fn(), onClose: vi.fn() }
  const second = { onMessage: vi.fn(), onClose: vi.fn() }
  const stopFirst = subscribeProjectEvents('p1', first)
  const stopSecond = subscribeProjectEvents('p1', second)
  await vi.waitFor(() => expect(first.onMessage).toHaveBeenCalled())
  expect(openEventStream).toHaveBeenCalledTimes(1)
  drop(new Error('연결 끊김'))
  await vi.waitFor(() => expect(second.onClose).toHaveBeenCalled())
  expect(first.onClose).toHaveBeenCalled()
  stopFirst()
  stopSecond()
})
