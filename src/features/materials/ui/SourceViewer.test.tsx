// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import MaterialsPage from './MaterialsPage.tsx'
import { SourceViewer } from './SourceViewer.tsx'
import { projectsApi } from '../../projects/api.ts'
import type { Project } from '../../projects/model.ts'
import { SessionContext } from '../../auth/sessionContext.ts'
import type { User } from '../../auth/model.ts'
import { createMaterialsMock } from '../../../mocks/materials.ts'
import type { MaterialsMock } from '../../../mocks/materials.ts'

// PDF.js는 테스트 환경에서 돌지 않아 문서 열기만 바꾼다. 실제 PDF 표시는 브라우저에서 확인한다
vi.mock('../../projects/api.ts', () => ({ projectsApi: { get: vi.fn() } }))
const pdf = vi.hoisted(() => ({ opened: [] as string[], failOpen: 0, failRender: 0, rendered: [] as number[] }))
vi.mock('../pdf.ts', () => ({
  openPdf: (url: string) => {
    pdf.opened.push(url)
    const document = {
      numPages: 3,
      getPage: async (page: number) => ({
        getViewport: () => ({ width: 100, height: 140 }),
        render: () => {
          const failed = pdf.failRender > 0 && (pdf.failRender -= 1) >= 0
          if (!failed) pdf.rendered.push(page)
          return { promise: failed ? Promise.reject(new Error('만료된 주소')) : Promise.resolve(), cancel() {} }
        },
      }),
    }
    const failed = pdf.failOpen > 0 && (pdf.failOpen -= 1) >= 0
    return { promise: failed ? Promise.reject(new Error('만료된 주소')) : Promise.resolve(document), destroy() {} }
  },
}))

const member = '0193a000-0000-7000-8000-0000000000d2'
let mock: MaterialsMock
let actor = ''

function mount(search = '') {
  const project: Project = { id: mock.projectId, name: '캠퍼스 친환경 전환', topic: null, presentationConstraints: null,
    ownerId: mock.ownerId, version: 1, memberCount: 2, createdAt: '2026-11-18T00:00:00Z', updatedAt: '2026-11-18T00:00:00Z' }
  vi.mocked(projectsApi.get).mockResolvedValue(project)
  const user: User = { id: actor, name: mock.names[actor], email: null, canEmailReauth: false, consentVersions: {},
    ownedProjectCount: 0, onboardingStatus: 'completed', identities: [], version: 1 }
  const session = { user, setUser: vi.fn(), refresh: vi.fn(), capabilities: null, loading: false, error: undefined }
  const router = createMemoryRouter([{ element: <SessionContext value={session}><Outlet context={{ setCurrentProject: vi.fn() }} /></SessionContext>, children: [
    { path: '/projects/:projectId/materials', element: <MaterialsPage /> },
  ] }], { initialEntries: [`/projects/${mock.projectId}/materials${search}`] })
  render(<RouterProvider router={router} />)
}
const viewer = () => within(screen.getByRole('dialog', { name: '자료 보기' }))
const sources = () => mock.calls.filter((call) => call.path.includes('/source'))
async function openViewer() {
  fireEvent.click(await screen.findByRole('button', { name: '원문 보기' }))
  return viewer()
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
beforeEach(() => {
  vi.resetAllMocks()
  Object.assign(pdf, { opened: [], failOpen: 0, failRender: 0, rendered: [] })
  mock = createMaterialsMock()
  actor = mock.ownerId
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => mock.fetchAs(actor)(input, init))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test('PDF 파일은 열려도 그리기에 계속 실패하면 자동 재발급은 한 번으로 제한한다', async () => {
  mock.seed('file', '손상된 보고서.pdf')
  pdf.failRender = 5
  mount()
  const popup = await openViewer()
  expect(await popup.findByRole('button', { name: '원문 다시 불러오기' })).toBeTruthy()
  expect(sources()).toHaveLength(2)
  expect(pdf.opened).toHaveLength(2)
})

test('재발급된 주소가 같아도 PDF를 다시 열고 보던 쪽을 복원한다', async () => {
  mock.seed('file', '동일 주소 보고서.pdf')
  pdf.failOpen = 1
  const inner = mock.fetchAs(actor)
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await inner(input, init)
    if (String(input).includes('/source') && response.ok) {
      const value = await response.json()
      value.file.url = '/same-pdf-url'
      return new Response(JSON.stringify(value), { status: 200, headers: response.headers })
    }
    return response
  })
  mount()
  const popup = await openViewer()
  expect(await popup.findByText('PDF · 1쪽 / 3쪽')).toBeTruthy()
  expect(sources()).toHaveLength(2)
  expect(pdf.opened).toEqual(['/same-pdf-url', '/same-pdf-url'])
})

