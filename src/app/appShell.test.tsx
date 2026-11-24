// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import AppShell from './AppShell.tsx'
import { projectsApi } from '../entities/project/api.ts'

vi.mock('../entities/project/api.ts', () => ({ projectsApi: { list: vi.fn() } }))
vi.mock('../features/requests/ui/RequestBanner.tsx', () => ({ RequestBanner: () => null }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function mount(narrow: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches: narrow, addEventListener() {}, removeEventListener() {} }))
  vi.mocked(projectsApi.list).mockResolvedValue({ items: [], nextCursor: null })
  const router = createMemoryRouter([{ element: <AppShell />, children: [{ path: '/', element: <h1>홈 본문</h1> }, { path: '/account', element: <h1>계정 본문</h1> }] }])
  render(<RouterProvider router={router} />)
}

test('좁은 화면은 메뉴 서랍을 열고 Esc와 화면 이동으로 닫는다', async () => {
  mount(true)
  const open = screen.getByRole('button', { name: '메뉴 열기' })
  expect(screen.queryByRole('navigation', { name: '주 메뉴' })).toBeNull()
  fireEvent.click(open)
  expect(open.getAttribute('aria-expanded')).toBe('true')
  const close = screen.getByRole('button', { name: '메뉴 닫기' })
  await waitFor(() => expect(document.activeElement).toBe(close))
  expect(screen.getByRole('heading', { name: '홈 본문' }).closest('[inert]')).toBeTruthy()
  fireEvent.keyDown(close, { key: 'Escape' })
  expect(screen.queryByRole('navigation', { name: '주 메뉴' })).toBeNull()
  await waitFor(() => expect(document.activeElement).toBe(open))
  fireEvent.click(open)
  fireEvent.click(screen.getByRole('link', { name: '내 계정' }))
  await screen.findByRole('heading', { name: '계정 본문' })
  expect(screen.queryByRole('navigation', { name: '주 메뉴' })).toBeNull()
})

test('넓은 화면은 상단 막대 없이 사이드바 접기를 유지한다', () => {
  mount(false)
  expect(screen.queryByRole('button', { name: '메뉴 열기' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '메뉴 접기' }))
  expect(screen.getByRole('button', { name: '메뉴 펼치기' })).toBeTruthy()
})
