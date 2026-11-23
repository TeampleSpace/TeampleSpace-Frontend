// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import MaterialsPage from './MaterialsPage.tsx'
import { materialsApi } from '../../../entities/material/api.ts'
import { projectsApi } from '../../../entities/project/api.ts'
import type { Project } from '../../../entities/project/model.ts'
import { SessionContext } from '../../../entities/session/sessionContext.ts'
import type { User } from '../../../entities/session/model.ts'
import { createMaterialsMock } from '../../../mocks/materials.ts'
import type { MaterialsMock } from '../../../mocks/materials.ts'

// 화면은 실제 요청 클라이언트를 쓰고 전송만 자료 모킹 서버로 바꾼다. 실제 서버 연동 검증이 아니다
vi.mock('../../../entities/project/api.ts', () => ({ projectsApi: { get: vi.fn() } }))

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

test('목록과 유형별 개수, 선택한 자료의 작성자와 출처, AI 요약 영역을 보여 준다', async () => {
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
  expect(screen.getByRole('heading', { name: 'AI 요약' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '원문 보기' })).toBeTruthy()
  expect(screen.queryByText('반납 장소까지의 거리가 영향을 주었다.')).toBeNull()
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
  expect(await screen.findByRole('heading', { name: '아직 자료가 없어요' })).toBeTruthy()
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
  expect(screen.getByText('PDF 본문을 추출하고 있어요.')).toBeTruthy()
  expect(screen.getAllByText('처리 중').length).toBeGreaterThan(0)
  mock.faults.holdAnalysis = false
  await vi.advanceTimersByTimeAsync(2100)
  expect(await screen.findByText('분석 완료')).toBeTruthy()
  expect(screen.queryByText('PDF 본문을 추출하고 있어요.')).toBeNull()
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
  expect(await screen.findByText('분석 대기 중')).toBeTruthy()
  expect(screen.queryByText('PDF 본문을 추출하고 있어요.')).toBeNull()
  const retries = mock.calls.filter((call) => call.path.endsWith('/reprocess'))
  expect(retries).toHaveLength(2)
  expect(retries[0].key).toBe(retries[1].key)
  expect(mock.jobs()).toHaveLength(2)
  expect(mock.calls.some((call) => call.path.includes('/uploads'))).toBe(false)
})

test('분석 취소 응답을 잃어도 작업을 조회해 취소를 확인하고 원본으로 다시 시도한다', async () => {
  mock.faults.holdAnalysis = true
  mock.seed('file', '취소할 보고서.pdf', { status: 'processing' })
  mount()
  mock.faults.dropNextResponse = '/cancel'
  fireEvent.click(await screen.findByRole('button', { name: '분석 취소' }))
  expect(await screen.findByText('분석을 취소했어요')).toBeTruthy()
  expect(mock.jobs()[0].status).toBe('canceled')
  expect(mock.calls.some((call) => call.method === 'GET' && call.path.includes('/jobs/'))).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByText('분석 대기 중')).toBeTruthy()
  expect(mock.jobs()).toHaveLength(2)
})