test('PDF 원문은 실제 쪽수로 이전과 다음을 정하고 전체 보기에서 한 단계씩 돌아온다', async () => {
  mock.seed('file', '교내 일회용품 조사.pdf', { pageCount: 6 })
  mount()
  const popup = await openViewer()
  // 서버가 알려 준 쪽수보다 실제 문서의 쪽수를 따른다
  expect(await popup.findByText('PDF · 1쪽 / 3쪽')).toBeTruthy()
  expect(popup.getByRole('button', { name: '이전 쪽' })).toHaveProperty('disabled', true)
  await waitFor(() => expect(pdf.rendered).toEqual([1]))
  fireEvent.click(popup.getByRole('button', { name: '다음 쪽' }))
  await waitFor(() => expect(pdf.rendered).toEqual([1, 2]))
  fireEvent.click(popup.getByRole('button', { name: '다음 쪽' }))
  expect(popup.getByText('PDF · 3쪽 / 3쪽')).toBeTruthy()
  expect(popup.getByRole('button', { name: '다음 쪽' })).toHaveProperty('disabled', true)
  await waitFor(() => expect(pdf.rendered).toEqual([1, 2, 3]))
  // 전체 보기는 원문 팝업 위에 열리고 보던 쪽을 이어 간다
  fireEvent.click(popup.getByRole('button', { name: '전체 PDF 보기' }))
  const full = within(screen.getByRole('dialog', { name: 'PDF 전체 보기' }))
  expect(full.getByText('3 / 3쪽')).toBeTruthy()
  fireEvent.click(full.getByRole('button', { name: '이전 페이지' }))
  expect(full.getByText('2 / 3쪽')).toBeTruthy()
  // 닫으면 원문 팝업으로, 다시 닫으면 자료 화면으로 돌아간다
  fireEvent.click(full.getByRole('button', { name: '이전 화면으로 돌아가기' }))
  expect(screen.queryByRole('dialog', { name: 'PDF 전체 보기' })).toBeNull()
  expect(viewer().getByText('PDF · 2쪽 / 3쪽')).toBeTruthy()
  fireEvent.click(viewer().getByRole('button', { name: '이전 화면으로 돌아가기' }))
  expect(screen.queryByRole('dialog', { name: '자료 보기' })).toBeNull()
  expect(screen.getByRole('heading', { level: 2, name: '교내 일회용품 조사.pdf' })).toBeTruthy()
  expect(pdf.opened).toHaveLength(1)
})

test('원문 주소가 만료되면 다시 발급받고 보던 쪽을 유지한다', async () => {
  mock.seed('file', '보고서.pdf')
  mount()
  const popup = await openViewer()
  await popup.findByText('PDF · 1쪽 / 3쪽')
  fireEvent.click(popup.getByRole('button', { name: '다음 쪽' }))
  await waitFor(() => expect(pdf.rendered).toEqual([1, 2]))
  // 다음 쪽을 읽다가 주소가 만료된다
  pdf.failRender = 1
  fireEvent.click(popup.getByRole('button', { name: '다음 쪽' }))
  await waitFor(() => expect(sources()).toHaveLength(2))
  await waitFor(() => expect(pdf.rendered).toEqual([1, 2, 3]))
  expect(pdf.opened).toHaveLength(2)
  expect(popup.getByText('PDF · 3쪽 / 3쪽')).toBeTruthy()
  // 같은 개정의 원문을 다시 요청한다
  expect(sources()[1].path).toContain('revisionId=')
})

