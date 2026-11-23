// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import capabilitiesExample from '../../../../contracts/examples/capabilities.json'
import { ApiError, TransportError } from '../../../shared/api/client.ts'
import type { AuthCapabilities } from '../../../entities/session/model.ts'
import { SessionContext } from '../../../entities/session/sessionContext.ts'
import { materialsApi } from '../../../entities/material/api.ts'
import type { Job } from '../../../entities/material/model.ts'
import { outlineApi } from '../../outline/api.ts'
import type { Outline } from '../../outline/model.ts'
import { designApi } from '../../design/api.ts'
import { presentationGenerationApi } from '../api.ts'
import PresentationGeneration from './PresentationGeneration.tsx'
import { announceDecided, needsApproval, requestsApi } from '../../../entities/request/api.ts'
import type { ChangeRequest } from '../../../entities/request/api.ts'

vi.mock('../../../entities/request/api.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../entities/request/api.ts')>(),
  needsApproval: vi.fn(), requestsApi: { create: vi.fn(), list: vi.fn(), approve: vi.fn(), reject: vi.fn(), cancel: vi.fn() },
}))

const projectId = '10000000-0000-4000-8000-000000000001'
const sourceId = '10000000-0000-4000-8000-000000000003'
const outline: Outline = { projectId, version: 3, items: [
  { id: 'item-1', title: '배경', summary: '', position: 0,
    sourceRefs: [{ materialId: sourceId, revisionId: 'revision', sourceVersion: 1, sourceDeleted: false }] },
  { id: 'item-2', title: '정리', summary: '', position: 1, sourceRefs: [] },
] }
const template = {
  id: 'template', key: 'clean-report', version: 1, name: '클린 리포트',
  preview: { backgroundColor: '#FFFFFF', headingColor: '#212735', description: '' }, fonts: ['Pretendard'], layouts: ['title'],
}
const queued: Job = {
  id: 'job-1', projectId, targetId: projectId, type: 'presentation_generation', targetType: 'presentation',
  progress: 0, status: 'queued', createdAt: '', updatedAt: '', inputVersions: { outlineVersion: 3, designVersion: 2 },
}
const succeeded: Job = { ...queued, status: 'succeeded', progress: 100,
  resultRef: { type: 'presentation', projectId, presentationId: 'presentation', presentationVersion: 1 },
}

