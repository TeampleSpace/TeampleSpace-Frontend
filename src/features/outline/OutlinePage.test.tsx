// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { useEffect } from 'react'
import { ApiError, TransportError } from '../../shared/api/client.ts'
import { SessionContext } from '../auth/sessionContext.ts'
import { materialsApi } from '../materials/api.ts'
import { projectsApi } from '../projects/api.ts'
import { outlineApi } from './api.ts'
import { readOutlineSummary, writeOutlineSummary } from './model.ts'
import type { Outline, OutlineItem } from './model.ts'
import OutlinePage from './OutlinePage.tsx'
import type { OutlineAiSlotProps, OutlineEvidenceProps } from './OutlinePage.tsx'

vi.mock('../materials/api.ts', () => ({ materialsApi: { list: vi.fn() } }))
vi.mock('../projects/api.ts', () => ({ projectsApi: { get: vi.fn() } }))
vi.mock('./api.ts', () => ({ outlineApi: { get: vi.fn(), save: vi.fn() } }))

const project = { id: 'project-1', name: '캠퍼스', topic: null, presentationConstraints: null, ownerId: 'user-1', version: 1,
  memberCount: 2, createdAt: '2026-11-20T00:00:00Z', updatedAt: '2026-11-20T00:00:00Z' }
const old: OutlineItem = { id: 'item-1', title: '첫 번째 목차', summary: '기존 내용', position: 0, sourceRefs: [] }
const empty: Outline = { projectId: project.id, version: 1, items: [] }
const initial: Outline = { ...empty, items: [old] }

function mount(outline: Outline, ai?: React.ComponentType<OutlineAiSlotProps>, evidence?: React.ComponentType<OutlineEvidenceProps>) {
  vi.mocked(outlineApi.get).mockResolvedValue(outline)
  const session = { user: null, setUser: vi.fn(), refresh: vi.fn(), capabilities: null, loading: false, error: undefined }
  const setCurrentProject = vi.fn()
  const router = createMemoryRouter([{ element: <SessionContext value={session}><Outlet context={{ setCurrentProject }} /></SessionContext>, children: [
    { path: '/', element: <p>프로젝트 목록</p> },
    { path: '/projects/:projectId/outline', element: <OutlinePage renderAi={ai} renderEvidence={evidence} /> },
  ] }], { initialEntries: [`/projects/${project.id}/outline`] })
  render(<RouterProvider router={router} />)
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(projectsApi.get).mockResolvedValue(project)
  vi.mocked(materialsApi.list).mockResolvedValue({ items: [], nextCursor: null, counts: { all: 0, file: 0, link: 0, memo: 0 } })
})
afterEach(cleanup)

function update(label: string, value: string) {
  fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value } })
}

const save = () => fireEvent.click(screen.getByRole('button', { name: '저장' }))

function conflict() {
  return new ApiError(409, { error: { code: 'VERSION_CONFLICT', message: '버전이 바뀌었어요', retryable: false, currentVersions: { outlineVersion: 2 } }, requestId: 'test' })
}

test('핵심 주장과 본문이 서버 요약으로 왕복하고 기존 요약은 본문으로 유지된다', () => {
  const content = '문단 하나\n\n발표 내용\n문단 둘'
  expect(readOutlineSummary('기존 내용')).toEqual({ claim: '', content: '기존 내용' })
  expect(readOutlineSummary(writeOutlineSummary('주장', content))).toEqual({ claim: '주장', content })
  const ambiguous = '핵심 주장\n예전\n\n발표 내용\n본문'
  expect(readOutlineSummary(writeOutlineSummary('', ambiguous))).toEqual({ claim: '', content: ambiguous })
})

