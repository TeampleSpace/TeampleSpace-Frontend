// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import capabilitiesExample from '../../../../contracts/examples/capabilities.json'
import { ApiError, TransportError } from '../../../shared/api/client.ts'
import type { AuthCapabilities } from '../../../entities/session/model.ts'
import { SessionContext } from '../../../entities/session/sessionContext.ts'
import { materialsApi } from '../../../entities/material/api.ts'
import type { Job, MaterialSummary } from '../../../entities/material/model.ts'
import OutlineGeneration from './OutlineGeneration.tsx'
import { outlineGenerationApi } from '../api.ts'
import { announceDecided, needsApproval, requestsApi } from '../../../entities/request/api.ts'
import type { ChangeRequest } from '../../../entities/request/api.ts'

vi.mock('../../../entities/request/api.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../entities/request/api.ts')>(),
  needsApproval: vi.fn(), requestsApi: { create: vi.fn(), list: vi.fn(), approve: vi.fn(), reject: vi.fn(), cancel: vi.fn() },
}))

const projectId = '10000000-0000-4000-8000-000000000001'
const source: MaterialSummary = {
  id: '10000000-0000-4000-8000-000000000003', projectId, title: '팀 회의 메모', status: 'ready', kind: 'memo',
  version: 1, pageCount: null, createdBy: { userId: 'user', name: '팀원' }, createdAt: '', updatedAt: '',
}
const queued: Job = {
  id: 'job-1', projectId, targetId: projectId, type: 'outline_generation', targetType: 'outline',
  progress: 0, status: 'queued', createdAt: '', updatedAt: '', inputVersions: { outlineVersion: 1 },
}
const succeeded: Job = { ...queued, status: 'succeeded', progress: 100,
  resultRef: { type: 'outline', projectId, outlineVersion: 2 },
}

function mount(enabled: boolean, onAccessError = vi.fn(), options: {
  dirty?: boolean; onGenerated?: () => Promise<boolean>; linkedSourceIds?: string[]
} = {}) {
  const current = capabilitiesExample as AuthCapabilities
  const capabilities = { ...current, featureFlags: { ...current.featureFlags, outlineGeneration: enabled } }
  const session = { user: null, capabilities, loading: false, error: undefined, refresh: vi.fn(), setUser: vi.fn() }
  const onGenerated = vi.fn(options.onGenerated ?? (async () => true))
  const component = (dirty = false, linked = options.linkedSourceIds) => <SessionContext value={session}>
    <OutlineGeneration projectId={projectId} version={1} outlineHasItems={Boolean(linked)}
      linkedSourceIds={linked} dirty={dirty}
      onGenerated={onGenerated} onAccessError={onAccessError} />
  </SessionContext>
  const { rerender } = render(component(options.dirty))
  return { onGenerated, setDirty: (dirty: boolean) => rerender(component(dirty)),
    setLinked: (linked: string[]) => rerender(component(options.dirty, linked)) }
}