function mount(enabled = true, onCompleted = vi.fn()) {
  const current = capabilitiesExample as AuthCapabilities
  const capabilities = { ...current, featureFlags: { ...current.featureFlags, presentationGeneration: enabled } }
  const session = { user: null, capabilities, loading: false, error: undefined, refresh: vi.fn(), setUser: vi.fn() }
  const router = createMemoryRouter([
    { path: '/', element: <SessionContext value={session}>
      <PresentationGeneration projectId={projectId} projectName="캠퍼스 친환경 전환" onCompleted={onCompleted} />
    </SessionContext> },
    { path: '/projects/:projectId/:page', element: <p>이동한 화면</p> },
  ])
  render(<RouterProvider router={router} />)
  return { onCompleted, router }
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
beforeEach(() => {
  vi.spyOn(presentationGenerationApi, 'latest').mockResolvedValue(undefined)
  vi.spyOn(outlineApi, 'get').mockResolvedValue(outline)
  vi.spyOn(designApi, 'get').mockResolvedValue({ version: 2, updatedAt: '', mode: 'template', templateId: 'template', templateVersion: 1, custom: null })
  vi.spyOn(designApi, 'catalog').mockResolvedValue({ items: [template], allowedFonts: ['Pretendard'] })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

test('기능이 꺼져 있으면 버튼을 막고 작업을 찾지 않는다', () => {
  mount(false)
  expect(screen.getByRole('button', { name: 'PPT 만들기' })).toHaveProperty('disabled', true)
  expect(presentationGenerationApi.latest).not.toHaveBeenCalled()
})

test('저장한 구성과 디자인으로 생성하고 완료되면 결과를 불러온 뒤 편집 화면으로 보낸다', async () => {
  const create = vi.spyOn(presentationGenerationApi, 'create').mockResolvedValue(queued)
  const job = vi.spyOn(materialsApi, 'job').mockResolvedValueOnce({ ...queued, status: 'running' }).mockResolvedValue(succeeded)
  const { onCompleted, router } = mount()
  fireEvent.click(screen.getByRole('button', { name: 'PPT 만들기' }))
  const confirm = await screen.findByRole('dialog', { name: 'PPT 초안 만들기' })
  expect(await within(confirm).findByText('발표 구성 2장, 표지와 정리를 더해 4장')).toBeTruthy()
  expect(within(confirm).getByText('연결된 근거 자료 1개, 본문 아래에 출처 표시')).toBeTruthy()
  expect(within(confirm).getByText('클린 리포트')).toBeTruthy()

  fireEvent.click(within(confirm).getByRole('button', { name: '초안 생성' }))
  await screen.findByRole('dialog', { name: '발표자료를 만들고 있어요' })
  expect(create).toHaveBeenCalledWith(projectId, { outlineVersion: 3, designVersion: 2, sourceIds: [sourceId] }, expect.any(String))
  const done = await screen.findByRole('dialog', { name: '발표자료가 완성됐어요' }, { timeout: 5000 })
  expect(job).toHaveBeenCalled()
  await waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(1))
  fireEvent.click(within(done).getByRole('button', { name: '생성 결과 보기' }))
  expect(router.state.location.pathname).toBe(`/projects/${projectId}/slides`)
})

test('근거 자료가 없거나 디자인을 저장하지 않았으면 요청 전에 막고 이동할 화면을 알려 준다', async () => {
  vi.mocked(outlineApi.get).mockResolvedValue({ ...outline, items: outline.items.map((item) => ({ ...item, sourceRefs: [] })) })
  const create = vi.spyOn(presentationGenerationApi, 'create')
  mount()
  fireEvent.click(screen.getByRole('button', { name: 'PPT 만들기' }))
  const confirm = await screen.findByRole('dialog', { name: 'PPT 초안 만들기' })
  expect(await within(confirm).findByText('발표 구성에 근거 자료를 하나 이상 연결해 주세요')).toBeTruthy()
  expect(within(confirm).getByRole('button', { name: '초안 생성' })).toHaveProperty('disabled', true)

  vi.mocked(outlineApi.get).mockResolvedValue(outline)
  vi.mocked(designApi.get).mockResolvedValue({ version: 1, updatedAt: '', mode: 'unset', templateId: null, templateVersion: null, custom: null })
  fireEvent.click(within(confirm).getByRole('button', { name: '닫기' }))
  fireEvent.click(screen.getByRole('button', { name: 'PPT 만들기' }))
  expect(await within(confirm).findByText('디자인을 먼저 저장해 주세요')).toBeTruthy()
  expect(create).not.toHaveBeenCalled()
})

test('다시 들어오면 진행 중인 작업을 이어 보고 확인을 거쳐 취소한다', async () => {
  vi.mocked(presentationGenerationApi.latest).mockResolvedValue({ ...queued, status: 'running' })
  vi.spyOn(materialsApi, 'job').mockResolvedValue({ ...queued, status: 'running' })
  const cancel = vi.spyOn(materialsApi, 'cancelJob').mockResolvedValue({ ...queued, status: 'canceled' })
  mount()
  fireEvent.click(await screen.findByRole('button', { name: '생성 진행 보기' }))
  const progress = await screen.findByRole('dialog', { name: '발표자료를 만들고 있어요' })
  fireEvent.click(within(progress).getByRole('button', { name: '생성 취소' }))
  const ask = await screen.findByRole('dialog', { name: '생성을 취소할까요?' })
  fireEvent.click(within(ask).getByRole('button', { name: '생성 계속' }))
  expect(cancel).not.toHaveBeenCalled()
  fireEvent.click(within(progress).getByRole('button', { name: '생성 취소' }))
  fireEvent.click(within(ask).getByRole('button', { name: '취소하기' }))
  expect(await screen.findByRole('dialog', { name: '생성을 취소했어요' })).toBeTruthy()
  expect(cancel).toHaveBeenCalledWith('job-1')
})

test('실패하면 서버 사유를 보여 주고 다시 생성으로 확인 화면을 연다', async () => {
  vi.spyOn(presentationGenerationApi, 'create').mockResolvedValue(queued)
  vi.spyOn(materialsApi, 'job').mockResolvedValue({ ...queued, status: 'failed',
    error: { code: 'JOB_INPUT_STALE', message: '저장한 발표 구성이나 디자인, 자료가 바뀌었어요.', retryable: false } })
  mount()
  fireEvent.click(screen.getByRole('button', { name: 'PPT 만들기' }))
  const confirm = await screen.findByRole('dialog', { name: 'PPT 초안 만들기' })
  await within(confirm).findByText('클린 리포트')
  fireEvent.click(within(confirm).getByRole('button', { name: '초안 생성' }))
  const failed = await screen.findByRole('dialog', { name: '발표자료를 완성하지 못했어요' })
  expect(within(failed).getByText('저장한 발표 구성이나 디자인, 자료가 바뀌었어요.')).toBeTruthy()
  fireEvent.click(within(failed).getByRole('button', { name: '다시 생성' }))
  expect(await screen.findByRole('dialog', { name: 'PPT 초안 만들기' })).toBeTruthy()
})

test('이미 만든 문서가 있으면 서버 사유와 함께 만든 PPT로 이동할 수 있다', async () => {
  vi.spyOn(presentationGenerationApi, 'create').mockRejectedValue(new ApiError(409,
    { error: { code: 'REGENERATION_NOT_ENABLED', message: '이미 발표 자료가 있어요.', retryable: false }, requestId: 'request' }))
  const { router } = mount()
  fireEvent.click(screen.getByRole('button', { name: 'PPT 만들기' }))
  const confirm = await screen.findByRole('dialog', { name: 'PPT 초안 만들기' })
  await within(confirm).findByText('클린 리포트')
  fireEvent.click(within(confirm).getByRole('button', { name: '초안 생성' }))
  expect(await within(confirm).findByText('이미 발표 자료가 있어요.')).toBeTruthy()
  fireEvent.click(within(confirm).getByRole('button', { name: '만든 PPT 보기' }))
  expect(router.state.location.pathname).toBe(`/projects/${projectId}/slides`)
})

test('이미 끝난 작업이 있으면 결과 안내를 다시 열고 편집 화면으로 보낸다', async () => {
  vi.mocked(presentationGenerationApi.latest).mockResolvedValue(succeeded)
  const { router } = mount()
  fireEvent.click(await screen.findByRole('button', { name: '생성 결과 보기' }))
  const done = await screen.findByRole('dialog', { name: '발표자료가 완성됐어요' })
  fireEvent.click(within(done).getByRole('button', { name: '생성 결과 보기' }))
  expect(router.state.location.pathname).toBe(`/projects/${projectId}/slides`)
})

test('완료 뒤 문서 조회가 실패하면 완료 안내에서 다시 불러온다', async () => {
  vi.spyOn(presentationGenerationApi, 'create').mockResolvedValue(queued)
  vi.spyOn(materialsApi, 'job').mockResolvedValue(succeeded)
  const onCompleted = vi.fn().mockRejectedValueOnce(new TransportError('network')).mockResolvedValue(undefined)
  mount(true, onCompleted)
  fireEvent.click(screen.getByRole('button', { name: 'PPT 만들기' }))
  const confirm = await screen.findByRole('dialog', { name: 'PPT 초안 만들기' })
  await within(confirm).findByText('클린 리포트')
  fireEvent.click(within(confirm).getByRole('button', { name: '초안 생성' }))
  const done = await screen.findByRole('dialog', { name: '발표자료가 완성됐어요' })
  fireEvent.click(await within(done).findByRole('button', { name: '결과 다시 불러오기' }))
  await waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(within(done).queryByRole('button', { name: '결과 다시 불러오기' })).toBeNull())
})

test('팀원이 둘 이상이면 승인을 요청하고 다른 팀원이 승인해 끝난 문서를 불러온다', async () => {
  vi.mocked(needsApproval).mockResolvedValue(true)
  const request: ChangeRequest = {
    id: 'request-1', projectId, type: 'presentation_generation', state: 'pending', payload: {},
    requestedBy: { userId: 'me', name: '나' }, decidedBy: null, result: null, error: null, createdAt: '', decidedAt: null,
  }
  vi.mocked(requestsApi.create).mockResolvedValue(request)
  const create = vi.spyOn(presentationGenerationApi, 'create')
  vi.spyOn(materialsApi, 'job').mockResolvedValue(succeeded)
  const { onCompleted } = mount()
  fireEvent.click(screen.getByRole('button', { name: 'PPT 만들기' }))
  const confirm = await screen.findByRole('dialog', { name: 'PPT 초안 만들기' })
  await within(confirm).findByText('클린 리포트')
  fireEvent.click(within(confirm).getByRole('button', { name: '초안 생성' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(create).not.toHaveBeenCalled()
  expect(requestsApi.create).toHaveBeenCalledWith(projectId, 'presentation_generation',
    { outlineVersion: 3, designVersion: 2, sourceIds: [sourceId] }, expect.any(String))

  announceDecided({ ...request, state: 'rejected' })
  announceDecided({ ...request, state: 'approved', result: { jobId: queued.id } })
  await waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(1))
  expect(screen.getByRole('button', { name: '생성 결과 보기' })).toBeTruthy()
})
