// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { ReactNode } from 'react'
import { CreateProject } from './CreateProject.tsx'
import { ProjectSettings } from './ProjectSettings.tsx'
import Invitation from './Invitation.tsx'
import { SessionContext } from '../auth/sessionContext.ts'
import type { User } from '../auth/model.ts'
import type { Project } from './model.ts'
import { projectsApi } from './api.ts'
import { ApiError, TransportError } from '../../shared/api/client.ts'

vi.mock('./api.ts', () => ({ projectsApi: { create: vi.fn(), update: vi.fn(), invitation: vi.fn(), accept: vi.fn() } }))
const project: Project = { id: 'project-1', name: '팀 과제', topic: null, presentationConstraints: null,
  ownerId: 'owner', version: 1, memberCount: 2, createdAt: '2026-11-18T00:00:00Z', updatedAt: '2026-11-18T00:00:00Z' }
const member: User = { id: 'member', name: '팀원', email: 'member@example.test', canEmailReauth: true,
  consentVersions: {}, ownedProjectCount: 0, onboardingStatus: 'completed', identities: [], version: 1 }

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

function mount(element: ReactNode, user: User | null = member, path = '/') {
  const router = createMemoryRouter([
    { path: '/invite/:token', element }, { path: '/', element },
    { path: '/projects/:projectId', element: <p>프로젝트 이동 완료</p> },
  ], { initialEntries: [path] })
  render(<SessionContext value={{ user, capabilities: null, loading: false, error: undefined,
    refresh: async () => user, setUser: () => {} }}><RouterProvider router={router} /></SessionContext>)
  return router
}

test.each([
  new TransportError('network'),
  new ApiError(500, { error: { code: 'INTERNAL_ERROR', message: '서버 오류', retryable: true }, requestId: 'request-1' }),
])('생성 결과가 불확실하면 입력을 잠그고 같은 키로 재시도한다 %s', async (error) => {
  vi.mocked(projectsApi.create).mockRejectedValueOnce(error).mockResolvedValueOnce(project)
  const close = vi.fn()
  mount(<CreateProject open onClose={close} />)
  fireEvent.change(screen.getByLabelText('프로젝트 이름'), { target: { value: '팀 과제' } })
  fireEvent.click(screen.getByRole('button', { name: '프로젝트 만들기' }))
  await screen.findByRole('button', { name: '같은 요청 다시 확인' })
  expect((screen.getByLabelText('프로젝트 이름') as HTMLInputElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '같은 요청 다시 확인' }))
  await screen.findByText('프로젝트 이동 완료')
  expect(projectsApi.create).toHaveBeenCalledTimes(2)
  expect(vi.mocked(projectsApi.create).mock.calls[1]).toEqual(vi.mocked(projectsApi.create).mock.calls[0])
  expect(close).toHaveBeenCalledTimes(1)
})

test('초대를 연 것만으로 참여하지 않고 사용자 확인 뒤 참여한다', async () => {
  vi.mocked(projectsApi.invitation).mockResolvedValue({ projectName: '팀 과제', inviterName: '소유자', expiresAt: '2026-11-19T00:00:00Z', alreadyMember: false })
  vi.mocked(projectsApi.accept).mockResolvedValue({ projectId: project.id, alreadyMember: false })
  mount(<Invitation />, member, '/invite/valid-invitation-token')
  const button = await screen.findByRole('button', { name: '프로젝트 참여' })
  expect(projectsApi.accept).not.toHaveBeenCalled()
  fireEvent.click(button)
  await screen.findByText('프로젝트 이동 완료')
  expect(projectsApi.accept).toHaveBeenCalledExactlyOnceWith('valid-invitation-token')
})

test('익명 초대 사용자의 로그인 링크에 초대 복귀 경로를 유지한다', async () => {
  vi.mocked(projectsApi.invitation).mockResolvedValue({ projectName: '팀 과제', inviterName: '소유자', expiresAt: '2026-11-19T00:00:00Z', alreadyMember: false })
  mount(<Invitation />, null, '/invite/valid-invitation-token')
  const link = await screen.findByRole('link', { name: '로그인하고 초대 확인' })
  expect(link.getAttribute('href')).toBe('/login?returnTo=%2Finvite%2Fvalid-invitation-token')
  expect(projectsApi.accept).not.toHaveBeenCalled()
})

test('일반 팀원은 설정을 읽을 수 있지만 저장과 소유자 관리 동작은 없다', async () => {
  mount(<ProjectSettings project={project} onChange={async () => {}} onOpen={() => {}} onError={() => {}} leaving={false} />)
  await waitFor(() => expect(screen.getByText('기본 정보는 프로젝트 소유자가 변경할 수 있어요')).toBeTruthy())
  expect((screen.getByLabelText('프로젝트 이름') as HTMLTextAreaElement).readOnly).toBe(true)
  expect(screen.queryByRole('button', { name: '저장' })).toBeNull()
  expect(screen.queryByRole('button', { name: '프로젝트 삭제' })).toBeNull()
  expect(screen.queryByRole('button', { name: '소유자 변경' })).toBeNull()
  expect(screen.getByRole('button', { name: '프로젝트 나가기' })).toBeTruthy()
})