test('다른 팀원의 분석 취소 거절은 자료와 미저장 메모를 가리지 않는다', async () => {
  mock.faults.holdAnalysis = true
  mock.seed('file', '소유자의 보고서.pdf', { status: 'processing' })
  actor = member
  mount()
  fireEvent.click(await screen.findByRole('button', { name: '분석 취소' }))
  expect(await screen.findByText('이 작업을 할 권한이 없습니다')).toBeTruthy()
  expect(screen.getByRole('heading', { name: '소유자의 보고서.pdf' })).toBeTruthy()
  expect(mock.jobs()[0].status).toBe('running')
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

// 남긴 메모 목록에 보이는 본문 순서
function shownComments() {
  const list = screen.getByRole('list', { name: '남긴 메모' })
  return within(list).getAllByRole('listitem').map((item) => item.querySelector('p:last-of-type')?.textContent)
}

test('팀 메모는 댓글처럼 남기고 다른 팀원의 메모를 새로고침 없이 보여 주며 내 메모만 지운다', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const id = mock.seed('file', '보고서.pdf')
  mock.saveNoteAs(id, member, '예전에 함께 쓰던 메모')
  mock.commentAs(id, member, '12쪽 표를 2장에 넣어요')
  mount()
  expect(await screen.findByText('예전에 함께 쓰던 메모')).toBeTruthy()
  expect(screen.getByText(/이전 팀 메모/)).toBeTruthy()
  expect(await screen.findByText('12쪽 표를 2장에 넣어요')).toBeTruthy()
  const input = screen.getByLabelText('메모 남기기') as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: '  출처도 같이 적을게요  ' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(await screen.findByText('출처도 같이 적을게요')).toBeTruthy()
  expect(input.value).toBe('')
  expect(mock.get(id)?.comments.map((comment) => comment.body)).toEqual(['12쪽 표를 2장에 넣어요', '출처도 같이 적을게요'])

  // 다른 팀원이 남긴 메모가 새로고침 없이 나타난다
  mock.commentAs(id, member, '좋아요, 그렇게 해요')
  await vi.advanceTimersByTimeAsync(5000)
  expect(await screen.findByText('좋아요, 그렇게 해요')).toBeTruthy()

  // 내 메모에만 삭제가 있고 확인한 뒤에 지운다
  const comments = screen.getAllByRole('listitem').filter((item) => item.closest('[aria-label="남긴 메모"]'))
  expect(within(comments[0]).queryByRole('button', { name: '삭제' })).toBeNull()
  fireEvent.click(within(comments[1]).getByRole('button', { name: '삭제' }))
  fireEvent.click(within(comments[1]).getByRole('button', { name: '삭제' }))
  await waitFor(() => expect(screen.queryByText('출처도 같이 적을게요')).toBeNull())
  expect(mock.get(id)?.comments.find((comment) => comment.body === '출처도 같이 적을게요')?.deleted).toBe(true)
  vi.useRealTimers()
})

test('다른 팀원이 쓴 직후 내가 써도 그 사이 남의 메모를 건너뛰지 않고 더 보기 실패를 알린다', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const id = mock.seed('file', '보고서.pdf')
  mount()
  const input = await screen.findByLabelText('메모 남기기') as HTMLTextAreaElement
  // 다음 주기 조회 전에 팀원이 먼저 쓰고 이어서 내가 쓴다
  mock.commentAs(id, member, '팀원이 먼저 쓴 메모')
  fireEvent.change(input, { target: { value: '내가 이어서 쓴 메모' } })
  fireEvent.click(screen.getByRole('button', { name: '남기기' }))
  expect(await screen.findByText('내가 이어서 쓴 메모')).toBeTruthy()
  await vi.advanceTimersByTimeAsync(5000)
  expect(await screen.findByText('팀원이 먼저 쓴 메모')).toBeTruthy()
  // 나중에 읽었어도 먼저 쓴 메모가 앞에 온다
  expect(shownComments()).toEqual(['팀원이 먼저 쓴 메모', '내가 이어서 쓴 메모'])
  vi.useRealTimers()

  // 50개가 넘어 더 보기가 실패하면 이유를 보여 준다
  for (let index = 0; index < 51; index++) mock.commentAs(id, member, `쌓인 메모 ${index}`)
  cleanup()
  mount()
  // 남은 페이지를 읽기 전에 쓴 내 메모는 나중에 읽은 메모들보다 뒤에 둔다
  const next = await screen.findByLabelText('메모 남기기') as HTMLTextAreaElement
  fireEvent.change(next, { target: { value: '더 보기 전에 쓴 메모' } })
  fireEvent.click(screen.getByRole('button', { name: '남기기' }))
  expect(await screen.findByText('더 보기 전에 쓴 메모')).toBeTruthy()
  fireEvent.click(await screen.findByRole('button', { name: '메모 더 보기' }))
  await waitFor(() => expect(screen.getByText('쌓인 메모 50')).toBeTruthy())
  expect(screen.queryByRole('button', { name: '메모 더 보기' })).toBeNull()
  expect(shownComments().slice(-2)).toEqual(['쌓인 메모 50', '더 보기 전에 쓴 메모'])
})

