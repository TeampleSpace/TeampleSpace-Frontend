// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { ApiError, TransportError } from '../../shared/api/client.ts'
import { designApi } from './api.ts'
import type { DesignSettings } from './api.ts'
import DesignPage from './DesignPage.tsx'

vi.mock('./api.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('./api.ts')>(),
  designApi: { catalog: vi.fn(), get: vi.fn(), save: vi.fn() },
}))

const initial: DesignSettings = { version: 1, mode: 'unset', templateId: null, templateVersion: null, custom: null, updatedAt: '2026-11-20T00:00:00Z' }
const template = {
  id: 'ec85bac3-878f-4b5f-b4bc-5f0bc8c00001', version: 1, name: '클린 리포트',
  preview: { backgroundColor: '#FFFFFF', headingColor: '#212735', description: '흰 배경과 차분한 제목' },
  fonts: ['Pretendard'], layouts: ['title'],
}
const storedTemplate: DesignSettings = { ...initial, mode: 'template', version: 2, templateId: template.id, templateVersion: template.version }

function mount() {
  const router = createMemoryRouter([{ path: '/', element: <DesignPage projectId="project" projectName="팀 과제" /> }])
  render(<RouterProvider router={router} />)
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(designApi.catalog).mockResolvedValue({ items: [template], allowedFonts: ['Pretendard'] })
  vi.mocked(designApi.get).mockResolvedValue(initial)
})

afterEach(cleanup)

test('디자인 입력을 전환해도 두 초안을 유지하고 활성 방식만 저장한다', async () => {
  mount()
  fireEvent.click(await screen.findByRole('button', { name: '클린 리포트 선택' }))
  fireEvent.click(screen.getByRole('button', { name: '직접 입력' }))
  fireEvent.change(screen.getByLabelText('템플릿 이름'), { target: { value: '팀 디자인' } })
  fireEvent.change(screen.getByLabelText('대표 색상'), { target: { value: '#xzzzzz' } })
  fireEvent.click(screen.getByRole('button', { name: '디자인 저장' }))
  const dialog = await screen.findByRole('dialog', { name: '디자인 설정을 확인해 주세요' })
  expect(designApi.save).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: '설정으로 돌아가기' }))
  fireEvent.click(screen.getByRole('button', { name: '템플릿 선택' }))
  expect(screen.getByRole('button', { name: '클린 리포트 선택됨' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: '직접 입력' }))
  expect((screen.getByLabelText('템플릿 이름') as HTMLInputElement).value).toBe('팀 디자인')
  expect((screen.getByLabelText('대표 색상') as HTMLInputElement).value).toBe('#xzzzzz')
  fireEvent.change(screen.getByLabelText('대표 색상'), { target: { value: '#aabbcc' } })
  const custom = { name: '팀 디자인', font: 'Pretendard', primaryColor: '#AABBCC', guidelines: '' }
  vi.mocked(designApi.save).mockResolvedValue({ ...initial, mode: 'custom', custom, version: 2 })
  fireEvent.click(screen.getByRole('button', { name: '디자인 저장' }))
  await screen.findByText('디자인을 저장했어요')
  expect(designApi.save).toHaveBeenCalledExactlyOnceWith('project', { expectedVersion: 1, mode: 'custom', custom }, expect.any(String), expect.any(AbortSignal))
})

test('응답이 끊기면 같은 저장 요청을 재시도하고 충돌은 확인 뒤에 새 버전으로 저장한다', async () => {
  const save = vi.mocked(designApi.save)
  save.mockRejectedValueOnce(new TransportError('timeout'))
  save.mockRejectedValueOnce(new ApiError(409, {
    error: { code: 'VERSION_CONFLICT', message: '버전 충돌', retryable: false, currentVersions: { designVersion: 2 } }, requestId: 'request',
  }))
  save.mockResolvedValueOnce({ ...storedTemplate, version: 3 })
  vi.mocked(designApi.get).mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial, version: 2 })
  mount()
  fireEvent.click(await screen.findByRole('button', { name: '클린 리포트 선택' }))
  fireEvent.click(screen.getByRole('button', { name: '디자인 저장' }))
  fireEvent.click(await screen.findByRole('button', { name: '저장 다시 시도' }))
  fireEvent.click(await screen.findByRole('button', { name: '최신 디자인 확인' }))
  fireEvent.click(await screen.findByRole('button', { name: '내 입력 유지하기' }))
  expect(screen.getByRole('button', { name: '클린 리포트 선택됨' }).getAttribute('aria-pressed')).toBe('true')
  expect(save).toHaveBeenCalledTimes(2)
  expect(save.mock.calls[1][1]).toEqual(save.mock.calls[0][1])
  expect(save.mock.calls[1][2]).toBe(save.mock.calls[0][2])
  fireEvent.click(screen.getByRole('button', { name: '디자인 저장' }))
  await screen.findByText('디자인을 저장했어요')
  expect(save.mock.calls[2][1].expectedVersion).toBe(2)
  expect(save.mock.calls[2][2]).not.toBe(save.mock.calls[0][2])
})