function apiError(status: number, code: string, retryAfter?: number) {
  return new ApiError(status, { error: { code, message: '요청을 확인해 주세요', retryable: status === 429 }, requestId: 'request' }, retryAfter)
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
beforeEach(() => {
  vi.spyOn(outlineGenerationApi, 'latest').mockResolvedValue(undefined)
  vi.spyOn(materialsApi, 'list').mockResolvedValue({
    items: [source, { ...source, id: 'processing', title: '처리 중인 자료', status: 'processing' }],
    nextCursor: null, counts: { all: 2, file: 0, link: 0, memo: 2 },
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

test('기능이 비활성이면 생성과 작업 확인을 요청하지 않는다', () => {
  mount(false)
  expect(screen.getByRole('button', { name: 'AI로 구성 만들기' })).toHaveProperty('disabled', true)
  expect(outlineGenerationApi.latest).not.toHaveBeenCalled()
})

test('생성 응답이 끊겨도 같은 키와 본문으로 재시도하고 완료된 구성을 다시 읽는다', async () => {
  const create = vi.spyOn(outlineGenerationApi, 'create')
    .mockRejectedValueOnce(new TransportError('network')).mockResolvedValueOnce(queued)
  vi.spyOn(materialsApi, 'job').mockResolvedValue(succeeded)
  const { onGenerated: refresh, setLinked } = mount(true)
  fireEvent.click(screen.getByRole('button', { name: 'AI로 구성 만들기' }))
  const form = within(await screen.findByRole('dialog', { name: 'AI로 구성 만들기' }))
  fireEvent.click(await form.findByRole('checkbox', { name: source.title }))
  expect(form.queryByRole('checkbox', { name: '처리 중인 자료' })).toBeNull()
  fireEvent.change(form.getByLabelText('생성 지시'), { target: { value: '발표 시간을 고려해 주세요' } })
  fireEvent.click(form.getByRole('button', { name: '구성 만들기' }))
  fireEvent.click(await form.findByRole('button', { name: '생성 요청 다시 확인' }))
  expect(await screen.findByText('발표 구성을 만들었어요')).toBeTruthy()
  // 새 구성을 불러와 항목이 생겨도 전체 생성 결과 안내를 유지한다
  setLinked([source.id])
  expect(screen.getByText('발표 구성을 만들었어요')).toBeTruthy()
  expect(create).toHaveBeenCalledTimes(2)
  expect(create.mock.calls[0]).toEqual(create.mock.calls[1])
  expect(create.mock.calls[0]?.[1]).toEqual({ expectedVersion: 1, sourceIds: [source.id], instructions: '발표 시간을 고려해 주세요' })
  expect(refresh).toHaveBeenCalledTimes(1)
})

test('구성이 있으면 기존 구성에 새 자료 반영을 기본으로 하고 연결하지 않은 자료를 골라 둔다', async () => {
  const added = { ...source, id: '10000000-0000-4000-8000-000000000004', title: '새 회의 메모' }
  vi.mocked(materialsApi.list).mockResolvedValue({ items: [source, added], nextCursor: null, counts: { all: 2, file: 0, link: 0, memo: 2 } })
  const create = vi.spyOn(outlineGenerationApi, 'create').mockResolvedValue(queued)
  vi.spyOn(materialsApi, 'job').mockResolvedValue(succeeded)
  vi.mocked(needsApproval).mockResolvedValue(false)
  mount(true, undefined, { linkedSourceIds: [source.id] })
  fireEvent.click(screen.getByRole('button', { name: 'AI로 구성 만들기' }))
  const form = within(await screen.findByRole('dialog', { name: 'AI로 구성 만들기' }))
  expect(form.getByRole('radio', { name: '기존 구성에 새 자료 반영' })).toHaveProperty('checked', true)
  await waitFor(() => expect(form.getByRole('checkbox', { name: added.title })).toHaveProperty('checked', true))
  expect(form.getByRole('checkbox', { name: source.title })).toHaveProperty('checked', false)
  fireEvent.click(form.getByRole('radio', { name: '구성 새로 만들기' }))
  expect(form.getByText('생성이 끝나면 저장된 발표 구성이 새 결과로 바뀌어요.')).toBeTruthy()
  fireEvent.click(form.getByRole('radio', { name: '기존 구성에 새 자료 반영' }))
  fireEvent.click(form.getByRole('button', { name: '새 자료 반영' }))
  expect(await screen.findByText('새 자료를 발표 구성에 반영했어요')).toBeTruthy()
  expect(create.mock.calls[0]?.[1]).toEqual({ expectedVersion: 1, sourceIds: [added.id], mode: 'extend' })
})

test('재진입한 작업을 닫아도 유지하고 명시적 취소만 서버에 보낸다', async () => {
  vi.mocked(outlineGenerationApi.latest).mockResolvedValue(queued)
  vi.spyOn(materialsApi, 'job').mockResolvedValue(queued)
  const cancel = vi.spyOn(materialsApi, 'cancelJob').mockResolvedValue({ ...queued, status: 'canceled' })
  const { onGenerated: refresh } = mount(true)
  const open = await screen.findByRole('button', { name: '구성 생성 진행 보기' })
  fireEvent.click(open)
  const progress = within(await screen.findByRole('dialog', { name: '발표 구성을 만들고 있어요' }))
  fireEvent.click(progress.getAllByRole('button', { name: '닫기' })[0])
  expect(cancel).not.toHaveBeenCalled()
  fireEvent.click(open)
  fireEvent.click(await progress.findByRole('button', { name: '생성 취소' }))
  await waitFor(() => expect(cancel).toHaveBeenCalledWith(queued.id))
  expect(await screen.findByText('발표 구성 생성을 취소했어요')).toBeTruthy()
  expect(refresh).not.toHaveBeenCalled()
})

test('구성을 조회한 직후 작업이 완료됐다면 다시 진입했을 때 결과를 불러온다', async () => {
  vi.mocked(outlineGenerationApi.latest).mockResolvedValue(succeeded)
  const { onGenerated: refresh } = mount(true)
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
})

test('미저장 편집을 마칠 때까지 백그라운드 생성 결과 적용을 미룬다', async () => {
  vi.mocked(outlineGenerationApi.latest).mockResolvedValue(succeeded)
  const { onGenerated, setDirty } = mount(true, undefined, { dirty: true })
  fireEvent.click(await screen.findByRole('button', { name: '생성 결과 보기' }))
  expect(await screen.findByText('편집을 마치면 생성한 발표 구성을 불러올 수 있어요')).toBeTruthy()
  expect(onGenerated).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: '생성 결과 다시 불러오기' })).toBeNull()
  setDirty(false)
  expect(await screen.findByText('발표 구성을 만들었어요')).toBeTruthy()
  expect(onGenerated).toHaveBeenCalledTimes(1)
})

test('결과 조회 중에 시작한 편집 때문에 결과 적용을 보류하면 완료로 표시하지 않는다', async () => {
  vi.mocked(outlineGenerationApi.latest).mockResolvedValue(succeeded)
  const onGenerated = vi.fn<() => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  vi.spyOn(materialsApi, 'job').mockResolvedValue(succeeded)
  mount(true, undefined, { onGenerated })
  fireEvent.click(await screen.findByRole('button', { name: '생성 결과 보기' }))
  expect(await screen.findByText('편집을 마치면 생성한 발표 구성을 불러올 수 있어요')).toBeTruthy()
  expect(screen.queryByText('발표 구성을 만들었어요')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '생성 결과 다시 불러오기' }))
  expect(await screen.findByText('발표 구성을 만들었어요')).toBeTruthy()
  expect(onGenerated).toHaveBeenCalledTimes(2)
})