test('다른 팀원이 지운 메모는 다음 조회에서 빠지고 내가 지운 메모는 늦게 온 조회 응답에도 다시 보이지 않는다', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const id = mock.seed('file', '보고서.pdf')
  mock.commentAs(id, member, '팀원이 지울 메모')
  mock.commentAs(id, mock.ownerId, '내가 지울 메모')
  mount()
  expect(await screen.findByText('팀원이 지울 메모')).toBeTruthy()
  mock.get(id)!.comments.find((comment) => comment.body === '팀원이 지울 메모')!.deleted = true
  await vi.advanceTimersByTimeAsync(5000)
  await waitFor(() => expect(screen.queryByText('팀원이 지울 메모')).toBeNull())

  // 지우기 전에 시작한 조회 응답이 삭제 응답보다 늦게 온다
  const stale = await materialsApi.comments(id)
  let release: () => void = () => {}
  vi.spyOn(materialsApi, 'comments').mockImplementationOnce(() => new Promise((done) => { release = () => done(stale) }))
  await vi.advanceTimersByTimeAsync(5000)
  const mine = screen.getAllByRole('listitem').find((item) => item.textContent?.includes('내가 지울 메모'))!
  fireEvent.click(within(mine).getByRole('button', { name: '삭제' }))
  fireEvent.click(within(mine).getByRole('button', { name: '삭제' }))
  await waitFor(() => expect(screen.queryByText('내가 지울 메모')).toBeNull())
  release()
  await vi.advanceTimersByTimeAsync(0)
  expect(screen.queryByText('내가 지울 메모')).toBeNull()
  vi.useRealTimers()
})

test('주기적으로 메모를 읽다가 접근 권한을 잃으면 자료와 메모를 가린다', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const id = mock.seed('file', '보고서.pdf')
  mock.commentAs(id, member, '가려야 할 메모')
  mount()
  expect(await screen.findByText('가려야 할 메모')).toBeTruthy()
  mock.faults.failNext = { match: `GET /v1/materials/${id}/comments`, code: 'ACCESS_DENIED' }
  await vi.advanceTimersByTimeAsync(5000)
  expect(await screen.findByText('이 프로젝트에 더 이상 접근할 수 없습니다')).toBeTruthy()
  expect(screen.queryByText('가려야 할 메모')).toBeNull()
  vi.useRealTimers()
})

test('메모 더 보기가 실패하면 목록 아래에 이유를 보여 준다', async () => {
  const id = mock.seed('file', '보고서.pdf')
  for (let index = 0; index < 51; index++) mock.commentAs(id, member, `쌓인 메모 ${index}`)
  mount()
  const more = await screen.findByRole('button', { name: '메모 더 보기' })
  mock.faults.failNext = { match: 'GET /v1/materials', code: 'SERVICE_UNAVAILABLE' }
  fireEvent.click(more)
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.getByRole('button', { name: '메모 더 보기' })).toBeTruthy()
})

test('메모 삭제 확인은 취소에 포커스를 두고 닫으면 원래 버튼이나 입력란으로 포커스를 돌려준다', async () => {
  const id = mock.seed('file', '보고서.pdf')
  mock.commentAs(id, mock.ownerId, '지울 메모')
  mount()
  await screen.findByText('지울 메모')
  const remove = screen.getByRole('button', { name: '삭제' })
  fireEvent.click(remove)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '취소' }))
  fireEvent.click(screen.getByRole('button', { name: '취소' }))
  await waitFor(() => expect(document.activeElement?.textContent).toBe('삭제'))
  fireEvent.click(screen.getByRole('button', { name: '삭제' }))
  fireEvent.click(screen.getAllByRole('button', { name: '삭제' })[0])
  await waitFor(() => expect(screen.queryByText('지울 메모')).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('메모 남기기')))
})

test('메모 전송 응답을 못 받으면 같은 키로 다시 보내 한 번만 남기고 한글 조합 중의 Enter로는 보내지 않는다', async () => {
  const id = mock.seed('file', '보고서.pdf')
  mount()
  const input = await screen.findByLabelText('메모 남기기') as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: '한 번만 남길 메모' } })
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  expect(mock.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/comments'))).toHaveLength(0)
  mock.faults.dropNextResponse = 'POST /v1/materials'
  fireEvent.click(screen.getByRole('button', { name: '남기기' }))
  fireEvent.click(await screen.findByRole('button', { name: '다시 보내기' }))
  expect(await screen.findByText('한 번만 남길 메모')).toBeTruthy()
  const posts = mock.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/comments'))
  expect(posts).toHaveLength(2)
  expect(mock.get(id)?.comments).toHaveLength(1)
})

