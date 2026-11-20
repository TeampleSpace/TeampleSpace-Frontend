// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import bootstrap from '../../contracts/examples/auth-bootstrap-authenticated.json'
import user from '../../contracts/examples/auth-user.json'
import capabilities from '../../contracts/examples/capabilities.json'
import projects from '../../contracts/examples/project-list.json'
import { router } from './router.tsx'

function open(path: string) {
  const request = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), window.location.origin)
    if (url.pathname === '/v1/auth/bootstrap') return Response.json(bootstrap)
    if (url.pathname === '/v1/capabilities') return Response.json(capabilities)
    if (url.pathname === '/v1/me') return Response.json(user)
    if (url.pathname === '/v1/projects') return Response.json(projects)
    return new Response(null, { status: 404 })
  })
  vi.stubGlobal('fetch', request)
  const preview = createMemoryRouter(router.routes, { initialEntries: [path] })
  render(<RouterProvider router={preview} />)
  return { preview, request }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('내 계정에서 구독 요금 안내와 관리로 이동하고 구매는 실행할 수 없다', async () => {
  const { preview, request } = open('/account')
  const subscription = await screen.findByRole('region', { name: '구독 및 결제' })
  fireEvent.click(within(subscription).getByRole('link', { name: '요금제 보기' }))
  await screen.findByRole('heading', { name: '개인 월 구독', level: 1 })
  expect(preview.state.location.pathname).toBe('/account/subscription')
  expect(screen.getByText(user.email)).toBeTruthy()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '요금 안내 준비 중' }).disabled).toBe(true)

  fireEvent.click(screen.getByRole('link', { name: '구독 및 결제 관리' }))
  await screen.findByRole('heading', { name: '구독 및 결제 관리', level: 1 })
  expect(preview.state.location.pathname).toBe('/account/subscription/manage')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '자동 갱신 관리' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('link', { name: '요금제 보기' }))
  await screen.findByRole('heading', { name: '개인 월 구독', level: 1 })
  expect(request.mock.calls.some(([url]) => String(url).startsWith('/v1/billing/'))).toBe(false)
})

test('결제 복귀 주소의 성공 값으로 구독 완료를 표시하지 않는다', async () => {
  const { preview } = open('/billing/return?status=succeeded&sessionId=example')
  await screen.findByRole('heading', { name: '결제 결과를 확인할 수 없어요' })
  expect(screen.queryByText('개인 구독이 시작됐어요')).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: '결제 페이지로 돌아가기' }))
  await screen.findByRole('heading', { name: '개인 월 구독', level: 1 })
  expect(preview.state.location.pathname).toBe('/account/subscription')
})

test('결제 없이 구독 완료와 결제 중단 미리보기를 열고 돌아올 수 있다', async () => {
  const { preview, request } = open('/account/subscription')
  fireEvent.click(await screen.findByRole('link', { name: '구독 완료 미리보기' }))
  await screen.findByRole('heading', { name: '개인 구독이 시작됐어요' })
  expect(screen.getByText('개발용 미리보기')).toBeTruthy()
  expect(preview.state.location.pathname).toBe('/account/subscription/preview/complete')
  expect(screen.getByRole('link', { name: '프로젝트로 돌아가기' }).getAttribute('href')).toBe('/')

  fireEvent.click(screen.getByRole('link', { name: '구독 관리' }))
  await screen.findByRole('heading', { name: '구독 및 결제 관리', level: 1 })
  fireEvent.click(screen.getByRole('link', { name: '요금제 보기' }))
  fireEvent.click(await screen.findByRole('link', { name: '결제 중단 미리보기' }))
  await screen.findByRole('heading', { name: '결제가 완료되지 않았어요' })
  expect(screen.getByText('개발용 미리보기')).toBeTruthy()
  expect(preview.state.location.pathname).toBe('/account/subscription/preview/interrupted')

  fireEvent.click(screen.getByRole('link', { name: '결제 페이지로 돌아가기' }))
  await screen.findByRole('heading', { name: '개인 월 구독', level: 1 })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '요금 안내 준비 중' }).disabled).toBe(true)
  expect(request.mock.calls.some(([url]) => String(url).startsWith('/v1/billing/'))).toBe(false)
})
