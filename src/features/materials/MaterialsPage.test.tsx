// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import MaterialsPage from './MaterialsPage.tsx'
import { projectsApi } from '../projects/api.ts'
import type { Project } from '../projects/model.ts'
import { SessionContext } from '../auth/sessionContext.ts'
import type { User } from '../auth/model.ts'
import { createMaterialsMock } from '../../mocks/materials.ts'
import type { MaterialsMock } from '../../mocks/materials.ts'

// 화면은 실제 요청 클라이언트를 쓰고 전송만 자료 모킹 서버로 바꾼다. 실제 서버 연동 검증이 아니다
vi.mock('../projects/api.ts', () => ({ projectsApi: { get: vi.fn() } }))

const member = '0193a000-0000-7000-8000-0000000000d2'
let mock: MaterialsMock
let actor = ''
const setCurrentProject = vi.fn()
const user = (id: string): User => ({ id, name: mock.names[id], email: null, canEmailReauth: false, consentVersions: {},
  ownedProjectCount: 0, onboardingStatus: 'completed', identities: [], version: 1 })

function mount(search = '') {
  const project: Project = { id: mock.projectId, name: '캠퍼스 친환경 전환', topic: null, presentationConstraints: null,
    ownerId: mock.ownerId, version: 1, memberCount: 2, createdAt: '2026-11-18T00:00:00Z', updatedAt: '2026-11-18T00:00:00Z' }
  vi.mocked(projectsApi.get).mockResolvedValue(project)
  const session = { user: user(actor), setUser: vi.fn(), refresh: vi.fn(), capabilities: null, loading: false, error: undefined }
  const router = createMemoryRouter([{ element: <SessionContext value={session}><Outlet context={{ setCurrentProject }} /></SessionContext>, children: [
    { path: '/', element: <p>프로젝트 목록</p> },
    { path: '/projects/:projectId/materials', element: <MaterialsPage /> },
  ] }], { initialEntries: [`/projects/${mock.projectId}/materials${search}`] })
  render(<RouterProvider router={router} />)
  return router
}
const row = (title: string) => screen.findByRole('link', { name: new RegExp(title) })
const detailTitle = (title: string) => screen.findByRole('heading', { level: 2, name: title })
async function manage(action: string) {
  fireEvent.click(await screen.findByRole('button', { name: '자료 관리' }))
  fireEvent.click(screen.getByRole('menuitem', { name: action }))
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
beforeEach(() => {
  vi.resetAllMocks()
  mock = createMaterialsMock()
  actor = mock.ownerId
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => mock.fetchAs(actor)(input, init))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

test('목록과 유형별 개수, 선택한 자료의 작성자와 출처, 발췌를 보여 준다', async () => {
  mock.seed('file', '교내 일회용품 조사.pdf', { text: '반납 장소까지의 거리가 영향을 주었다.', pageCount: 6 })
  mock.seed('link', '감축 사례', { createdBy: member, description: '함께 볼 사례' })
  mock.seed('memo', '다회용컵 인터뷰', { createdBy: member, markdown: '반납함이 멀다' })
  mount()
  const filters = within(await screen.findByRole('navigation', { name: '자료 유형' }))
  expect(filters.getByRole('link', { name: '전체 3' })).toHaveProperty('ariaCurrent', 'true')
  expect(filters.getByRole('link', { name: 'PDF 1' })).toBeTruthy()
  // 주소에 선택이 없으면 가장 최근 자료를 보여 준다
  await detailTitle('다회용컵 인터뷰')
  expect(screen.getByText(/메모 · 팀원 2 님이 추가/)).toBeTruthy()
  fireEvent.click(await row('교내 일회용품 조사.pdf'))
  await detailTitle('교내 일회용품 조사.pdf')
  expect(screen.getByText(/PDF · 6쪽 · 팀원 1 님이 추가/)).toBeTruthy()
  expect(screen.getByText('분석 완료')).toBeTruthy()
  expect(screen.getByText('반납 장소까지의 거리가 영향을 주었다.')).toBeTruthy()
  // 요약이 없으면 핵심 요약 영역을 숨긴다
  expect(screen.queryByText('핵심 요약')).toBeNull()
  fireEvent.click(await row('감축 사례'))
  expect(await screen.findByRole('link', { name: 'https://example.com/reuse-cup' })).toBeTruthy()
  expect(screen.getByText('함께 볼 사례')).toBeTruthy()
  // 유형 필터는 주소에 남는다
  fireEvent.click(filters.getByRole('link', { name: '메모 1' }))
  await waitFor(() => expect(screen.queryByRole('link', { name: /감축 사례/ })).toBeNull())
  expect(await row('다회용컵 인터뷰')).toBeTruthy()
})

test('자료가 없는 프로젝트와 검색 결과가 없는 경우를 구분한다', async () => {
  const view = mount()
  expect(await screen.findByRole('heading', { name: '첫 자료를 모아볼까요?' })).toBeTruthy()
  cleanup()
  mock.seed('memo', '회의록')
  view.dispose()
  mount('?q=%ED%83%84%EC%86%8C%EC%A4%91%EB%A6%BD')
  expect(await screen.findByText('‘탄소중립’에 대한 자료가 없어요')).toBeTruthy()
  expect(screen.getByText('검색 결과 0개')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '검색 지우기' }))
  expect(await row('회의록')).toBeTruthy()
})