test('팀 메모를 쓰는 중에는 다른 자료로 옮기기 전에 확인한다', async () => {
  mock.seed('memo', '첫 메모')
  mock.seed('memo', '둘째 메모')
  const router = mount()
  await detailTitle('둘째 메모')
  const input = await screen.findByLabelText('메모 남기기') as HTMLTextAreaElement
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

test.each([
  { code: 'MATERIAL_DELETED', status: 410, message: '삭제된 자료예요' },
  { code: 'NOT_FOUND', status: 404, message: '자료를 찾을 수 없어요' },
])('요약 확인 중 자료가 사라지면 $code 안내와 자료 목록 복귀를 보여 준다', async ({ code, status, message }) => {
  const id = mock.seed('memo', '요약 중인 회의록')
  mock.seed('memo', '남아 있는 회의록')
  const inner = mock.fetchAs(actor)
  let firstDetail = true
  let releasePoll = () => {}
  const waitForPoll = new Promise<void>((resolve) => { releasePoll = resolve })
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) !== `/v1/materials/${id}` || init?.method !== 'GET') return inner(input, init)
    if (!firstDetail) {
      await waitForPoll
      return Response.json({ error: { code, message, retryable: false }, requestId: 'summary_poll' }, { status })
    }
    firstDetail = false
    const material = await (await inner(input, init)).json()
    const summaryJob = { id: 'summary-job', projectId: mock.projectId, type: 'material_summary', targetType: 'material_summary',
      targetId: material.currentRevision.id, status: 'running', progress: 10, createdAt: material.createdAt, updatedAt: material.updatedAt }
    return Response.json({ ...material, summaryJob })
  })

  const router = mount(`?material=${id}`)
  await detailTitle('요약 중인 회의록')
  expect(await screen.findByText('AI 요약 중')).toBeTruthy()
  mock.get(id)!.deleted = true
  releasePoll()
  expect(await screen.findByText(message)).toBeTruthy()
  expect(screen.queryByRole('heading', { level: 2, name: '요약 중인 회의록' })).toBeNull()
  expect(screen.queryByText('AI 요약 중')).toBeNull()
  expect(screen.queryByRole('button', { name: '원문 보기' })).toBeNull()
  expect(screen.queryByRole('button', { name: '자료 관리' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '자료 목록 보기' }))
  await detailTitle('남아 있는 회의록')
  expect(router.state.location.search).toBe('')
  await waitFor(() => expect(screen.queryByRole('link', { name: /요약 중인 회의록/ })).toBeNull())
})

test('추가 페이지의 처리 중 자료도 갱신하고 더 이상 불필요하게 조회하지 않는다', async () => {
  mock.faults.holdAnalysis = true
  mock.seed('file', '오래된 분석 보고서.pdf', { status: 'processing' })
  for (let index = 0; index < 31; index++) mock.seed('memo', `새 메모 ${index}`)
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  mount()
  fireEvent.click(await screen.findByRole('button', { name: '더 보기' }))
  const target = await row('오래된 분석 보고서.pdf')
  expect(target.textContent).toContain('처리 중')
  mock.faults.holdAnalysis = false
  await vi.advanceTimersByTimeAsync(2100)
  await waitFor(() => expect(target.textContent).not.toContain('처리 중'))
  expect(screen.getAllByRole('link').filter((link) => link.textContent?.includes('새 메모'))).toHaveLength(31)
  // 팀 메모의 새 댓글 확인은 따로 주기적으로 읽으니 자료 요청만 센다
  const materialCalls = () => mock.calls.filter((call) => !call.path.includes('/comments'))
  const requests = materialCalls().length
  await vi.advanceTimersByTimeAsync(4200)
  expect(materialCalls()).toHaveLength(requests)
})

test('열어 둔 자료가 외부에서 삭제되면 복귀 시 본문과 편집 중인 메모를 가린다', async () => {
  const id = mock.seed('memo', '삭제될 회의록', { markdown: '더 이상 표시하면 안 되는 본문' })
  mount(`?material=${id}`)
  fireEvent.change(await screen.findByLabelText('메모 남기기'), { target: { value: '미저장 팀 메모' } })
  mock.get(id)!.deleted = true
  fireEvent(window, new Event('focus'))
  expect(await screen.findByText('삭제된 자료예요')).toBeTruthy()
  expect(screen.queryByText('더 이상 표시하면 안 되는 본문')).toBeNull()
  expect(screen.queryByLabelText('메모 남기기')).toBeNull()
  expect(screen.queryByRole('button', { name: '자료 관리' })).toBeNull()
})