test('생성에 사용할 수 없어진 자료만 제외하고 입력과 나머지 선택을 유지한다', async () => {
  const kept = { ...source, id: 'kept', title: '발표 개요 메모' }
  const counts = { all: 2, file: 0, link: 0, memo: 2 }
  vi.mocked(materialsApi.list).mockResolvedValueOnce({ items: [source, kept], nextCursor: null, counts })
    .mockResolvedValueOnce({ items: [kept], nextCursor: null, counts })
  vi.spyOn(outlineGenerationApi, 'create').mockRejectedValueOnce(apiError(422, 'VALIDATION_FAILED'))
  mount(true)
  fireEvent.click(screen.getByRole('button', { name: 'AI로 구성 만들기' }))
  const form = within(await screen.findByRole('dialog', { name: 'AI로 구성 만들기' }))
  fireEvent.click(await form.findByRole('checkbox', { name: source.title }))
  fireEvent.click(form.getByRole('checkbox', { name: kept.title }))
  fireEvent.change(form.getByLabelText('생성 지시'), { target: { value: '발표 시간을 고려해 주세요' } })
  fireEvent.click(form.getByRole('button', { name: '구성 만들기' }))
  await waitFor(() => expect(form.queryByRole('checkbox', { name: source.title })).toBeNull())
  expect(materialsApi.list).toHaveBeenCalledTimes(2)
  expect(materialsApi.list).toHaveBeenLastCalledWith(projectId, { cursor: undefined })
  expect(form.getByRole('checkbox', { name: kept.title })).toHaveProperty('checked', true)
  expect(form.getByLabelText('생성 지시')).toHaveProperty('value', '발표 시간을 고려해 주세요')
})

test('프로젝트 작업 목록을 찾을 수 없으면 프로젝트 접근 상태를 알린다', async () => {
  const reason = apiError(404, 'NOT_FOUND')
  vi.mocked(outlineGenerationApi.latest).mockRejectedValueOnce(reason)
  const onAccessError = vi.fn()
  mount(true, onAccessError)
  await waitFor(() => expect(onAccessError).toHaveBeenCalledWith(reason))
})

test('다른 팀원의 작업을 취소할 수 없으면 그 작업의 취소 버튼만 숨긴다', async () => {
  vi.mocked(outlineGenerationApi.latest).mockResolvedValue(queued)
  vi.spyOn(materialsApi, 'job').mockResolvedValue(queued)
  vi.spyOn(materialsApi, 'cancelJob').mockRejectedValueOnce(apiError(403, 'FORBIDDEN'))
  const onAccessError = vi.fn()
  mount(true, onAccessError)
  fireEvent.click(await screen.findByRole('button', { name: '구성 생성 진행 보기' }))
  const dialog = within(await screen.findByRole('dialog', { name: '발표 구성을 만들고 있어요' }))
  fireEvent.click(dialog.getByRole('button', { name: '생성 취소' }))
  expect(await dialog.findByRole('alert')).toBeTruthy()
  expect(dialog.queryByRole('button', { name: '생성 취소' })).toBeNull()
  expect(onAccessError).not.toHaveBeenCalled()
})

