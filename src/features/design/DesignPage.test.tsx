// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { ApiError, TransportError } from '../../shared/api/client.ts'
import { designApi } from './api.ts'
import type { DesignSettings } from './api.ts'
import DesignPage from './DesignPage.tsx'
import { fontsApi } from './fontsApi.ts'
import type { ProjectFont } from './fontsApi.ts'

vi.mock('./api.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('./api.ts')>(),
  designApi: { catalog: vi.fn(), get: vi.fn(), save: vi.fn() },
}))

vi.mock('./fontsApi.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('./fontsApi.ts')>(),
  fontsApi: { list: vi.fn(), upload: vi.fn(), content: vi.fn() },
}))

const initial: DesignSettings = { version: 1, mode: 'unset', templateId: null, templateVersion: null, custom: null, updatedAt: '2026-11-20T00:00:00Z' }
const template = {
  id: 'ec85bac3-878f-4b5f-b4bc-5f0bc8c00001', key: 'clean-report', version: 1, name: '클린 리포트',
  preview: { backgroundColor: '#FFFFFF', headingColor: '#212735', description: '흰 배경과 차분한 제목' },
  fonts: ['Pretendard'], layouts: ['title'],
}
const storedTemplate: DesignSettings = { ...initial, mode: 'template', version: 2, templateId: template.id, templateVersion: template.version }

function mount() {
  const router = createMemoryRouter([{ path: '/', element: <DesignPage projectId="project" projectName="팀 과제" /> }])
  return render(<RouterProvider router={router} />)
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

test('서버에서 선택한 스타일을 카드와 슬라이드 미리보기에 적용한다', async () => {
  const editorial = { ...template, id: 'ec85bac3-878f-4b5f-b4bc-5f0bc8c00003', key: 'editorial', name: '에디토리얼' }
  vi.mocked(designApi.catalog).mockResolvedValue({ items: [template, editorial], allowedFonts: ['Pretendard'] })
  const { container } = mount()
  fireEvent.click(await screen.findByRole('button', { name: '에디토리얼 선택' }))

  fireEvent.click(screen.getByRole('button', { name: '템플릿 자세히 보기' }))
  const preview = screen.getByRole('dialog', { name: '에디토리얼' })
  expect(preview.querySelector('[data-template="editorial"]')).toBeTruthy()
  expect(container.querySelector('[data-template="clean-report"]')).toBeTruthy()
})

test('검색과 분류에서 선택한 항목이 숨겨져도 저장 대상을 유지하고 검색을 초기화한다', async () => {
  const editorial = { ...template, id: 'editorial', key: 'editorial', name: '에디토리얼' }
  const unknown = { ...template, id: 'new-template', key: 'new-template', name: '새 템플릿' }
  vi.mocked(designApi.catalog).mockResolvedValue({ items: [template, editorial, unknown], allowedFonts: ['Pretendard'] })
  vi.mocked(designApi.save).mockResolvedValue(storedTemplate)
  mount()
  fireEvent.click(await screen.findByRole('button', { name: '클린 리포트 선택' }))
  fireEvent.click(screen.getByRole('button', { name: '세미나' }))
  expect(screen.queryByRole('button', { name: '클린 리포트 선택됨' })).toBeNull()
  expect(screen.getByRole('button', { name: '에디토리얼 선택' })).toBeTruthy()
  fireEvent.change(screen.getByRole('searchbox', { name: '템플릿 검색' }), { target: { value: '없는 디자인' } })
  expect(screen.getByText('조건에 맞는 템플릿이 없어요.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '디자인 저장' }))
  await waitFor(() => expect(designApi.save).toHaveBeenCalledWith('project', {
    expectedVersion: 1, mode: 'template', templateId: template.id, templateVersion: template.version,
  }, expect.any(String), expect.any(AbortSignal)))
  fireEvent.click(screen.getByRole('button', { name: '검색과 분류 초기화' }))
  expect(screen.getByRole('button', { name: '새 템플릿 선택' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '클린 리포트 선택됨' })).toBeTruthy()
})

test('템플릿 저장 오류 안내를 닫으면 갤러리로 포커스가 돌아간다', async () => {
  vi.mocked(designApi.save).mockRejectedValue(new ApiError(422, {
    error: {
      code: 'VALIDATION_FAILED', message: '템플릿 확인 필요', retryable: false,
      fieldErrors: [{ field: 'templateVersion', code: 'INVALID', message: '현재 템플릿을 다시 선택해 주세요' }],
    },
    requestId: 'request',
  }))
  mount()
  fireEvent.click(await screen.findByRole('button', { name: '클린 리포트 선택' }))
  const gallery = screen.getByRole('region', { name: '템플릿 갤러리' })
  const save = screen.getByRole('button', { name: '디자인 저장' })
  save.focus()
  fireEvent.click(save)

  const invalid = await screen.findByRole('dialog', { name: '디자인 설정을 확인해 주세요' })
  fireEvent.click(within(invalid).getByRole('button', { name: '설정으로 돌아가기' }))

  expect(document.activeElement).toBe(gallery.parentElement)
})

test('대표 색상 코드와 선택기가 같은 값을 편집하고 미리보기에 반영한다', async () => {
  mount()
  fireEvent.click(await screen.findByRole('button', { name: '직접 입력' }))
  const code = screen.getByLabelText<HTMLInputElement>('대표 색상')
  const picker = screen.getByLabelText<HTMLInputElement>('색상 선택')
  const preview = screen.getByRole('region', { name: '슬라이드 미리보기' }).querySelector<HTMLElement>('[style]')

  const forest = screen.getByRole('button', { name: '포레스트' })
  fireEvent.click(forest)
  expect(forest.getAttribute('aria-pressed')).toBe('true')
  expect(code.value).toBe('#34705C')
  expect(picker.value).toBe('#34705c')

  fireEvent.change(code, { target: { value: '#7183a0' } })
  expect(forest.getAttribute('aria-pressed')).toBe('false')
  expect(picker.value).toBe('#7183a0')
  expect(preview?.style.getPropertyValue('--slide-heading')).toBe('#7183A0')

  fireEvent.change(picker, { target: { value: '#aabbcc' } })
  expect(code.value).toBe('#AABBCC')
  expect(preview?.style.getPropertyValue('--slide-heading')).toBe('#AABBCC')
})

test('글꼴 업로드가 끝난 뒤 저장하고 기본 글꼴로 바꾸면 업로드 글꼴 ID를 지운다', async () => {
  const id = 'd0429274-32ac-4c66-9447-186e94406e0d'
  const font: ProjectFont = { id, fileName: '팀 폰트.ttf', format: 'ttf', sizeBytes: 4, contentUrl: `/v1/projects/project/design-fonts/${id}/content` }
  const custom = { name: '팀 디자인', font: 'Pretendard', primaryColor: '#2864E8', guidelines: '' }
  const saved: DesignSettings = { ...initial, mode: 'custom', version: 2, custom: { ...custom, fontAssetId: id } }
  vi.mocked(designApi.catalog).mockResolvedValue({ items: [template], allowedFonts: ['Pretendard'], projectFontsEnabled: true })
  vi.mocked(fontsApi.list).mockResolvedValue({ items: [] })
  vi.mocked(fontsApi.content).mockRejectedValue(new TransportError('network'))
  let finishUpload!: (font: ProjectFont) => void
  vi.mocked(fontsApi.upload).mockReturnValue(new Promise((resolve) => { finishUpload = resolve }))
  vi.mocked(designApi.save).mockResolvedValueOnce(saved).mockResolvedValueOnce({ ...saved, custom, version: 3 })
  const { container } = mount()
  fireEvent.click(await screen.findByRole('button', { name: '직접 입력' }))
  fireEvent.change(screen.getByLabelText('템플릿 이름'), { target: { value: custom.name } })
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: '글꼴 업로드' }).disabled).toBe(false))
  const save = screen.getByRole<HTMLButtonElement>('button', { name: '디자인 저장' })
  expect(save.disabled).toBe(false)
  fireEvent.change(screen.getByLabelText('글꼴 파일 선택'), { target: { files: [new File([new Uint8Array(4)], font.fileName)] } })
  expect(save.disabled).toBe(true)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '템플릿 선택' }).disabled).toBe(true)
  fireEvent.submit(container.querySelector('form')!)
  expect(designApi.save).not.toHaveBeenCalled()

  finishUpload(font)
  await waitFor(() => expect(save.disabled).toBe(false))
  fireEvent.click(save)
  await screen.findByText('디자인을 저장했어요')
  expect(vi.mocked(designApi.save).mock.calls[0][1]).toEqual({ expectedVersion: 1, mode: 'custom', custom: saved.custom })
  const selection = screen.getByRole<HTMLSelectElement>('combobox', { name: '폰트' })
  fireEvent.change(selection, { target: { value: 'Pretendard' } })
  expect(selection.value).toBe('Pretendard')
  fireEvent.click(save)
  await screen.findByText('디자인을 저장했어요')
  const submitted = vi.mocked(designApi.save).mock.calls[1][1]
  expect(JSON.parse(JSON.stringify(submitted))).toEqual({ expectedVersion: 2, mode: 'custom', custom })
})

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

