import { expect, test } from 'vitest'
import { authCapabilitiesSchema, authDestination, oauthUrl, requiredDocuments, safeReturnTo } from './model.ts'

test('로그인 복귀는 허용한 내부 화면만 사용한다', () => {
  for (const value of ['https://evil.example', '//evil.example', '/\\evil.example', '/login?returnTo=//evil.example', '/projects/../../evil', '/account/identities/confirm', '/\n/evil.example']) {
    expect(safeReturnTo(value)).toBe('/')
  }
  expect(safeReturnTo('/invite/token?from=team')).toBe('/invite/token?from=team')
  expect(safeReturnTo('/projects/p/settings')).toBe('/projects/p/settings')
  expect(safeReturnTo('/account')).toBe('/account')
})

test('소셜 로그인도 검증한 복귀 경로만 서버에 전달한다', () => {
  const url = oauthUrl('google', 'login', '//evil.example')
  expect(url).toBe('/v1/auth/oauth/google/authorize?purpose=login&returnTo=%2F')
})

test('소셜 신규 가입의 온보딩 이동에도 원래 초대와 계정 목적지를 유지한다', () => {
  expect(authDestination(true, '/invite/valid-invitation-token')).toBe('/onboarding?returnTo=%2Finvite%2Fvalid-invitation-token')
  expect(authDestination(true, '/account')).toBe('/onboarding?returnTo=%2Faccount')
  expect(authDestination(false, '/account')).toBe('/account')
  expect(authDestination(true, '//evil.example')).toBe('/onboarding?returnTo=%2F')
})

const config = authCapabilitiesSchema.parse({
  configVersion: '1', policyRevision: '1', uploadTypes: [], formats: [], fonts: [], featureFlags: {},
  legalDocuments: [], idempotencyRetentionSeconds: 86400, listLimit: { default: 20, max: 100 }, authProviders: [],
})

test('필수 약관 두 개의 실제 주소와 버전이 있어야 동의할 수 있다', () => {
  expect(requiredDocuments(config)).toEqual([])
  const terms = { type: 'terms', version: '1', url: 'https://example.test/terms' }
  const privacy = { type: 'privacy', version: '1', url: 'https://example.test/privacy' }
  expect(requiredDocuments({ ...config, legalDocuments: [terms] })).toEqual([])
  expect(requiredDocuments({ ...config, legalDocuments: [terms, { ...privacy, version: '' }] })).toEqual([])
  expect(requiredDocuments({ ...config, legalDocuments: [terms, { ...privacy, url: 'javascript:alert(1)' }] })).toEqual([])
  expect(requiredDocuments({ ...config, legalDocuments: [terms, privacy] })).toEqual([terms, privacy])
})