test.each([[429, 'RATE_LIMITED'], [409, 'REQUEST_IN_PROGRESS']])('응답 %s의 재시도 시간이 지나기 전에는 같은 생성을 다시 보내지 않는다', async (status, code) => {
  const create = vi.spyOn(outlineGenerationApi, 'create').mockRejectedValueOnce(apiError(status, code, 30))
  mount(true)
  fireEvent.click(screen.getByRole('button', { name: 'AI로 구성 만들기' }))
  const form = within(await screen.findByRole('dialog', { name: 'AI로 구성 만들기' }))
  fireEvent.click(await form.findByRole('checkbox', { name: source.title }))
  fireEvent.click(form.getByRole('button', { name: '구성 만들기' }))
  const retry = await form.findByRole('button', { name: '생성 요청 다시 확인' })
  await waitFor(() => expect(retry).toHaveProperty('disabled', true))
  fireEvent.click(retry)
  expect(create).toHaveBeenCalledTimes(1)
})

test('분석 중인 자료는 고를 수 없게 보여 주고 창을 열어 둔 동안 새 자료와 분석 결과를 반영한다', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const pdf: MaterialSummary = { ...source, id: 'pdf', title: '설문 결과 PDF', kind: 'file', status: 'processing' }
  const added: MaterialSummary = { ...source, id: 'added', title: '새로 추가한 메모' }
  const unread: MaterialSummary = { ...source, id: 'unread', title: '로그인 화면 링크', kind: 'link', status: 'failed' }
  const counts = { all: 3, file: 1, link: 1, memo: 1 }
  vi.mocked(materialsApi.list).mockReset()
    .mockResolvedValueOnce({ items: [pdf, unread, source], nextCursor: null, counts })
    .mockResolvedValue({ items: [added, { ...pdf, status: 'ready' }, unread, source], nextCursor: null, counts: { ...counts, all: 4, memo: 2 } })
  mount(true)
  fireEvent.click(screen.getByRole('button', { name: 'AI로 구성 만들기' }))
  const form = within(await screen.findByRole('dialog', { name: 'AI로 구성 만들기' }))
  const processing = await form.findByRole('checkbox', { name: /설문 결과 PDF/ })
  expect(processing).toHaveProperty('disabled', true)
  expect(form.getByText('분석 중')).toBeTruthy()
  // 본문을 읽지 못한 링크는 근거로 고를 수 없고 읽기 결과로 표시한다
  expect(form.getByRole('checkbox', { name: /로그인 화면 링크/ })).toHaveProperty('disabled', true)
  expect(form.getByText('본문 읽지 못함')).toBeTruthy()
  fireEvent.click(form.getByRole('checkbox', { name: source.title }))

  await vi.advanceTimersByTimeAsync(4000)
  expect(await form.findByRole('checkbox', { name: added.title })).toHaveProperty('disabled', false)
  expect(form.getByRole('checkbox', { name: '설문 결과 PDF' })).toHaveProperty('disabled', false)
  expect(form.queryByText('분석 중')).toBeNull()
  expect(form.getByRole('checkbox', { name: source.title })).toHaveProperty('checked', true)
})

test('다시 읽는 동안 추가 페이지의 분석 상태를 갱신하고 그 페이지에서 고른 자료를 유지한다', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const later: MaterialSummary = { ...source, id: 'later', title: '두 번째 페이지 메모' }
  const pdf: MaterialSummary = { ...source, id: 'pdf', title: '두 번째 페이지 PDF', kind: 'file', status: 'processing' }
  const counts = { all: 3, file: 1, link: 0, memo: 2 }
  const first = { items: [source], nextCursor: 'page-2', counts }
  vi.mocked(materialsApi.list).mockReset()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce({ items: [later, pdf], nextCursor: null, counts })
    .mockResolvedValue(first)
  vi.spyOn(materialsApi, 'get').mockResolvedValue({ ...pdf, status: 'ready' } as never)
  mount(true)
  fireEvent.click(screen.getByRole('button', { name: 'AI로 구성 만들기' }))
  const form = within(await screen.findByRole('dialog', { name: 'AI로 구성 만들기' }))
  fireEvent.click(await form.findByRole('button', { name: '자료 더 보기' }))
  expect(await form.findByRole('checkbox', { name: /두 번째 페이지 PDF/ })).toHaveProperty('disabled', true)
  fireEvent.click(form.getByRole('checkbox', { name: later.title }))

  await vi.advanceTimersByTimeAsync(4000)
  await waitFor(() => expect(form.getByRole('checkbox', { name: '두 번째 페이지 PDF' })).toHaveProperty('disabled', false))
  expect(materialsApi.get).toHaveBeenCalledWith('pdf')
  expect(form.getByRole('checkbox', { name: later.title })).toHaveProperty('checked', true)
})