test('이전 검색의 늦은 응답이 새 검색 결과를 덮지 않는다', async () => {
  mock.seed('memo', '가나다 회의록')
  mock.seed('memo', '라마바 인터뷰')
  // 첫 검색의 응답만 늦게 돌려준다
  const inner = mock.fetchAs(actor)
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await inner(input, init)
    if (String(input).includes(`q=${encodeURIComponent('가나다')}`)) await new Promise((resolve) => setTimeout(resolve, 700))
    return response
  })
  const router = mount()
  const input = await screen.findByRole('searchbox', { name: '자료 검색' })
  fireEvent.change(input, { target: { value: '가나다' } })
  await waitFor(() => expect(router.state.location.search).toContain(encodeURIComponent('가나다')))
  fireEvent.change(input, { target: { value: '라마바' } })
  await waitFor(() => expect(router.state.location.search).toContain(encodeURIComponent('라마바')))
  expect(await row('라마바 인터뷰')).toBeTruthy()
  await new Promise((resolve) => setTimeout(resolve, 800))
  expect(screen.queryByRole('link', { name: /가나다 회의록/ })).toBeNull()
  expect(screen.getByRole('link', { name: /라마바 인터뷰/ })).toBeTruthy()
  // 검색어 입력은 기록을 쌓지 않는다
  expect(router.state.historyAction).toBe('REPLACE')
})

test('처리 중인 자료는 다시 조회해 상태를 바꾸고 화면을 다시 만들지 않는다', async () => {
  mock.faults.holdAnalysis = true
  mock.seed('file', '보고서.pdf', { status: 'processing' })
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  mount()
  const title = await detailTitle('보고서.pdf')
  expect(screen.getByText('자료를 정리하고 있어요')).toBeTruthy()
  expect(screen.getAllByText('처리 중').length).toBeGreaterThan(0)
  mock.faults.holdAnalysis = false
  await vi.advanceTimersByTimeAsync(2100)
  expect(await screen.findByText('분석 완료')).toBeTruthy()
  expect(screen.queryByText('자료를 정리하고 있어요')).toBeNull()
  // 같은 요소가 그대로 남아 진입 애니메이션이 다시 재생되지 않는다
  expect(screen.getByRole('heading', { level: 2, name: '보고서.pdf' })).toBe(title)
})

