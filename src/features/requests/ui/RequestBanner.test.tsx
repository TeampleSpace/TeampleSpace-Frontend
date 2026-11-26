// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from '../../../shared/api/client.ts'
import { SessionContext } from '../../../entities/session/sessionContext.ts'
import type { User } from '../../../entities/session/model.ts'
import { requestsApi } from '../../../entities/request/api.ts'
import type { ChangeRequest } from '../../../entities/request/api.ts'
import { RequestBanner } from './RequestBanner.tsx'

vi.mock('../../../entities/request/api.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../entities/request/api.ts')>(),
  requestsApi: { create: vi.fn(), list: vi.fn(), approve: vi.fn(), reject: vi.fn(), cancel: vi.fn() },
}))

const projectId = 'project'
const me = { userId: 'me', name: '나' }
const other = { userId: 'other', name: '김다혜' }
const base: ChangeRequest = {
  id: 'request-1', projectId, type: 'outline_generation', state: 'pending', payload: {},
  requestedBy: other, decidedBy: null, result: null, error: null, createdAt: '', decidedAt: null,
}

function mount() {
  const user = { id: me.userId, name: me.name } as User
  const session = { user, capabilities: null, loading: false, error: undefined, refresh: vi.fn(), setUser: vi.fn() }
  return render(<SessionContext value={session}><RequestBanner projectId={projectId} /></SessionContext>)
}

const decided = vi.fn()
beforeEach(() => {
  vi.resetAllMocks()
  window.addEventListener('teamplespace:request-decided', decided)
})
afterEach(() => { cleanup(); window.removeEventListener('teamplespace:request-decided', decided) })

test('다른 팀원의 요청을 승인하면 결과를 알리고 같은 프로젝트 화면에 전한다', async () => {
  vi.mocked(requestsApi.list).mockResolvedValue({ items: [base] })
  const approved = { ...base, state: 'approved' as const, decidedBy: me, result: { jobId: 'job-1' } }
  vi.mocked(requestsApi.approve).mockResolvedValue(approved)
  mount()
  expect(await screen.findByText('김다혜님이 AI 구성 만들기를 요청했어요')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '요청 취소' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '승인하기' }))
  expect(await screen.findByText('김다혜님의 AI 구성 만들기 요청을 승인했어요')).toBeTruthy()
  expect(requestsApi.approve).toHaveBeenCalledWith(base.id)
  expect(screen.queryByRole('button', { name: '승인하기' })).toBeNull()
  // 누른 버튼이 사라지면 결과 알림으로 포커스를 옮긴다
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '알림 닫기' }))
  expect((decided.mock.calls[0][0] as CustomEvent).detail).toEqual(approved)
  fireEvent.click(screen.getByRole('button', { name: '알림 닫기' }))
  expect(screen.queryByRole('region', { name: '승인 요청' })).toBeNull()
})

test('내 요청은 취소만 할 수 있고 다른 팀원이 처리한 결과는 다시 읽을 때 알린다', async () => {
  const mine = { ...base, type: 'design_change' as const, requestedBy: me }
  const failed = { ...base, id: 'request-2', type: 'presentation_generation' as const, requestedBy: me }
  vi.mocked(requestsApi.list).mockResolvedValue({ items: [mine, failed] })
  mount()
  expect(await screen.findByText('디자인 변경을 요청했어요. 다른 팀원 한 명이 승인하면 실행돼요')).toBeTruthy()
  expect(screen.getAllByRole('button', { name: '요청 취소' })).toHaveLength(2)
  expect(screen.queryByRole('button', { name: '승인하기' })).toBeNull()
  expect(decided).not.toHaveBeenCalled()

  vi.mocked(requestsApi.list).mockResolvedValue({ items: [
    { ...mine, state: 'approved', decidedBy: other, result: { designVersion: 3 } },
    { ...failed, state: 'failed', decidedBy: other, error: { code: 'VERSION_CONFLICT', message: '발표 구성이 바뀌었어요' } },
  ] })
  fireEvent(window, new Event('focus'))
  expect(await screen.findByText('김다혜님이 내 디자인 변경 요청을 승인했어요')).toBeTruthy()
  expect(screen.getByText('내 PPT 만들기 요청을 승인했지만 실행하지 못했어요. 발표 구성이 바뀌었어요')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '요청 취소' })).toBeNull()
  expect(decided).toHaveBeenCalledTimes(2)
})

test('이미 처리된 요청을 승인하면 이유를 보여 주고 목록을 다시 읽는다', async () => {
  vi.mocked(requestsApi.list).mockResolvedValueOnce({ items: [base] })
    .mockResolvedValue({ items: [{ ...base, state: 'rejected', decidedBy: { userId: 'third', name: '박팀원' } }] })
  vi.mocked(requestsApi.approve).mockRejectedValue(new ApiError(409, {
    error: { code: 'REQUEST_NOT_PENDING', message: '이미 처리된 요청이에요.', retryable: false }, requestId: 'request',
  }))
  mount()
  fireEvent.click(await screen.findByRole('button', { name: '승인하기' }))
  expect(await screen.findByText('이미 처리된 요청이에요.')).toBeTruthy()
  expect(await screen.findByText('박팀원님이 김다혜님의 AI 구성 만들기 요청을 거절했어요')).toBeTruthy()
  await waitFor(() => expect(screen.queryByRole('button', { name: '승인하기' })).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: '오류 알림 닫기' }))
  expect(screen.queryByText('이미 처리된 요청이에요.')).toBeNull()
})
