import { expect, test, vi } from 'vitest'
import { createApiClient } from '../../shared/api/client.ts'
import { createAuthApi } from './api.ts'

const user = {
  id: 'user-1', name: '정혁', email: 'test@example.test', consentVersions: {}, ownedProjectCount: 0,
  onboardingStatus: 'pending', identities: [{ provider: 'email', maskedEmail: 't***@example.test', linkedAt: '2026-11-18T00:00:00Z' }], version: 1,
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

test('로그인 후 교체된 세션의 CSRF 토큰으로 동의와 프로필을 저장한다', async () => {
  let authenticated = false
  const fetcher = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    if (url.endsWith('/auth/bootstrap')) return json(200, { status: authenticated ? 'authenticated' : 'anonymous', csrfToken: authenticated ? 'new-token' : 'old-token', expiresAt: '2026-11-19T00:00:00Z' })
    if (url.endsWith('/auth/sessions')) { authenticated = true; return json(201, { user, needsOnboarding: true }) }
    if (url.endsWith('/me')) return json(200, { ...user, onboardingStatus: 'completed', version: 2 })
    throw new Error(`예상하지 않은 요청 ${url} ${init.method}`)
  })
  const service = createAuthApi(createApiClient(fetcher))
  await service.login('challenge-1', '123456')
  await service.update('정혁', 1, { terms: '1', privacy: '1' })
  const login = fetcher.mock.calls.find(([input]) => String(input).endsWith('/auth/sessions'))!
  expect(login[1]!.headers).toMatchObject({ 'X-CSRF-Token': 'old-token' })
  const profile = fetcher.mock.calls.find(([input]) => String(input).endsWith('/me'))!
  expect(profile[1]!.headers).toMatchObject({ 'X-CSRF-Token': 'new-token' })
  expect(JSON.parse(String(profile[1]!.body))).toEqual({ name: '정혁', version: 1, consentVersions: { terms: '1', privacy: '1' } })
})

test('로그아웃한 뒤 새 익명 세션의 CSRF 토큰으로 다음 인증을 요청한다', async () => {
  let loggedOut = false
  const fetcher = vi.fn(async (input: RequestInfo | URL, _init: RequestInit = {}) => {
    const url = String(input)
    if (url.endsWith('/auth/bootstrap')) return json(200, { status: loggedOut ? 'anonymous' : 'authenticated', csrfToken: loggedOut ? 'anonymous-token' : 'user-token', expiresAt: '2026-11-19T00:00:00Z' })
    if (url.endsWith('/auth/session')) { loggedOut = true; return new Response(null, { status: 204 }) }
    return json(202, { challengeId: 'c', expiresAt: '2026-11-19T00:00:00Z', retryAfter: 60 })
  })
  const service = createAuthApi(createApiClient(fetcher))
  await service.logout()
  await service.challenge('test@example.test', 'login')
  const request = fetcher.mock.calls.find(([input]) => String(input).endsWith('/auth/challenges'))!
  expect(request[1]!.headers).toMatchObject({ 'X-CSRF-Token': 'anonymous-token' })
})

test('잘못된 코드 응답을 성공으로 해석하거나 세션을 새로 읽지 않는다', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/auth/bootstrap')
    ? json(200, { status: 'anonymous', csrfToken: 'token', expiresAt: '2026-11-19T00:00:00Z' })
    : json(422, { error: { code: 'INVALID_CODE', message: '인증 코드를 확인해 주세요', retryable: false }, requestId: 'request-1' }))
  const service = createAuthApi(createApiClient(fetcher))
  await expect(service.login('challenge-1', '000000')).rejects.toMatchObject({ code: 'INVALID_CODE', requestId: 'request-1' })
  expect(fetcher.mock.calls.filter(([input]) => String(input).endsWith('/auth/bootstrap'))).toHaveLength(1)
})