test('분석 실패는 파일을 다시 올리지 않고 같은 키로 다시 시도한다', async () => {
  mock.faults.failAnalysisCode = 'ANALYSIS_FAILED'
  mock.seed('file', '보고서.pdf', { status: 'processing' })
  mount()
  expect(await screen.findByText('자료를 분석하지 못했어요')).toBeTruthy()
  expect(screen.getByText(/올린 파일은 그대로 있어요/)).toBeTruthy()
  // 반영은 되고 응답만 잃은 뒤 다시 누른다
  mock.faults.holdAnalysis = true
  mock.faults.dropNextResponse = '/reprocess'
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByText(/서버에 연결할 수 없습니다/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByText('자료를 정리하고 있어요')).toBeTruthy()
  const retries = mock.calls.filter((call) => call.path.endsWith('/reprocess'))
  expect(retries).toHaveLength(2)
  expect(retries[0].key).toBe(retries[1].key)
  expect(mock.jobs()).toHaveLength(2)
  expect(mock.calls.some((call) => call.path.includes('/uploads'))).toBe(false)
})

test('이름 변경이 충돌하면 입력을 남기고 최신 정보를 확인한 뒤 다시 저장한다', async () => {
  const id = mock.seed('memo', '회의록')
  mount()
  await detailTitle('회의록')
  await manage('이름 변경')
  const input = screen.getByLabelText('자료 이름') as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: '3차 회의록' } })
  mock.renameAs(id, '다른 팀원이 바꾼 이름')
  // 한글 조합 중의 Enter는 저장하지 않는다
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  expect(mock.calls.some((call) => call.method === 'PATCH')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(await screen.findByText(/다른 곳에서 내용이 변경되었습니다/)).toBeTruthy()
  expect(input.value).toBe('3차 회의록')
  fireEvent.click(screen.getByRole('button', { name: '최신 정보 확인' }))
  await detailTitle('다른 팀원이 바꾼 이름')
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await detailTitle('3차 회의록')
  expect(mock.get(id)?.title).toBe('3차 회의록')
})

test('삭제는 소유자와 작성자만 할 수 있고 삭제하면 목록에서 사라진다', async () => {
  const owned = mock.seed('memo', '소유자의 메모')
  mock.seed('memo', '팀원의 메모', { createdBy: member })
  actor = member
  mount(`?material=${owned}`)
  await detailTitle('소유자의 메모')
  fireEvent.click(screen.getByRole('button', { name: '자료 관리' }))
  expect(screen.getByRole('menuitem', { name: '삭제' })).toHaveProperty('disabled', true)
  expect(screen.getByText('소유자와 자료를 추가한 사람만 삭제할 수 있어요')).toBeTruthy()
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  // 자기가 추가한 자료는 지울 수 있다
  fireEvent.click(await row('팀원의 메모'))
  await detailTitle('팀원의 메모')
  await manage('삭제')
  fireEvent.click(screen.getByRole('button', { name: '삭제' }))
  await waitFor(() => expect(screen.queryByRole('link', { name: /팀원의 메모/ })).toBeNull())
  await detailTitle('소유자의 메모')
  expect(mock.count()).toBe(1)
})

test('서버가 삭제를 거절하면 이유를 알리고 자료를 남긴다', async () => {
  const id = mock.seed('memo', '회의록')
  mount()
  await detailTitle('회의록')
  await manage('삭제')
  mock.faults.failNext = { match: 'DELETE /v1/materials', code: 'FORBIDDEN' }
  fireEvent.click(screen.getByRole('button', { name: '삭제' }))
  expect(await screen.findByText('프로젝트 소유자와 이 자료를 추가한 사람만 삭제할 수 있어요')).toBeTruthy()
  expect(mock.get(id)?.deleted).toBe(false)
})

