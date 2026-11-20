// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TeamDialog } from './TeamDialog.tsx'
import { allMembers, projectsApi } from '../../../entities/project/api.ts'
import { SessionContext } from '../../../entities/session/sessionContext.ts'
import type { Project } from '../../../entities/project/model.ts'
import type { User } from '../../../entities/session/model.ts'

vi.mock('../../../entities/project/api.ts', () => ({ allMembers: vi.fn(), projectsApi: { invite: vi.fn() } }))
const project: Project = { id: 'project', name: '팀 과제', ownerId: 'owner', topic: null, presentationConstraints: null,
  version: 1, memberCount: 1, createdAt: '', updatedAt: '' }
const user: User = { id: 'owner', name: '소유자', email: null, canEmailReauth: false, consentVersions: {},
  ownedProjectCount: 1, onboardingStatus: 'completed', identities: [], version: 1 }
const accessError = vi.fn()
const close = vi.fn()
const session = { user, capabilities: null, loading: false, error: undefined, refresh: async () => user, setUser: () => {} }
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(() => { cleanup(); vi.resetAllMocks() })
function dialog(open = true) {
  return <SessionContext value={session}><TeamDialog open={open} project={project} initialView="members" onClose={close}
    onChange={async () => {}} onExit={() => {}} onAccessError={accessError} /></SessionContext>
}
test('복사 실패 안내와 링크 재발급을 유지하고 다시 열 때 팀 목록으로 돌아온다', async () => {
  vi.mocked(allMembers).mockResolvedValue([{ userId: 'owner', name: '소유자', role: 'owner', isOwner: true, membershipVersion: 1 }])
  vi.mocked(projectsApi.invite).mockResolvedValueOnce({ url: 'https://example.test/invite/first', expiresAt: '2026-11-20T00:00:00Z' })
    .mockResolvedValueOnce({ url: 'https://example.test/invite/second', expiresAt: '2026-11-21T00:00:00Z' })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
  const view = render(dialog())
  fireEvent.click(await screen.findByRole('button', { name: '팀원 초대' }))
  fireEvent.click(await screen.findByRole('button', { name: '초대 링크 복사' }))
  await screen.findByText('복사하지 못했어요. 위 링크를 직접 복사해 주세요.')
  expect(screen.getByRole('link', { name: 'https://example.test/invite/first' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '새 링크 발급' }))
  await screen.findByRole('link', { name: 'https://example.test/invite/second' })
  expect(projectsApi.invite).toHaveBeenLastCalledWith('project', true)
  expect(screen.queryByText('복사하지 못했어요. 위 링크를 직접 복사해 주세요.')).toBeNull()
  view.rerender(dialog(false))
  expect(screen.queryByRole('dialog')).toBeNull()
  view.rerender(dialog())
  await screen.findByRole('dialog', { name: '팀원 관리' })
  await waitFor(() => expect(allMembers).toHaveBeenCalledTimes(2))
  expect(screen.queryByRole('link', { name: 'https://example.test/invite/second' })).toBeNull()
})
