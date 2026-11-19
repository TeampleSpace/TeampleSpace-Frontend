// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import MaterialsPage from './MaterialsPage.tsx'
import { projectsApi } from '../projects/api.ts'
import type { Project } from '../projects/model.ts'
import { SessionContext } from '../auth/sessionContext.ts'
import type { AuthCapabilities, User } from '../auth/model.ts'
import capabilitiesExample from '../../../contracts/examples/capabilities.json'
import { createMaterialsMock } from '../../mocks/materials.ts'
import type { MaterialsMock } from '../../mocks/materials.ts'
import { sha256Hex } from './upload.ts'

// 화면은 실제 요청 클라이언트를 쓰고 전송만 자료 모킹 서버로 바꾼다. 실제 파일 처리와 서버 연동 검증이 아니다
vi.mock('../projects/api.ts', () => ({ projectsApi: { get: vi.fn() } }))

let mock: MaterialsMock
const capabilities = capabilitiesExample as AuthCapabilities

function mount() {
  const project: Project = { id: mock.projectId, name: '캠퍼스 친환경 전환', topic: null, presentationConstraints: null,
    ownerId: mock.ownerId, version: 1, memberCount: 2, createdAt: '2026-11-18T00:00:00Z', updatedAt: '2026-11-18T00:00:00Z' }
  vi.mocked(projectsApi.get).mockResolvedValue(project)
  const user: User = { id: mock.ownerId, name: '팀원 1', email: null, canEmailReauth: false, consentVersions: {},
    ownedProjectCount: 1, onboardingStatus: 'completed', identities: [], version: 1 }
  const session = { user, setUser: vi.fn(), refresh: vi.fn(), capabilities, loading: false, error: undefined }
  const router = createMemoryRouter([{ element: <SessionContext value={session}><Outlet context={{ setCurrentProject: vi.fn() }} /></SessionContext>, children: [
    { path: '/', element: <p>프로젝트 목록</p> },
    { path: '/projects/:projectId/materials', element: <MaterialsPage /> },
  ] }], { initialEntries: [`/projects/${mock.projectId}/materials`] })
  render(<RouterProvider router={router} />)
  return router
}
const pdf = (name = '교내 일회용품 조사.pdf', text = '%PDF-1.4 테스트 본문') => new File([text], name, { type: 'application/pdf' })
const calls = (match: string) => mock.calls.filter((call) => `${call.method} ${call.path}`.includes(match))
const dialog = () => within(screen.getByRole('dialog', { name: /자료 추가|메모 수정/ }))
async function openAdd(tab?: string) {
  fireEvent.click(await screen.findByRole('button', { name: '자료 추가' }))
  if (tab) fireEvent.click(dialog().getByRole('tab', { name: tab }))
}
const submit = (name = '자료 추가') => fireEvent.click(dialog().getByRole('button', { name }))

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
beforeEach(() => {
  vi.resetAllMocks()
  mock = createMaterialsMock()
  mock.faults.holdAnalysis = true
  mock.seed('memo', '기존 메모')
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => mock.fetchAs(mock.ownerId)(input, init))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test('PDF 전송 전 파일 내용의 SHA-256 값을 계산한다', async () => {
  expect(await sha256Hex(new File(['abc'], 'checksum.pdf', { type: 'application/pdf' })))
    .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('PDF는 준비, 전송, 등록을 차례로 하고 전송에는 발급받은 헤더만 싣는다', async () => {
  mount()
  await openAdd()
  expect(dialog().getByRole('button', { name: '자료 추가' })).toHaveProperty('disabled', true)
  const file = pdf()
  fireEvent.change(dialog().getByLabelText('PDF 파일'), { target: { files: [file] } })
  expect(dialog().getByText('교내 일회용품 조사.pdf')).toBeTruthy()
  submit(); submit()
  // 등록이 끝나면 모달을 닫고 새 자료를 처리 중으로 보여 준다
  expect(await screen.findByText('자료를 정리하고 있어요')).toBeTruthy()
  expect(screen.queryByRole('dialog', { name: '자료 추가' })).toBeNull()
  const [prepare] = calls('POST /v1/projects')
  expect(prepare.body).toMatchObject({ kind: 'material_pdf', fileName: file.name, mimeType: 'application/pdf', sizeBytes: file.size })
  expect((prepare.body as { checksumSha256: string }).checksumSha256).toMatch(/^[0-9a-f]{64}$/)
  const [sent] = calls('PUT /v1/storage/uploads/')
  expect(sent.headers).toEqual({ 'content-type': 'application/pdf' })
  // 두 번 눌러도 한 번만 보낸다
  expect(calls('/uploads')).toHaveLength(2)
  expect(calls('/materials/file')).toHaveLength(1)
  expect(calls('/materials/file')[0].key).toBeTruthy()
  expect(mock.count()).toBe(2)
})

test('등록 응답을 못 받으면 파일을 다시 올리지 않고 같은 키로 다시 등록한다', async () => {
  mount()
  await openAdd()
  fireEvent.change(dialog().getByLabelText('PDF 파일'), { target: { files: [pdf()] } })
  mock.faults.dropNextResponse = '/materials/file'
  submit()
  const failure = within(await screen.findByRole('dialog', { name: '자료를 추가하지 못했어요' }))
  expect(failure.getByText('선택한 자료와 입력 내용은 유지됩니다.')).toBeTruthy()
  fireEvent.click(failure.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByText('자료를 정리하고 있어요')).toBeTruthy()
  const registrations = calls('/materials/file')
  expect(registrations).toHaveLength(2)
  expect(registrations[0].key).toBe(registrations[1].key)
  expect(registrations[0].body).toEqual(registrations[1].body)
  expect(calls('PUT /v1/storage/uploads/')).toHaveLength(1)
  expect(mock.count()).toBe(2)
})

test('업로드 실패는 다시 올리고 분석 실패는 자료에 남아 따로 안내한다', async () => {
  mount()
  await openAdd()
  fireEvent.change(dialog().getByLabelText('PDF 파일'), { target: { files: [pdf()] } })
  mock.faults.failNext = { match: 'PUT /v1/storage/uploads/', code: 'FILE_URL_EXPIRED' }
  submit()
  const failure = within(await screen.findByRole('dialog', { name: '자료를 추가하지 못했어요' }))
  expect(failure.getByText(/업로드 주소가 만료됐어요/)).toBeTruthy()
  expect(mock.count()).toBe(1)
  // 업로드를 못 쓰게 됐으면 준비부터 다시 한다
  mock.faults.holdAnalysis = false
  mock.faults.failAnalysisCode = 'MATERIAL_UNREADABLE'
  fireEvent.click(failure.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByText('자료를 분석하지 못했어요')).toBeTruthy()
  expect(screen.getByText(/파일을 읽을 수 없어요/)).toBeTruthy()
  expect(calls('POST /v1/projects').filter((call) => call.path.endsWith('/uploads'))).toHaveLength(2)
  expect(mock.count()).toBe(2)
})

test('PDF가 아니거나 허용 크기를 넘는 파일은 올리기 전에 막는다', async () => {
  mount()
  await openAdd()
  const input = dialog().getByLabelText('PDF 파일')
  fireEvent.change(input, { target: { files: [new File(['text'], '메모.txt', { type: 'text/plain' })] } })
  expect(dialog().getByText('PDF 파일만 올릴 수 있어요')).toBeTruthy()
  expect(dialog().getByRole('button', { name: '자료 추가' })).toHaveProperty('disabled', true)
  const big = pdf('큰 파일.pdf')
  Object.defineProperty(big, 'size', { value: 20 * 1024 * 1024 + 1 })
  fireEvent.change(input, { target: { files: [big] } })
  expect(dialog().getByText('파일이 20.0 MB를 넘어요')).toBeTruthy()
  expect(calls('/uploads')).toHaveLength(0)
})

test('링크는 실패해도 입력을 남기고 결과를 모르는 재시도는 같은 키로 보낸다', async () => {
  mount()
  await openAdd('링크')
  const url = dialog().getByLabelText('링크 주소') as HTMLInputElement
  fireEvent.change(url, { target: { value: 'ftp://example.com/file' } })
  submit()
  expect(dialog().getByText('http나 https로 시작하는 전체 주소를 입력해 주세요')).toBeTruthy()
  fireEvent.change(url, { target: { value: 'https://example.com/campus-reuse' } })
  fireEvent.change(dialog().getByLabelText('팀에 남길 설명 · 선택'), { target: { value: '운영 사례 확인' } })
  mock.faults.dropNextResponse = '/materials/link'
  submit()
  const failure = within(await screen.findByRole('dialog', { name: '자료를 추가하지 못했어요' }))
  fireEvent.click(failure.getByRole('button', { name: '링크 다시 입력' }))
  expect(url.value).toBe('https://example.com/campus-reuse')
  expect((dialog().getByLabelText('팀에 남길 설명 · 선택') as HTMLInputElement).value).toBe('운영 사례 확인')
  submit()
  expect(await screen.findByRole('link', { name: 'https://example.com/campus-reuse' })).toBeTruthy()
  expect(screen.getByText('운영 사례 확인')).toBeTruthy()
  const sent = calls('/materials/link')
  expect(sent).toHaveLength(2)
  expect(sent[0].key).toBe(sent[1].key)
  expect(mock.count()).toBe(2)
})

test('서버가 거절한 링크 주소는 입력란에 알리고 입력을 남긴다', async () => {
  mount()
  await openAdd('링크')
  fireEvent.change(dialog().getByLabelText('링크 주소'), { target: { value: 'http://localhost/admin' } })
  submit()
  expect(await dialog().findByText('주소를 확인해 주세요.')).toBeTruthy()
  expect((dialog().getByLabelText('링크 주소') as HTMLInputElement).value).toBe('http://localhost/admin')
  expect(mock.count()).toBe(1)
})

test('메모를 쓰다가 유형을 바꾸면 확인하고 계속 작성하면 내용과 커서를 남긴다', async () => {
  mount()
  await openAdd('메모')
  fireEvent.change(dialog().getByLabelText('메모 제목'), { target: { value: '인터뷰 메모' } })
  const body = dialog().getByLabelText('메모 내용') as HTMLTextAreaElement
  fireEvent.change(body, { target: { value: '반납함이 멀다는 답이 많았다' } })
  // 작성과 미리보기 전환은 이탈로 보지 않는다
  fireEvent.click(dialog().getByRole('tab', { name: '미리보기' }))
  expect(await within(dialog().getByLabelText('미리보기')).findByText('반납함이 멀다는 답이 많았다')).toBeTruthy()
  fireEvent.click(dialog().getByRole('tab', { name: '작성' }))
  expect(body.value).toBe('반납함이 멀다는 답이 많았다')
  body.focus(); body.setSelectionRange(3, 5)
  fireEvent.blur(body)
  fireEvent.click(dialog().getByRole('tab', { name: '링크' }))
  const confirm = within(screen.getByRole('dialog', { name: '메모 작성을 중단할까요?' }))
  expect(confirm.getByText('저장하지 않은 메모는 사라집니다. 링크 추가로 이동할까요?')).toBeTruthy()
  fireEvent.click(confirm.getByRole('button', { name: '계속 작성' }))
  await waitFor(() => expect(document.activeElement).toBe(body))
  expect([body.selectionStart, body.selectionEnd]).toEqual([3, 5])
  expect((dialog().getByLabelText('메모 제목') as HTMLInputElement).value).toBe('인터뷰 메모')
  expect(dialog().getByRole('tab', { name: '메모' })).toHaveProperty('ariaSelected', 'true')
  // 닫을 때도 확인한다
  fireEvent.click(dialog().getByRole('button', { name: '취소' }))
  fireEvent.click(within(screen.getByRole('dialog', { name: '작성 중인 내용을 닫을까요?' })).getByRole('button', { name: '계속 작성' }))
  expect(body.value).toBe('반납함이 멀다는 답이 많았다')
  // 명시적으로 버릴 때만 지우고 옮긴다
  fireEvent.click(dialog().getByRole('tab', { name: '파일 업로드' }))
  fireEvent.click(within(screen.getByRole('dialog', { name: '메모 작성을 중단할까요?' })).getByRole('button', { name: '메모 버리고 이동' }))
  expect(dialog().getByRole('tab', { name: '파일 업로드' })).toHaveProperty('ariaSelected', 'true')
  fireEvent.click(dialog().getByRole('tab', { name: '메모' }))
  expect((dialog().getByLabelText('메모 내용') as HTMLTextAreaElement).value).toBe('')
  expect(mock.count()).toBe(1)
})

test('메모를 추가한 뒤 고치고 다른 사람과 충돌하면 고른 뒤에만 덮어쓴다', async () => {
  mount()
  await openAdd('메모')
  fireEvent.change(dialog().getByLabelText('메모 제목'), { target: { value: '회의 정리' } })
  fireEvent.change(dialog().getByLabelText('메모 내용'), { target: { value: '첫 내용' } })
  submit('메모 추가')
  await screen.findByRole('heading', { level: 2, name: '회의 정리' })
  expect(calls('/materials/memo')).toHaveLength(1)
  const id = mock.jobs().length === 0 ? [...mock.calls].reverse().find((call) => call.path.startsWith('/v1/materials/'))!.path.split('/')[3].split('?')[0] : ''
  fireEvent.click(screen.getByRole('button', { name: '자료 관리' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '내용 수정' }))
  const body = await screen.findByLabelText('메모 내용') as HTMLTextAreaElement
  expect(body.value).toBe('첫 내용')
  fireEvent.change(body, { target: { value: '내가 고친 내용' } })
  mock.renameAs(id, '팀원이 바꾼 제목')
  submit('저장')
  expect(await dialog().findByText(/다른 팀원이 먼저 수정했어요/)).toBeTruthy()
  expect(body.value).toBe('내가 고친 내용')
  expect(mock.get(id)?.revisions).toHaveLength(1)
  fireEvent.click(dialog().getByRole('button', { name: '내 내용으로 저장' }))
  await waitFor(() => expect(mock.get(id)?.revisions).toHaveLength(2))
  expect(mock.get(id)?.revisions.at(-1)?.markdown).toBe('내가 고친 내용')
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '메모 수정' })).toBeNull())
})