test('팀 메모는 충돌해도 내 입력을 남기고 선택한 뒤에만 덮어쓴다', async () => {
  const id = mock.seed('file', '보고서.pdf')
  mount()
  fireEvent.click(await screen.findByRole('button', { name: '메모 작성' }))
  const input = screen.getByLabelText('팀 메모 내용') as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: '내가 쓴 메모' } })
  mock.saveNoteAs(id, member, '팀원이 먼저 쓴 메모')
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(await screen.findByText('팀원 2님이 먼저 저장했어요. 내 입력은 그대로 있어요')).toBeTruthy()
  expect(screen.getByText('팀원이 먼저 쓴 메모')).toBeTruthy()
  expect(input.value).toBe('내가 쓴 메모')
  expect(mock.get(id)?.note.markdown).toBe('팀원이 먼저 쓴 메모')
  fireEvent.click(screen.getByRole('button', { name: '내 내용으로 저장' }))
  expect(await screen.findByRole('button', { name: '메모 수정' })).toBeTruthy()
  expect(mock.get(id)?.note).toMatchObject({ markdown: '내가 쓴 메모', version: 2 })
  expect(await screen.findByText('내가 쓴 메모')).toBeTruthy()
})

test('팀 메모 저장 응답을 못 받아도 다시 읽어 같으면 저장된 것으로 본다', async () => {
  const id = mock.seed('file', '보고서.pdf')
  mount()
  fireEvent.click(await screen.findByRole('button', { name: '메모 작성' }))
  fireEvent.change(screen.getByLabelText('팀 메모 내용'), { target: { value: '한 번만 저장할 메모' } })
  mock.faults.dropNextResponse = 'PUT /v1/materials'
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(await screen.findByRole('button', { name: '메모 수정' })).toBeTruthy()
  expect(mock.get(id)?.note.version).toBe(1)
  expect(mock.calls.filter((call) => call.method === 'PUT')).toHaveLength(1)
})

test('팀 메모를 쓰는 중에는 다른 자료로 옮기기 전에 확인한다', async () => {
  mock.seed('memo', '첫 메모')
  mock.seed('memo', '둘째 메모')
  const router = mount()
  await detailTitle('둘째 메모')
  fireEvent.click(await screen.findByRole('button', { name: '메모 작성' }))
  const input = screen.getByLabelText('팀 메모 내용') as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: '저장하지 않은 메모' } })
  // 검색어를 바꾸는 것은 입력을 잃지 않으므로 막지 않는다
  fireEvent.change(screen.getByRole('searchbox', { name: '자료 검색' }), { target: { value: '메모' } })
  await waitFor(() => expect(router.state.location.search).toContain('q='))
  // 닫힌 확인 모달의 버튼은 접근성 트리에 없다
  expect(screen.queryByRole('button', { name: '계속 작성' })).toBeNull()
  fireEvent.click(await row('첫 메모'))
  fireEvent.click(await screen.findByRole('button', { name: '계속 작성' }))
  await detailTitle('둘째 메모')
  expect(input.value).toBe('저장하지 않은 메모')
  // 명시적으로 이동을 고르면 옮긴다
  fireEvent.click(await row('첫 메모'))
  fireEvent.click(await screen.findByRole('button', { name: '이동' }))
  await detailTitle('첫 메모')
})

test('접근 권한이 사라지면 기존 내용을 가리고 안내한다', async () => {
  mock.seed('memo', '비공개 회의록', { markdown: '팀만 보는 내용' })
  actor = member
  mount()
  await detailTitle('비공개 회의록')
  mock.removeMember(member)
  fireEvent(window, new Event('focus'))
  expect(await screen.findByText('이 프로젝트에 더 이상 접근할 수 없습니다')).toBeTruthy()
  expect(screen.queryByText('비공개 회의록')).toBeNull()
  expect(screen.queryByText('팀만 보는 내용')).toBeNull()
})

test('삭제된 자료의 주소로 들어오면 삭제됐다고 안내한다', async () => {
  const id = mock.seed('memo', '지운 메모')
  mock.seed('memo', '남은 메모')
  mock.get(id)!.deleted = true
  mount(`?material=${id}`)
  expect(await screen.findByText('삭제된 자료예요')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '자료 목록 보기' }))
  await detailTitle('남은 메모')
})