test('다시 받은 주소도 실패하면 반복하지 않고 다시 시도하게 한다', async () => {
  mock.seed('file', '보고서.pdf')
  pdf.failOpen = 2
  mount()
  const popup = await openViewer()
  expect(await popup.findByRole('button', { name: '원문 다시 불러오기' })).toBeTruthy()
  expect(sources()).toHaveLength(2)
  fireEvent.click(popup.getByRole('button', { name: '원문 다시 불러오기' }))
  expect(await popup.findByText('PDF · 1쪽 / 3쪽')).toBeTruthy()
})

test('원문이 삭제되면 보던 내용을 가리고 안내한다', async () => {
  const id = mock.seed('file', '보고서.pdf')
  mount()
  const popup = await openViewer()
  await popup.findByText('PDF · 1쪽 / 3쪽')
  mock.get(id)!.deleted = true
  pdf.failRender = 1
  fireEvent.click(popup.getByRole('button', { name: '다음 쪽' }))
  expect(await popup.findByText('자료가 삭제됐어요. 보던 내용은 더 이상 표시하지 않아요.')).toBeTruthy()
  expect(popup.queryByRole('img')).toBeNull()
  expect(popup.queryByRole('button', { name: '전체 PDF 보기' })).toBeNull()
})

test('접근 권한이 사라지면 원문과 자료 화면을 함께 가린다', async () => {
  mock.seed('file', '보고서.pdf', { createdBy: member })
  actor = member
  mount()
  const popup = await openViewer()
  await popup.findByText('PDF · 1쪽 / 3쪽')
  mock.removeMember(member)
  pdf.failRender = 1
  fireEvent.click(popup.getByRole('button', { name: '다음 쪽' }))
  expect(await screen.findByText('이 프로젝트에 더 이상 접근할 수 없습니다')).toBeTruthy()
  expect(screen.queryByRole('dialog', { name: '자료 보기' })).toBeNull()
  expect(screen.queryByText('보고서.pdf')).toBeNull()
})

test('마크다운과 링크 자료는 원문 팝업에서 본문을 보여 준다', async () => {
  const link = mock.seed('link', '감축 사례', { text: '여러 대학이 반납함을 늘렸다.' })
  mock.seed('memo', '인터뷰 메모', { createdBy: member, markdown: '## 확인한 점\n\n- 반납함이 멀다' })
  mount()
  const popup = await openViewer()
  expect(await popup.findByRole('heading', { level: 2, name: '확인한 점' })).toBeTruthy()
  expect(popup.getByText('메모 · 팀원 2 님 작성 · 개정 1')).toBeTruthy()
  expect(popup.queryByRole('button', { name: '전체 PDF 보기' })).toBeNull()
  fireEvent.click(popup.getByRole('button', { name: '닫기' }))
  cleanup()
  mount(`?material=${link}`)
  const next = await openViewer()
  expect(await next.findByText('여러 대학이 반납함을 늘렸다.')).toBeTruthy()
  expect(next.getByRole('link', { name: 'https://example.com/reuse-cup' })).toBeTruthy()
})

test('고정된 개정이 있으면 최신 메모 대신 연결 당시 원문을 조회한다', async () => {
  const id = mock.seed('memo', '회의 메모', { markdown: '연결 당시 메모' })
  const material = mock.get(id)!
  const previous = material.revisions[0]
  material.revisions.push({ ...previous, id: crypto.randomUUID(), sourceVersion: 2, markdown: '새로운 메모' })

  render(<SourceViewer material={{ id, title: material.title }} revisionId={previous.id} onClose={vi.fn()} onError={vi.fn()} />)

  expect(await viewer().findByText('연결 당시 메모')).toBeTruthy()
  expect(viewer().queryByText('새로운 메모')).toBeNull()
  expect(sources()[0].path).toContain(`revisionId=${previous.id}`)
})

test('처리 중이거나 실패한 자료에는 원문 보기를 두지 않는다', async () => {
  mock.faults.holdAnalysis = true
  mock.seed('file', '보고서.pdf', { status: 'processing' })
  mount()
  await screen.findByText('PDF 본문을 추출하고 있어요.')
  expect(screen.queryByRole('button', { name: '원문 보기' })).toBeNull()
})
