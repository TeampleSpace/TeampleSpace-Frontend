// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import bootstrap from '../../contracts/examples/auth-bootstrap-authenticated.json'
import anonymous from '../../contracts/examples/auth-bootstrap-anonymous.json'
import challenge from '../../contracts/examples/auth-challenge-response.json'
import user from '../../contracts/examples/auth-user.json'
import capabilities from '../../contracts/examples/capabilities.json'
import projects from '../../contracts/examples/project-list.json'
import { oauthUrl } from '../features/auth/model.ts'
import { setBillingPreviewReturn, takeBillingPreviewReturn } from '../features/auth/billingPreviewReturn.ts'
import { router } from './router.tsx'

function open(path: string, authenticated = true, currentUser = user) {
  let signedIn = authenticated
  const authProviders = capabilities.authProviders.map((provider) => (
    provider.provider === 'email' ? { ...provider, enabled: true } : provider
  ))
  const request = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), window.location.origin)
    if (url.pathname === '/v1/auth/bootstrap') return Response.json(signedIn ? bootstrap : anonymous)
    if (url.pathname === '/v1/capabilities') return Response.json({ ...capabilities, authProviders })
    if (url.pathname === '/v1/auth/challenges') {
      return Response.json({ ...challenge, expiresAt: new Date(Date.now() + 60_000).toISOString() })
    }
    if (url.pathname === '/v1/auth/sessions') {
      signedIn = true
      return Response.json({ user, needsOnboarding: false })
    }
    if (url.pathname === '/v1/me') return Response.json(currentUser)
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
  sessionStorage.clear()
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

test('미리보기 주소로 방문하면 이메일 로그인 후 원래 화면을 열고 쿼리는 넘기지 않는다', async () => {
  const path = '/account/subscription/preview/interrupted'
  const { preview } = open(path + '?status=succeeded', false)
  fireEvent.change(await screen.findByLabelText('이메일'), { target: { value: user.email } })
  expect(new URLSearchParams(preview.state.location.search).get('returnTo')).toBe(path)
  fireEvent.click(screen.getByRole('button', { name: '인증 코드 받기' }))
  fireEvent.change(await screen.findByLabelText('인증 코드'), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: '로그인' }))
  await screen.findByRole('heading', { name: '결제 중단', level: 1 })
  expect(preview.state.location.pathname).toBe(path)
})

test('소셜 로그인은 서버에 계정 경로를 전달하고 복귀한 탭에서 미리보기로 이동한다', async () => {
  const path = '/account/subscription/preview/complete'
  setBillingPreviewReturn(path)
  const authorize = new URL(oauthUrl('kakao', 'login', path), window.location.origin)
  expect(authorize.searchParams.get('returnTo')).toBe('/account')
  const { preview } = open('/account')
  await screen.findByRole('heading', { name: '구독 완료', level: 1 })
  expect(preview.state.location.pathname).toBe(path)
  expect(takeBillingPreviewReturn()).toBeUndefined()
})

test('신규 소셜 사용자는 가입을 마친 뒤 돌아갈 미리보기 주소를 유지한다', async () => {
  const path = '/account/subscription/preview/complete'
  setBillingPreviewReturn(path)
  const { preview } = open('/onboarding?returnTo=%2Faccount', true, { ...user, onboardingStatus: 'pending' })
  await screen.findByRole('heading', { name: '어떻게 불러드릴까요?' })
  await waitFor(() => expect(new URLSearchParams(preview.state.location.search).get('returnTo')).toBe(path))
  expect(takeBillingPreviewReturn()).toBeUndefined()
})
