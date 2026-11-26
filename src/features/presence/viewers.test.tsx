// @vitest-environment jsdom
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { allMembers } from '../../entities/project/api.ts'
import { api } from '../../entities/session/api.ts'
import { subscribeProjectEvents } from './projectEvents.ts'
import type { ProjectListener } from './projectEvents.ts'
import { colorOf, tabOf, useProjectViewers } from './viewers.ts'
import { ProjectViewers } from './ProjectViewers.tsx'

vi.mock('../../entities/project/api.ts', () => ({ allMembers: vi.fn() }))
vi.mock('../../entities/session/api.ts', () => ({ api: { request: vi.fn() } }))
vi.mock('./projectEvents.ts', () => ({ subscribeProjectEvents: vi.fn() }))

// 구독한 쪽을 붙잡아 두고 신호를 직접 넣는다
let listener: ProjectListener = {}
function listen() {
  vi.mocked(subscribeProjectEvents).mockImplementation((_projectId, next) => { listener = next; return () => {} })
}
const send = (viewers: { userId: string; tab: string }[]) =>
  listener.onMessage?.({ event: 'viewers.updated', data: JSON.stringify({ projectId: 'p1', viewers }) })

afterEach(() => { vi.useRealTimers(); vi.resetAllMocks() })

describe('프로젝트 탭 접속 현황', () => {
  it('주소로 보는 탭을 정한다', () => {
    expect(tabOf('/projects/p1')).toBe('overview')
    expect(tabOf('/projects/p1/materials')).toBe('materials')
    expect(tabOf('/projects/p1/slides/s1')).toBe('slides')
    expect(tabOf('/projects/p1/unknown')).toBeUndefined()
    expect(tabOf('/account')).toBeUndefined()
  })

  it('팀원 이름과 보는 탭을 같은 색으로 보여 준다', () => {
    render(<ProjectViewers viewers={[{ userId: 'u1', name: '김팀원', tab: 'outline' }]} />)
    const list = screen.getByRole('list', { name: '지금 함께 보는 팀원' })
    expect(list.textContent).toContain('김팀원')
    expect(list.textContent).toContain('발표 구성 보는 중')
    expect(colorOf('u1')).toBe(colorOf('u1'))
  })

  it('이벤트 연결이 끊기면 받은 목록을 비운다', async () => {
    vi.mocked(api.request).mockResolvedValue(undefined)
    vi.mocked(allMembers).mockResolvedValue([])
    listen()
    const { result, unmount } = renderHook(() => useProjectViewers('p1', 'materials'))
    act(() => { listener.onOpen?.(); send([{ userId: 'u2', tab: 'design' }]) })
    await waitFor(() => expect(result.current).toHaveLength(1))
    act(() => listener.onClose?.())
    expect(result.current).toEqual([])
    unmount()
  })

  it('알림마다 순번을 늘리고 팀원 이름을 읽지 못하면 잠시 뒤 다시 읽는다', async () => {
    vi.mocked(api.request).mockResolvedValue(undefined)
    listen()
    vi.mocked(allMembers).mockRejectedValueOnce(new TypeError('연결 끊김'))
      .mockResolvedValue([{ userId: 'u2', name: '박팀원', role: 'member', membershipVersion: 1, isOwner: false }])
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result, rerender } = renderHook(({ tab }) => useProjectViewers('p1', tab), { initialProps: { tab: 'materials' as const } })
    act(() => send([{ userId: 'u2', tab: 'design' }]))
    await waitFor(() => expect(result.current).toEqual([{ userId: 'u2', tab: 'design', name: '팀원' }]))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    await waitFor(() => expect(result.current[0]?.name).toBe('박팀원'))

    rerender({ tab: 'outline' as never })
    const seqs = vi.mocked(api.request).mock.calls.map((call) => (call[2] as { body: { seq: number } }).body.seq)
    expect(seqs.length).toBeGreaterThan(1)
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs)
  })
})
