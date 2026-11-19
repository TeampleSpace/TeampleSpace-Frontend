// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useCallback, useState } from 'react'
import { createMemoryRouter, Link, Outlet, RouterProvider } from 'react-router'
import ProjectPage from './ProjectPage.tsx'
import { allMembers, projectsApi } from './api.ts'
import type { Project } from './model.ts'
import { SessionContext } from '../auth/sessionContext.ts'
import { RequireSession } from '../auth/Session.tsx'
import { authApi } from '../auth/api.ts'
import type { User } from '../auth/model.ts'
import Account from '../auth/Account.tsx'
import Login from '../auth/Login.tsx'
import { ApiError, TransportError } from '../../shared/api/client.ts'

vi.mock('./api.ts', () => ({ allMembers: vi.fn(), projectsApi: {
  get: vi.fn(), remove: vi.fn(), removeMember: vi.fn(), transfer: vi.fn(),
} }))
vi.mock('../auth/api.ts', () => ({ authApi: { me: vi.fn() } }))

const project: Project = { id: 'project-1', name: '팀 과제', topic: null, presentationConstraints: null,
  ownerId: 'owner', version: 1, memberCount: 2, createdAt: '2026-11-18T00:00:00Z', updatedAt: '2026-11-18T00:00:00Z' }
const owner: User = { id: 'owner', name: '소유자', email: 'owner@example.test', canEmailReauth: true,
  consentVersions: {}, ownedProjectCount: 1, onboardingStatus: 'completed', identities: [], version: 1 }
const setCurrentProject = vi.fn()

function TestSession() {
  const [user, setUser] = useState<User | null>(owner)
  const refresh = useCallback(async () => { const next = await authApi.me(); setUser(next); return next }, [])
  return <SessionContext value={{ user, setUser, refresh, capabilities: null, loading: false, error: undefined }}><Outlet /></SessionContext>
}
function TestShell() {
  return <><Link to="/account">내 계정 가기</Link><Outlet context={{ setCurrentProject }} /></>
}
function mount() {
  const router = createMemoryRouter([{ element: <TestSession />, children: [
    { path: '/login', element: <Login /> },
    { element: <RequireSession />, children: [{ element: <TestShell />, children: [
      { path: '/', element: <p>프로젝트 목록</p> },
      { path: '/account', element: <Account /> },
      { path: '/projects/:projectId/settings', element: <ProjectPage /> },
    ] }] },
  ] }], { initialEntries: ['/projects/project-1/settings'] })
  render(<RouterProvider router={router} />)
  return router
}
function failure(status: number) {
  return new ApiError(status, { error: { code: status === 401 ? 'AUTH_REQUIRED' : status === 403 ? 'ACCESS_DENIED' : 'INTERNAL_ERROR', message: '서버 오류', retryable: status >= 500 }, requestId: 'request-1' })
}
async function editTopic() {
  const input = await screen.findByLabelText('발표 주제')
  fireEvent.change(input, { target: { value: '저장하지 않은 주제' } })
  return input as HTMLTextAreaElement
}
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(projectsApi.get).mockResolvedValue(project)
  vi.mocked(authApi.me).mockResolvedValue({ ...owner, ownedProjectCount: 0, version: 2 })
  vi.mocked(allMembers).mockResolvedValue([
    { userId: 'owner', name: '소유자', role: 'owner', isOwner: true, membershipVersion: 1 },
    { userId: 'member', name: '팀원', role: 'member', isOwner: false, membershipVersion: 1 },
  ])
})
afterEach(cleanup)

test.each([new TransportError('network'), failure(500)])('백그라운드 조회가 일시적으로 실패해도 미저장 입력을 유지한다 %s', async (error) => {
  mount()
  const input = await editTopic()
  vi.mocked(projectsApi.get).mockRejectedValueOnce(error)
  fireEvent(window, new Event('focus'))
  await screen.findByRole('button', { name: '최신 정보 다시 확인' })
  expect(screen.getByLabelText('발표 주제')).toBe(input)
  expect(input.value).toBe('저장하지 않은 주제')
  expect(setCurrentProject).toHaveBeenLastCalledWith({ id: project.id, name: project.name })
  fireEvent.click(screen.getByRole('button', { name: '최신 정보 다시 확인' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '최신 정보 다시 확인' })).toBeNull())
  expect(input.value).toBe('저장하지 않은 주제')
})

