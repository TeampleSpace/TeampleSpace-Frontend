import { expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import AuthResult from './AuthResult.tsx'
import { SessionContext } from '../../../entities/session/sessionContext.ts'
import type { User } from '../../../entities/session/model.ts'

const user: User = {
  id: 'user-1', name: '팀원', email: 'test@example.test', canEmailReauth: true,
  consentVersions: {}, ownedProjectCount: 0, onboardingStatus: 'completed', identities: [], version: 1,
}

function render(code: string, currentUser: User | null) {
  return renderToStaticMarkup(<MemoryRouter initialEntries={[
    `/auth/error?${new URLSearchParams({ code, returnTo: '/invite/valid-invitation-token' })}`,
  ]}><SessionContext value={{ user: currentUser, capabilities: null, loading: false, error: undefined,
    refresh: async () => currentUser, setUser: () => {} }}><AuthResult /></SessionContext></MemoryRouter>)
}

test('로그인된 사용자의 제공자 오류도 화면에 표시한다', () => {
  const html = render('IDENTITY_CONFLICT', user)
  expect(html).toContain('같은 이메일로 가입한 계정이 있어요')
  expect(html).toContain('내 계정으로 돌아가기')
  expect(html).toContain('returnTo=%2Finvite%2Fvalid-invitation-token')
})

test('재인증 실패와 취소는 성공 화면으로 이동시키지 않는다', () => {
  expect(render('REAUTH_REQUIRED', user)).toContain('본인 확인을 마치지 못했어요')
  expect(render('OAUTH_CANCELED', user)).toContain('로그인을 취소했어요')
})

test('익명 사용자는 제공자 오류를 보고 원래 초대 경로로 다시 로그인할 수 있다', () => {
  const html = render('IDENTITY_CONFLICT', null)
  expect(html).toContain('같은 이메일로 가입한 계정이 있어요')
  expect(html).not.toContain('내 계정으로 돌아가기')
  expect(html).toContain('returnTo=%2Finvite%2Fvalid-invitation-token')
})