test('빈 구성에서 목차를 검증하고 응답을 잃은 저장은 같은 키와 본문으로 재시도한다', async () => {
  const saved = { ...initial, version: 2, items: [{ ...old, title: '실행 계획', summary: writeOutlineSummary('우선 적용', '팀원끼리 검토한다') }] }
  vi.mocked(outlineApi.save).mockRejectedValueOnce(new TransportError('network')).mockResolvedValueOnce(saved)
  mount(empty)
  fireEvent.click(await screen.findByRole('button', { name: '직접 목차 추가' }))
  const dialog = within(await screen.findByRole('dialog', { name: '목차 추가' }))
  fireEvent.click(dialog.getByRole('button', { name: '목차 추가' }))
  expect(dialog.getByText('슬라이드 제목을 입력해 주세요')).toBeTruthy()
  expect(outlineApi.save).not.toHaveBeenCalled()
  update('슬라이드 제목', '실행 계획')
  update('핵심 주장', '우선 적용')
  update('발표 내용', '팀원끼리 검토한다')
  fireEvent.click(dialog.getByRole('button', { name: '목차 추가' }))
  await dialog.findByText(/서버에 연결할 수 없습니다/)
  fireEvent.click(dialog.getByRole('button', { name: '목차 추가' }))
  expect(await screen.findByRole('heading', { name: /실행 계획/ })).toBeTruthy()
  const requests = vi.mocked(outlineApi.save).mock.calls
  expect(requests).toHaveLength(2)
  expect(requests[0]).toEqual(requests[1])
  expect(requests[0][1]).toEqual({ expectedVersion: 1, items: [{ title: '실행 계획', summary: saved.items[0].summary, sourceIds: [] }] })
})

test('확인된 버전 충돌은 최신 내용을 비교한 다음에도 내 입력을 유지한다', async () => {
  const current = { ...initial, version: 2, items: [{ ...old, title: '팀이 바꾼 목차' }] }
  vi.mocked(outlineApi.save).mockRejectedValueOnce(conflict()).mockResolvedValueOnce({ ...current, version: 3, items: [{ ...old, title: '내가 쓴 목차' }] })
  mount(initial)
  fireEvent.click(await screen.findByRole('button', { name: '내용 편집' }))
  update('슬라이드 제목', '내가 쓴 목차')
  save()
  const check = await screen.findByRole('button', { name: '최신 내용 확인' })
  vi.mocked(outlineApi.get).mockResolvedValue(current)
  fireEvent.click(check)
  expect(await screen.findByText('최신 제목은 팀이 바꾼 목차입니다.')).toBeTruthy()
  expect((screen.getByRole('textbox', { name: '슬라이드 제목' }) as HTMLInputElement).value).toBe('내가 쓴 목차')
  fireEvent.click(screen.getByRole('button', { name: '최신 구성을 기준으로 계속' }))
  expect(outlineApi.save).toHaveBeenCalledTimes(1)
  save()
  expect(await screen.findByRole('heading', { name: /내가 쓴 목차/ })).toBeTruthy()
  expect(vi.mocked(outlineApi.save).mock.calls[1][1].expectedVersion).toBe(2)
  expect(vi.mocked(outlineApi.save).mock.calls[1][2]).not.toBe(vi.mocked(outlineApi.save).mock.calls[0][2])
})

test('응답을 잃은 저장 뒤 원래 제목으로 되돌려도 이전 요청을 확인하고 다시 저장할 수 있다', async () => {
  const first = { ...initial, version: 2, items: [{ ...old, title: '처음 저장한 목차' }] }
  vi.mocked(outlineApi.save).mockRejectedValueOnce(new TransportError('network')).mockResolvedValueOnce(first)
    .mockResolvedValueOnce({ ...initial, version: 3 })
  mount(initial)
  fireEvent.click(await screen.findByRole('button', { name: '내용 편집' }))
  update('슬라이드 제목', first.items[0].title)
  save()
  await screen.findByText(/서버에 연결할 수 없습니다/)
  update('슬라이드 제목', old.title)
  save()
  await screen.findByText('이전 저장 결과를 확인했어요. 새 입력을 저장하려면 다시 저장해 주세요.')
  expect((screen.getByRole('textbox', { name: '슬라이드 제목' }) as HTMLInputElement).value).toBe(old.title)
  const requests = vi.mocked(outlineApi.save).mock.calls
  expect(requests).toHaveLength(2)
  expect(requests[1]).toEqual(requests[0])
  save()
  await screen.findByRole('heading', { name: /첫 번째 목차/ })
  expect(requests).toHaveLength(3)
  expect(requests[2][1]).toEqual({ expectedVersion: 2, items: [{ id: old.id, title: old.title, summary: old.summary, sourceIds: [] }] })
  expect(requests[2][2]).not.toBe(requests[0][2])
})

