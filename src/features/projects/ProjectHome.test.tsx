// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import ProjectHome from './ProjectHome.tsx'
import AppShell from '../../app/AppShell.tsx'
import { SessionContext } from '../auth/sessionContext.ts'
import { projectsApi } from './api.ts'
import type { Project } from './model.ts'

vi.mock('./api.ts', () => ({ projectsApi: { list: vi.fn() } }))
const project: Project = { id: 'project-1', name: '팀 발표', topic: null, presentationConstraints: null,
  ownerId: 'owner', version: 1, memberCount: 2, createdAt: '2026-11-19T00:00:00Z', updatedAt: '2026-11-19T00:00:00Z' }
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(() => { cleanup(); vi.resetAllMocks() })
function mount(path = '/', shell = false) {
  const routes = shell ? [{ element: <AppShell />, children: [{ path: '/', element: <ProjectHome /> }] }] : [{ path: '/', element: <ProjectHome /> }]
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<SessionContext value={{ user: null, capabilities: null, loading: false, error: undefined, refresh: async () => null, setUser: () => {} }}><RouterProvider router={router} /></SessionContext>)
  return router
}
test('첫 방문에는 시작 카드와 준비 중 안내가 표시되고 생성 모달을 연다', async () => {
  vi.mocked(projectsApi.list).mockResolvedValue({ items: [], nextCursor: null })
  mount()
  await screen.findByText('함께할 팀플, 여기서 시작해요.')
  expect(screen.getByText('초대받은 프로젝트 참여하기')).toBeTruthy()
  expect(screen.getAllByText('준비 중')).toHaveLength(3)
  fireEvent.click(screen.getByRole('button', { name: '프로젝트 만들기' }))
  expect(await screen.findByRole('dialog', { name: '새 프로젝트' })).toBeTruthy()
})
test('검색 중 기존 카드와 입력 포커스를 유지하고 결과 없음 상태로 전환한다', async () => {
  let finish!: (value: { items: Project[]; nextCursor: null }) => void
  vi.mocked(projectsApi.list).mockResolvedValueOnce({ items: [project], nextCursor: null })
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    .mockResolvedValue({ items: [project], nextCursor: null })
  mount('/?search=1')
  await screen.findByRole('link', { name: '팀 발표' })
  const search = screen.getByRole('searchbox', { name: '프로젝트 검색' })
  search.focus()
  fireEvent.change(search, { target: { value: '없는 프로젝트' } })
  await waitFor(() => expect(projectsApi.list).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('link', { name: '팀 발표' })).toBeTruthy()
  expect(document.activeElement).toBe(search)
  finish({ items: [], nextCursor: null })
  await screen.findByText('검색 결과가 없습니다.')
  expect(screen.queryByRole('link', { name: '팀 발표' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '검색 지우기' }))
  expect((search as HTMLInputElement).value).toBe('')
})
test('홈에서도 프로젝트 목록과 팀 관리 및 설정에 접근할 수 있다', async () => {
  vi.mocked(projectsApi.list).mockResolvedValue({ items: [project], nextCursor: null })
  mount('/', true)
  await screen.findByRole('navigation', { name: '내 프로젝트' })
  expect(screen.getByRole('navigation', { name: '프로젝트 관리' })).toBeTruthy()
  expect(screen.getAllByRole('link', { name: '팀원 관리' })[0]?.getAttribute('href')).toBe('/projects/project-1?team=1')
  expect(screen.queryByRole('link', { name: '자료' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '팀 발표 메뉴' }))
  expect(screen.queryByRole('link', { name: '프로젝트 개요' })).toBeNull()
})