test('저장 응답을 잃으면 기존 디자인이나 다른 입력 방식으로 바꾸기 전에 결과를 확인한다', async () => {
  const blue = { ...template, id: 'ec85bac3-878f-4b5f-b4bc-5f0bc8c00002', key: 'blue-focus', name: '블루 포커스' }
  const save = vi.mocked(designApi.save)
  vi.mocked(designApi.catalog).mockResolvedValue({ items: [template, blue], allowedFonts: ['Pretendard'] })
  vi.mocked(designApi.get).mockResolvedValue(storedTemplate)
  save.mockRejectedValueOnce(new TransportError('timeout'))
  save.mockResolvedValueOnce({ ...storedTemplate, version: 3, templateId: blue.id })
  mount()
  fireEvent.click(await screen.findByRole('button', { name: '블루 포커스 선택' }))
  fireEvent.click(screen.getByRole('button', { name: '디자인 저장' }))
  const retry = await screen.findByRole('button', { name: '저장 다시 시도' })
  const previous = screen.getByRole<HTMLButtonElement>('button', { name: '클린 리포트 선택' })
  const directInput = screen.getByRole<HTMLButtonElement>('button', { name: '직접 입력' })
  expect(previous.disabled).toBe(true)
  expect(directInput.disabled).toBe(true)
  fireEvent.click(previous)
  fireEvent.click(directInput)
  expect(screen.getByRole('button', { name: '블루 포커스 선택됨' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(retry)
  await screen.findByText('디자인을 저장했어요')
  expect(save).toHaveBeenCalledTimes(2)
  expect(save.mock.calls[1][1]).toEqual(save.mock.calls[0][1])
  expect(save.mock.calls[1][2]).toBe(save.mock.calls[0][2])
  expect(previous.disabled).toBe(false)
  expect(directInput.disabled).toBe(false)
})