test('조용히 다시 읽는 동안 누른 구성 만들기를 바로 처리한다', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const counts = { all: 1, file: 0, link: 0, memo: 1 }
  vi.mocked(materialsApi.list).mockReset()
    .mockResolvedValueOnce({ items: [source], nextCursor: null, counts })
    .mockReturnValue(new Promise(() => undefined))
  const create = vi.spyOn(outlineGenerationApi, 'create').mockResolvedValue(queued)
  mount(true)
  fireEvent.click(screen.getByRole('button', { name: 'AI로 구성 만들기' }))
  const form = within(await screen.findByRole('dialog', { name: 'AI로 구성 만들기' }))
  fireEvent.click(await form.findByRole('checkbox', { name: source.title }))
  await vi.advanceTimersByTimeAsync(4000)
  expect(materialsApi.list).toHaveBeenCalledTimes(2)
  fireEvent.click(form.getByRole('button', { name: '구성 만들기' }))
  await waitFor(() => expect(create).toHaveBeenCalled())
})

test('끝까지 읽은 뒤 한 페이지가 넘게 새 자료가 들어오면 자료 더 보기를 다시 보여 준다', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const counts = { all: 31, file: 0, link: 0, memo: 31 }
  const added = Array.from({ length: 30 }, (_, index) => ({ ...source, id: `new-${index}`, title: `새 자료 ${index}` }))
  vi.mocked(materialsApi.list).mockReset()
    .mockResolvedValueOnce({ items: [source], nextCursor: null, counts })
    .mockResolvedValue({ items: added, nextCursor: 'page-2', counts })
  mount(true)
  fireEvent.click(screen.getByRole('button', { name: 'AI로 구성 만들기' }))
  const form = within(await screen.findByRole('dialog', { name: 'AI로 구성 만들기' }))
  await form.findByRole('checkbox', { name: source.title })
  expect(form.queryByRole('button', { name: '자료 더 보기' })).toBeNull()
  await vi.advanceTimersByTimeAsync(4000)
  expect(await form.findByRole('button', { name: '자료 더 보기' })).toBeTruthy()
  expect(form.getByRole('checkbox', { name: '새 자료 0' })).toBeTruthy()
})

test('팀원이 둘 이상이면 승인을 요청하고 다른 팀원이 승인하면 시작한 작업을 보여 준다', async () => {
  vi.mocked(needsApproval).mockResolvedValue(true)
  const create = vi.spyOn(outlineGenerationApi, 'create')
  vi.mocked(requestsApi.create).mockImplementation(async () => request)
  vi.spyOn(materialsApi, 'job').mockResolvedValue({ ...queued, status: 'running', progress: 40 })
  const request: ChangeRequest = {
    id: 'request-1', projectId, type: 'outline_generation', state: 'pending', payload: {},
    requestedBy: { userId: 'me', name: '나' }, decidedBy: null, result: null, error: null, createdAt: '', decidedAt: null,
  }
  mount(true)
  fireEvent.click(screen.getByRole('button', { name: 'AI로 구성 만들기' }))
  const form = within(await screen.findByRole('dialog', { name: 'AI로 구성 만들기' }))
  fireEvent.click(await form.findByRole('checkbox', { name: source.title }))
  fireEvent.click(form.getByRole('button', { name: '구성 만들기' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(create).not.toHaveBeenCalled()
  expect(vi.mocked(requestsApi.create).mock.calls[0]?.slice(0, 3)).toEqual([projectId, 'outline_generation', { expectedVersion: 1, sourceIds: [source.id] }])

  // 다른 프로젝트나 다른 종류의 승인은 무시한다
  announceDecided({ ...request, projectId: 'other', state: 'approved', result: { jobId: queued.id } })
  announceDecided({ ...request, type: 'design_change', state: 'approved', result: { designVersion: 2 } })
  announceDecided({ ...request, state: 'approved', result: { jobId: queued.id } })
  expect(await screen.findByRole('button', { name: '구성 생성 진행 보기' })).toBeTruthy()
  expect(materialsApi.job).toHaveBeenCalledWith(queued.id)
})
