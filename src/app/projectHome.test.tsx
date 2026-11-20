// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import ProjectHome from '../features/projects/ui/ProjectHome.tsx'
import AppShell from './AppShell.tsx'
import { SessionContext } from '../entities/session/sessionContext.ts'
import { projectsApi } from '../entities/project/api.ts'
import type { Project } from '../entities/project/model.ts'

vi.mock('../entities/project/api.ts', () => ({ projectsApi: { list: vi.fn() } }))
const project: Project = { id: 'project-1', name: '팀 발표', topic: null, presentationConstraints: null,
  ownerId: 'owner', version: 1, memberCount: 2, createdAt: '2026-11-19T00:00:00Z', updatedAt: '2026-11-19T00:00:00Z' }
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(() => { cleanup(); vi.resetAllMocks() })
function mount(path = '/', shell = false) {
  const routes = shell ? [{ element: <AppShell />, children: [{ path: '/', element: <ProjectHome /> }, { path: '/account', element: <h1>계정 정보</h1> }] }] : [{ path: '/', element: <ProjectHome /> }]
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<SessionContext value={{ user: null, capabilities: null, loading: false, error: undefined, refresh: async () => null, setUser: () => {} }}><RouterProvider router={router} /></SessionContext>)
  return router
}
test('첫 방문에는 사용할 수 있는 기능을 안내하고 생성 모달을 연다', async () => {
  vi.mocked(projectsApi.list).mockResolvedValue({ items: [], nextCursor: null })
  mount()
  await screen.findByRole('heading', { name: '팀 프로젝트 시작하기' })
  expect(screen.getByRole('heading', { name: '초대받은 프로젝트' })).toBeTruthy()
  expect(screen.getByText('자료 추가')).toBeTruthy()
  expect(screen.queryByText('준비 중')).toBeNull()
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
  expect(screen.getByRole('link', { name: '자료' }).getAttribute('href')).toBe('/projects/project-1/materials')
  const toggle = screen.getByRole('button', { name: '팀 발표 메뉴' })
  toggle.focus()
  fireEvent.click(toggle)
  expect(screen.queryByRole('link', { name: '프로젝트 개요' })).toBeNull()
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(toggle)
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByRole('link', { name: '자료' })).toBeTruthy()
})

test('추가 페이지의 프로젝트를 열고 설정으로 이동해도 탐색 목록을 유지한다', async () => {
  const first = Array.from({ length: 20 }, (_, index) => ({ ...project, id: `first-${index}`, name: `프로젝트 ${index}` }))
  const extra = { ...project, id: 'extra', name: '추가 페이지 프로젝트' }
  vi.mocked(projectsApi.list).mockImplementation(async (_query, cursor) => cursor
    ? { items: [extra], nextCursor: null } : { items: first, nextCursor: 'second-page' })
  const router = createMemoryRouter([{ element: <AppShell />, children: [
    { path: '/', element: <p>홈</p> }, { path: '/projects/:id', element: <p>개요</p> },
    { path: '/projects/:id/settings', element: <p>설정</p> },
  ] }])
  render(<RouterProvider router={router} />)
  fireEvent.click(await screen.findByRole('button', { name: '프로젝트 더 보기' }))
  fireEvent.click(await screen.findByRole('link', { name: extra.name }))
  await screen.findByText('개요')
  await waitFor(() => expect(projectsApi.list).toHaveBeenCalledTimes(4))
  expect(screen.getByRole('link', { name: extra.name })).toBeTruthy()
  await act(() => router.navigate('/projects/extra/settings'))
  await waitFor(() => expect(projectsApi.list).toHaveBeenCalledTimes(6))
  expect(screen.getByRole('link', { name: extra.name })).toBeTruthy()
})

test('내 계정에서는 프로젝트 메뉴를 숨기고 홈에 돌아오면 탐색을 복원한다', async () => {
  vi.mocked(projectsApi.list).mockResolvedValue({ items: [project], nextCursor: null })
  const router = mount('/', true)
  await screen.findByRole('navigation', { name: '내 프로젝트' })
  fireEvent.click(screen.getByRole('link', { name: '내 계정' }))
  await screen.findByRole('heading', { name: '계정 정보' })
  expect(screen.queryByRole('navigation', { name: '내 프로젝트' })).toBeNull()
  expect(screen.queryByRole('navigation', { name: '프로젝트 관리' })).toBeNull()
  expect(screen.getByRole('link', { name: '내 계정' }).getAttribute('aria-current')).toBe('page')
  await act(() => router.navigate('/'))
  await screen.findByRole('navigation', { name: '내 프로젝트' })
  expect(screen.getByRole('navigation', { name: '프로젝트 관리' })).toBeTruthy()
})