test('근거를 다시 고정하거나 삭제 연결을 제거할 때 본문 저장 전에 확인한다', async () => {
  const withRefs = { ...initial, items: [{ ...old, sourceRefs: [
    { materialId: 'active', revisionId: 'old-revision', sourceVersion: 1, sourceDeleted: false },
    { materialId: 'deleted', revisionId: 'deleted-revision', sourceVersion: 1, sourceDeleted: true },
  ] }] }
  vi.mocked(outlineApi.save).mockResolvedValue({ ...withRefs, version: 2, items: [{ ...old, title: '새 제목' }] })
  mount(withRefs)
  fireEvent.click(await screen.findByRole('button', { name: '내용 편집' }))
  update('슬라이드 제목', '새 제목')
  save()
  const confirmation = within(await screen.findByRole('dialog', { name: '연결된 근거를 다시 저장할까요?' }))
  expect(outlineApi.save).not.toHaveBeenCalled()
  fireEvent.click(confirmation.getByRole('button', { name: '확인하고 저장' }))
  await screen.findByRole('heading', { name: /새 제목/ })
  expect(vi.mocked(outlineApi.save).mock.calls[0][1].items[0].sourceIds).toEqual(['active'])
})

test('AI 결과로 처음 구성 항목을 불러와도 작업 상태 컴포넌트가 유지된다', async () => {
  const mounted = vi.fn()
  function Ai({ onGenerated }: OutlineAiSlotProps) {
    useEffect(() => { mounted() }, [])
    return <button type="button" onClick={() => void onGenerated()}>AI 작업 결과 반영</button>
  }
  mount(empty, Ai)
  const trigger = await screen.findByRole('button', { name: 'AI 작업 결과 반영' })
  vi.mocked(outlineApi.get).mockResolvedValue({ ...initial, version: 2 })
  fireEvent.click(trigger)
  await screen.findByRole('heading', { name: /첫 번째 목차/ })
  await waitFor(() => expect(screen.getByRole('button', { name: 'AI 작업 결과 반영' })).toBe(trigger))
  expect(mounted).toHaveBeenCalledTimes(1)
})

test('생성 결과를 읽는 도중 근거 선택이 시작되면 기존 목차를 유지한다', async () => {
  const applied = vi.fn()
  const generated = { ...initial, version: 2, items: [{ ...old, id: 'generated', title: '생성한 목차' }] }
  function Ai({ onGenerated }: OutlineAiSlotProps) {
    return <button type="button" onClick={() => void onGenerated().then(applied)}>생성 결과 확인</button>
  }
  function Evidence({ onDirtyChange }: OutlineEvidenceProps) {
    return <>
      <button type="button" onClick={() => onDirtyChange(true)}>근거 선택 변경</button>
      <button type="button" onClick={() => onDirtyChange(false)}>근거 선택 닫기</button>
    </>
  }
  mount(initial, Ai, Evidence)
  const trigger = await screen.findByRole('button', { name: '생성 결과 확인' })
  let respond: (value: Outline) => void = () => {}
  vi.mocked(outlineApi.get).mockImplementationOnce(() => new Promise((resolve) => { respond = resolve }))
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('button', { name: '근거 선택 변경' }))
  await act(async () => respond(generated))

  expect(applied).toHaveBeenLastCalledWith(false)
  expect(screen.getByRole('heading', { name: /첫 번째 목차/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: '근거 선택 닫기' })).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: '근거 선택 닫기' }))
  vi.mocked(outlineApi.get).mockResolvedValueOnce(generated)
  fireEvent.click(trigger)
  await screen.findByRole('heading', { name: /생성한 목차/ })
  expect(applied).toHaveBeenLastCalledWith(true)
})
