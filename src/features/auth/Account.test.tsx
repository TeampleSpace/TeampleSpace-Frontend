// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import Account from './Account.tsx'
import { SessionContext } from './sessionContext.ts'
import { authCapabilitiesSchema } from './model.ts'
import type { User } from './model.ts'

const user: User = { id: 'member', name: '팀원', email: 'member@example.test', canEmailReauth: true,
  consentVersions: {}, ownedProjectCount: 0, onboardingStatus: 'completed', version: 1,
  identities: [{ provider: 'kakao', maskedEmail: 'm***@example.test', linkedAt: '2026-11-18T00:00:00Z' }] }

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(cleanup)

function openDeletion(email: boolean, kakao: boolean) {
  const capabilities = authCapabilitiesSchema.parse({ configVersion: '1', policyRevision: '1', uploadTypes: [], formats: [], fonts: [], featureFlags: {},
    legalDocuments: [], idempotencyRetentionSeconds: 86400, listLimit: { default: 20, max: 100 },
    authProviders: [{ provider: 'email', enabled: email, reauthEnabled: email }, { provider: 'kakao', enabled: kakao, reauthEnabled: kakao }] })
  const router = createMemoryRouter([{ path: '/account', element: <Account /> }], { initialEntries: ['/account'] })
  render(<SessionContext value={{ user, capabilities, loading: false, error: undefined,
    refresh: async () => user, setUser: () => {} }}><RouterProvider router={router} /></SessionContext>)
  fireEvent.click(screen.getByRole('button', { name: '탈퇴하기' }))
}

test('검증된 이메일이 있어도 메일 기능이 꺼지면 연결된 소셜 재인증을 제공한다', () => {
  openDeletion(false, true)
  expect((screen.getByRole('button', { name: '카카오로 본인 확인' }) as HTMLButtonElement).disabled).toBe(false)
  expect(screen.queryByRole('button', { name: '본인 확인 코드 받기' })).toBeNull()
  expect(screen.getByText('이메일 본인 확인을 준비 중이에요')).toBeTruthy()
})

test('이메일과 소셜을 모두 사용할 수 있으면 두 방법을 선택할 수 있다', () => {
  openDeletion(true, true)
  expect((screen.getByRole('button', { name: '카카오로 본인 확인' }) as HTMLButtonElement).disabled).toBe(false)
  expect((screen.getByRole('button', { name: '본인 확인 코드 받기' }) as HTMLButtonElement).disabled).toBe(false)
})

test('활성화된 재인증 수단이 없으면 불가능한 인증 버튼을 제시하지 않는다', () => {
  openDeletion(false, false)
  expect(screen.queryByRole('button', { name: '카카오로 본인 확인' })).toBeNull()
  expect(screen.queryByRole('button', { name: '본인 확인 코드 받기' })).toBeNull()
  expect(screen.getByText('현재 사용할 수 있는 본인 확인 수단이 없어요. 계정 지원 담당자에게 문의해 주세요')).toBeTruthy()
})