test('권한이 회수되면 일시적인 오류와 달리 프로젝트 입력을 숨긴다', async () => {
  mount()
  await editTopic()
  vi.mocked(projectsApi.get).mockRejectedValueOnce(failure(403))
  fireEvent(window, new Event('focus'))
  await screen.findByText('이 프로젝트에 더 이상 접근할 수 없습니다')
  expect(screen.queryByLabelText('발표 주제')).toBeNull()
  expect(setCurrentProject).toHaveBeenLastCalledWith(null)
  vi.mocked(projectsApi.get).mockRejectedValueOnce(failure(500))
  fireEvent.click(screen.getByRole('button', { name: '접근 권한 다시 확인' }))
  await screen.findByText('서버 오류')
  expect(screen.queryByLabelText('발표 주제')).toBeNull()
})

test('세션이 만료되면 이전 사용자 상태를 지우고 로그인 화면에 머문다', async () => {
  const router = mount()
  await editTopic()
  vi.mocked(projectsApi.get).mockRejectedValueOnce(failure(401))
  fireEvent(window, new Event('focus'))
  await screen.findByText('팀 발표를 한곳에서')
  expect(router.state.location.pathname).toBe('/login')
  expect(router.state.location.search).toBe('?returnTo=%2Fprojects%2Fproject-1%2Fsettings')
  expect(projectsApi.get).toHaveBeenCalledTimes(2)
})

test('미저장 입력이 있어도 삭제를 완료하면 목록으로 이동하고 소유 프로젝트 수를 갱신한다', async () => {
  vi.mocked(projectsApi.remove).mockResolvedValue(undefined)
  const router = mount()
  await editTopic()
  fireEvent.click(screen.getByRole('button', { name: '프로젝트 삭제' }))
  const dialog = screen.getByRole('dialog', { name: '프로젝트를 삭제할까요?' })
  fireEvent.change(within(dialog).getByLabelText('확인할 프로젝트 이름'), { target: { value: project.name } })
  fireEvent.click(within(dialog).getByRole('button', { name: '프로젝트 삭제' }))
  await screen.findByText('프로젝트 목록')
  expect(router.state.location.pathname).toBe('/')
  expect(screen.queryByRole('dialog', { name: '저장하지 않은 변경이 있어요' })).toBeNull()
  expect(projectsApi.remove).toHaveBeenCalledExactlyOnceWith(project.id, project.version, project.name)
  await waitFor(() => expect(authApi.me).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('link', { name: '내 계정 가기' }))
  expect((await screen.findByRole('button', { name: '탈퇴하기' }) as HTMLButtonElement).disabled).toBe(false)
})

test('소유권 이전 뒤 계정을 갱신하고 남은 미저장 입력이 있어도 프로젝트를 나갈 수 있다', async () => {
  vi.mocked(projectsApi.transfer).mockResolvedValue({ ...project, ownerId: 'member', version: 2 })
  vi.mocked(projectsApi.removeMember).mockResolvedValue({ clientMutationId: 'mutation', membershipVersion: 2,
    eventId: 'event', tombstone: { id: 'membership', type: 'membership', deleted: true } })
  const router = mount()
  const input = await editTopic()
  fireEvent.click(screen.getByRole('button', { name: '소유자 변경' }))
  fireEvent.click(await screen.findByRole('radio', { name: '팀원' }))
  fireEvent.click(screen.getByRole('button', { name: '팀원님에게 변경' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '새 소유자를 선택하세요' })).toBeNull())
  expect(authApi.me).toHaveBeenCalledTimes(1)
  expect(input.readOnly).toBe(true)
  expect(input.value).toBe('저장하지 않은 주제')
  fireEvent.click(screen.getByRole('button', { name: '프로젝트 나가기' }))
  const dialog = await screen.findByRole('dialog', { name: '프로젝트에서 나갈까요?' })
  const leave = await within(dialog).findByRole('button', { name: '프로젝트 나가기' })
  fireEvent.click(leave)
  await screen.findByText('프로젝트 목록')
  expect(router.state.location.pathname).toBe('/')
  expect(projectsApi.removeMember).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('dialog', { name: '저장하지 않은 변경이 있어요' })).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: '내 계정 가기' }))
  expect((await screen.findByRole('button', { name: '탈퇴하기' }) as HTMLButtonElement).disabled).toBe(false)
})
