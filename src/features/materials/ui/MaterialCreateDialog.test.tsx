// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import MaterialsPage from './MaterialsPage.tsx'
import { projectsApi } from '../../../entities/project/api.ts'
import type { Project } from '../../../entities/project/model.ts'
import { SessionContext } from '../../../entities/session/sessionContext.ts'
import type { AuthCapabilities, User } from '../../../entities/session/model.ts'
import capabilitiesExample from '../../../../contracts/examples/capabilities.json'
import { createMaterialsMock } from '../../../mocks/materials.ts'
import type { MaterialsMock } from '../../../mocks/materials.ts'
import { sha256Hex } from '../upload.ts'

// 화면은 실제 요청 클라이언트를 쓰고 전송만 자료 모킹 서버로 바꾼다. 실제 파일 처리와 서버 연동 검증이 아니다
vi.mock('../../../entities/project/api.ts', () => ({ projectsApi: { get: vi.fn() } }))
vi.mock('./MarkdownEditor.tsx', () => import('./MarkdownEditor.double.tsx'))

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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

test('PDF 전송 전 파일 내용의 SHA-256 값을 계산한다', async () => {
  expect(await sha256Hex(new File(['abc'], 'checksum.pdf', { type: 'application/pdf' })))
    .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

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
  expect(await screen.findByText('PDF 본문을 추출하고 있어요.')).toBeTruthy()
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

test.each([false, true])('등록 응답 유실 뒤 업로드 만료 여부 %s에서도 같은 키로 결과를 확인한다', async (expired) => {
  mount()
  await openAdd()
  fireEvent.change(dialog().getByLabelText('PDF 파일'), { target: { files: [pdf()] } })
  mock.faults.dropNextResponse = '/materials/file'
  submit()
  const failure = within(await screen.findByRole('dialog', { name: '자료를 추가하지 못했어요' }))
  expect(failure.getByText('선택한 자료와 입력 내용은 유지됩니다.')).toBeTruthy()
  if (expired) vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 24 * 60 * 60 * 1000)
  fireEvent.click(failure.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByText('PDF 본문을 추출하고 있어요.')).toBeTruthy()
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
  expect((await screen.findByRole('link', { name: /^example\.com 원본 페이지 열기/ })).getAttribute('href')).toBe('https://example.com/campus-reuse')
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

test('메모를 추가하면 상세에서 바로 고쳐 자동 저장하고 다른 사람과 충돌하면 고른 뒤에만 덮어쓴다', async () => {
  mount()
  await openAdd('메모')
  fireEvent.change(dialog().getByLabelText('메모 제목'), { target: { value: '회의 정리' } })
  fireEvent.change(dialog().getByLabelText('메모 내용'), { target: { value: '첫 내용' } })
  submit('메모 추가')
  await screen.findByRole('heading', { level: 2, name: '회의 정리' })
  expect(calls('/materials/memo')).toHaveLength(1)
  const id = [...mock.calls].reverse().find((call) => call.path.startsWith('/v1/materials/'))!.path.split('/')[3].split('?')[0]
  // 원문 보기 없이 상세에서 본문을 바로 고친다
  expect(screen.queryByRole('button', { name: '원문 보기' })).toBeNull()
  const body = await screen.findByRole('textbox', { name: '메모 내용' }) as HTMLTextAreaElement
  await waitFor(() => expect(body.value).toBe('첫 내용'))
  fireEvent.change(body, { target: { value: '고친 내용' } })
  expect(screen.getByText('저장 대기')).toBeTruthy()
  await waitFor(() => expect(mock.get(id)?.revisions.at(-1)?.markdown).toBe('고친 내용'), { timeout: 3000 })
  await screen.findByText('저장됨')

  // 다른 팀원이 본문을 먼저 고쳤으면 덮어쓰지 않는다
  mock.editAs(id, '팀원이 고친 내용')
  fireEvent.change(body, { target: { value: '내가 고친 내용' } })
  expect(await screen.findByText(/다른 팀원이 먼저 메모를 고쳤어요/, undefined, { timeout: 3000 })).toBeTruthy()
  expect(body.value).toBe('내가 고친 내용')
  expect(mock.get(id)?.revisions.at(-1)?.markdown).toBe('팀원이 고친 내용')
  fireEvent.click(screen.getByRole('button', { name: '내 내용으로 저장' }))
  await waitFor(() => expect(mock.get(id)?.revisions.at(-1)?.markdown).toBe('내가 고친 내용'))
  await screen.findByText('저장됨')

  // 이름만 바뀐 경우는 확인 없이 다시 저장한다
  mock.renameAs(id, '팀원이 바꾼 제목')
  fireEvent.change(body, { target: { value: '이름이 바뀐 뒤 고친 내용' } })
  await waitFor(() => expect(mock.get(id)?.revisions.at(-1)?.markdown).toBe('이름이 바뀐 뒤 고친 내용'), { timeout: 3000 })
  expect(screen.queryByText(/다른 팀원이 먼저 메모를 고쳤어요/)).toBeNull()
})

test('한글 조합 중에는 메모를 저장하지 않고 조합이 끝난 뒤 저장한다', async () => {
  mount()
  fireEvent.click(await screen.findByRole('link', { name: /기존 메모/ }))
  const body = await screen.findByRole('textbox', { name: '메모 내용' }) as HTMLTextAreaElement
  const id = [...mock.calls].reverse().find((call) => call.path.startsWith('/v1/materials/'))!.path.split('/')[3].split('?')[0]
  await waitFor(() => expect(body.disabled).toBe(false))
  const before = mock.get(id)!.revisions.length
  fireEvent.compositionStart(body)
  fireEvent.change(body, { target: { value: '한그' } })
  await new Promise((resolve) => setTimeout(resolve, 1500))
  expect(mock.get(id)!.revisions).toHaveLength(before)
  fireEvent.change(body, { target: { value: '한글' } })
  fireEvent.compositionEnd(body)
  await waitFor(() => expect(mock.get(id)!.revisions.at(-1)?.markdown).toBe('한글'), { timeout: 3000 })
  expect(mock.get(id)!.revisions).toHaveLength(before + 1)
})

test('메모를 고친 직후 다른 자료로 옮기면 저장을 마친 뒤 그대로 이동한다', async () => {
  mount()
  fireEvent.click(await screen.findByRole('link', { name: /기존 메모/ }))
  const body = await screen.findByRole('textbox', { name: '메모 내용' }) as HTMLTextAreaElement
  const id = [...mock.calls].reverse().find((call) => call.path.startsWith('/v1/materials/'))!.path.split('/')[3].split('?')[0]
  await waitFor(() => expect(body.disabled).toBe(false))
  fireEvent.change(body, { target: { value: '옮기기 직전에 쓴 내용' } })
  fireEvent.blur(body)
  await openAdd('메모')
  fireEvent.change(dialog().getByLabelText('메모 제목'), { target: { value: '다른 자료' } })
  fireEvent.change(dialog().getByLabelText('메모 내용'), { target: { value: '본문' } })
  submit('메모 추가')
  await screen.findByRole('heading', { level: 2, name: '다른 자료' })
  expect(screen.queryByRole('dialog', { name: '저장하지 않은 변경이 있어요' })).toBeNull()
  expect(mock.get(id)!.revisions.at(-1)?.markdown).toBe('옮기기 직전에 쓴 내용')
})

test('메모 원문은 읽은 자료의 현재 개정으로 읽는다', async () => {
  mount()
  fireEvent.click(await screen.findByRole('link', { name: /기존 메모/ }))
  const body = await screen.findByRole('textbox', { name: '메모 내용' }) as HTMLTextAreaElement
  await waitFor(() => expect(body.disabled).toBe(false))
  const read = calls('/source')
  expect(read.length).toBeGreaterThan(0)
  expect(read.every((call) => call.path.includes('revisionId='))).toBe(true)
})

test('저장 요청이 끝나기 전에 저장된 내용으로 되돌려도 이동하기 전에 확인한다', async () => {
  const router = mount()
  fireEvent.click(await screen.findByRole('link', { name: /기존 메모/ }))
  const body = await screen.findByRole('textbox', { name: '메모 내용' }) as HTMLTextAreaElement
  await waitFor(() => expect(body.disabled).toBe(false))
  const original = body.value
  mock.faults.delayMs = 2000
  fireEvent.change(body, { target: { value: '잠깐 바꾼 내용' } })
  fireEvent.blur(body)
  await screen.findByText('저장 중')
  fireEvent.change(body, { target: { value: original } })
  // 다른 화면으로 떠나려 한다
  void router.navigate(`/projects/${mock.projectId}`)
  expect(await screen.findByRole('dialog', { name: '저장하지 않은 변경이 있어요' })).toBeTruthy()
  mock.faults.delayMs = 0
})

test('고치는 중이 아닐 때 다른 팀원이 저장한 메모 본문으로 바꾸고 고치는 중이면 그대로 둔다', async () => {
  mount()
  fireEvent.click(await screen.findByRole('link', { name: /기존 메모/ }))
  const body = await screen.findByRole('textbox', { name: '메모 내용' }) as HTMLTextAreaElement
  await waitFor(() => expect(body.disabled).toBe(false))
  const id = [...mock.calls].reverse().find((call) => call.path.startsWith('/v1/materials/'))!.path.split('/')[3].split('?')[0]
  mock.editAs(id, '팀원이 바꾼 본문')
  fireEvent(window, new Event('focus'))
  await waitFor(() => expect(body.value).toBe('팀원이 바꾼 본문'))
  expect(screen.getByText('저장됨')).toBeTruthy()

  // 고치는 중에는 덮어쓰지 않는다
  fireEvent.change(body, { target: { value: '내가 고치는 중' } })
  mock.editAs(id, '팀원이 또 바꾼 본문')
  fireEvent(window, new Event('focus'))
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(body.value).toBe('내가 고치는 중')
})

test('다른 팀원의 본문을 다시 읽는 동안 시작한 입력은 응답으로 덮어쓰지 않는다', async () => {
  mount()
  fireEvent.click(await screen.findByRole('link', { name: /기존 메모/ }))
  const body = await screen.findByRole('textbox', { name: '메모 내용' }) as HTMLTextAreaElement
  await waitFor(() => expect(body.disabled).toBe(false))
  const id = [...mock.calls].reverse().find((call) => call.path.startsWith('/v1/materials/'))!.path.split('/')[3].split('?')[0]
  mock.editAs(id, '팀원이 바꾼 본문')
  fireEvent(window, new Event('focus'))
  // 자료가 새 개정으로 바뀐 뒤 본문을 다시 읽는 응답을 늦춘다
  await waitFor(() => expect(mock.calls.some((call) => call.path.endsWith(`/materials/${id}`) && call.method === 'GET')).toBe(true))
  mock.faults.delayMs = 800
  await waitFor(() => expect(mock.calls.filter((call) => call.path.includes(`/materials/${id}/source`)).length).toBeGreaterThan(1), { timeout: 3000 })
  fireEvent.change(body, { target: { value: '다시 읽는 중에 쓴 내용' } })
  await new Promise((resolve) => setTimeout(resolve, 1200))
  mock.faults.delayMs = 0
  expect(body.value).toBe('다시 읽는 중에 쓴 내용')
})

test('다른 팀원의 본문을 다시 읽지 못하면 이유를 보여 주고 다시 불러오면 최신 본문으로 바꾼다', async () => {
  mount()
  fireEvent.click(await screen.findByRole('link', { name: /기존 메모/ }))
  const body = await screen.findByRole('textbox', { name: '메모 내용' }) as HTMLTextAreaElement
  await waitFor(() => expect(body.disabled).toBe(false))
  const before = body.value
  const id = [...mock.calls].reverse().find((call) => call.path.startsWith('/v1/materials/'))!.path.split('/')[3].split('?')[0]
  mock.editAs(id, '팀원이 바꾼 본문')
  mock.faults.failNext = { match: `GET /v1/materials/${id}/source`, code: 'SERVICE_UNAVAILABLE' }
  fireEvent(window, new Event('focus'))
  const retry = await screen.findByRole('button', { name: '다시 불러오기' })
  expect(body.value).toBe(before)
  // 창으로 다시 돌아와도 실패한 개정을 반복해 읽지 않는다
  const sourceReads = () => mock.calls.filter((call) => call.path.includes(`/materials/${id}/source`)).length
  const reads = sourceReads()
  fireEvent(window, new Event('focus'))
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(sourceReads()).toBe(reads)
  fireEvent.click(retry)
  await waitFor(() => expect(body.value).toBe('팀원이 바꾼 본문'))
  expect(screen.queryByRole('button', { name: '다시 불러오기' })).toBeNull()
  expect(screen.getByText('저장됨')).toBeTruthy()
})

test('부모가 읽은 뒤 본문을 읽기 전에 개정이 또 바뀌어도 본문 조회를 반복하지 않는다', async () => {
  mount()
  fireEvent.click(await screen.findByRole('link', { name: /기존 메모/ }))
  const body = await screen.findByRole('textbox', { name: '메모 내용' }) as HTMLTextAreaElement
  await waitFor(() => expect(body.disabled).toBe(false))
  const id = [...mock.calls].reverse().find((call) => call.path.startsWith('/v1/materials/'))!.path.split('/')[3].split('?')[0]
  const materialReads = () => mock.calls.filter((call) => call.method === 'GET' && call.path.split('?')[0] === `/v1/materials/${id}`).length
  const sourceReads = () => mock.calls.filter((call) => call.path.includes(`/materials/${id}/source`)).length
  // 화면이 자료를 읽은 뒤, 메모 본문이 자료를 다시 읽기 전에 한 번 더 바뀐다
  mock.faults.delayMs = 300
  mock.editAs(id, '팀원이 처음 바꾼 본문')
  const before = materialReads()
  fireEvent(window, new Event('focus'))
  await waitFor(() => expect(materialReads()).toBeGreaterThanOrEqual(before + 2), { timeout: 3000 })
  mock.editAs(id, '팀원이 또 바꾼 본문')
  mock.faults.delayMs = 0
  await waitFor(() => expect(body.value).toBe('팀원이 또 바꾼 본문'), { timeout: 3000 })
  const reads = sourceReads()
  await new Promise((resolve) => setTimeout(resolve, 500))
  expect(sourceReads()).toBe(reads)
})

test('처음 본문을 읽는 동안 다른 팀원이 저장하면 그 본문을 다시 읽는다', async () => {
  mount()
  const link = await screen.findByRole('link', { name: /기존 메모/ })
  const id = new URL(link.getAttribute('href')!, 'http://local').searchParams.get('material')!
  // 처음 원문 응답을 늦추고 그 사이 화면이 새 개정을 받게 한다
  mock.faults.delayMs = 400
  fireEvent.click(link)
  await waitFor(() => expect(mock.calls.some((call) => call.path.includes(`/materials/${id}/source`))).toBe(true), { timeout: 3000 })
  mock.faults.delayMs = 0
  mock.editAs(id, '처음 읽는 동안 바뀐 본문')
  fireEvent(window, new Event('focus'))
  const body = await screen.findByRole('textbox', { name: '메모 내용' }) as HTMLTextAreaElement
  await waitFor(() => expect(body.value).toBe('처음 읽는 동안 바뀐 본문'), { timeout: 3000 })
})

test('추가한 자료로 뒤로가기할 때 다른 자료의 미저장 메모를 확인한다', async () => {
  const router = mount()
  await openAdd('메모')
  fireEvent.change(dialog().getByLabelText('메모 제목'), { target: { value: '새 자료' } })
  fireEvent.change(dialog().getByLabelText('메모 내용'), { target: { value: '원문' } })
  submit('메모 추가')
  await screen.findByRole('heading', { level: 2, name: '새 자료' })
  fireEvent.click(screen.getByRole('link', { name: /기존 메모/ }))
  await screen.findByRole('heading', { level: 2, name: '기존 메모' })
  fireEvent.change(await screen.findByLabelText('메모 남기기'), { target: { value: '아직 저장하지 않은 내용' } })
  void router.navigate(-1)
  const guard = within(await screen.findByRole('dialog', { name: '저장하지 않은 변경이 있어요' }))
  fireEvent.click(guard.getByRole('button', { name: '계속 작성' }))
  expect(screen.getByLabelText('메모 남기기')).toHaveProperty('value', '아직 저장하지 않은 내용')
  expect(screen.getByRole('heading', { level: 2, name: '기존 메모' })).toBeTruthy()
})

test.each(['REQUEST_IN_PROGRESS', 'RATE_LIMITED', 'SERVICE_UNAVAILABLE'])('%s의 Retry-After 동안 재시도와 원래 제출을 막는다', async (code) => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await mock.fetchAs(mock.ownerId)(input, init)
    if (!response.ok) response.headers.set('Retry-After', '1')
    return response
  })
  mount()
  await openAdd('링크')
  fireEvent.change(dialog().getByLabelText('링크 주소'), { target: { value: 'https://example.com/' } })
  mock.faults.failNext = { match: '/materials/link', code }
  submit()
  const failure = within(await screen.findByRole('dialog', { name: '자료를 추가하지 못했어요' }))
  const retry = failure.getByRole('button', { name: '잠시 후 다시 시도' })
  expect(retry).toHaveProperty('disabled', true)
  fireEvent.click(retry)
  expect(calls('/materials/link')).toHaveLength(1)
  fireEvent.click(failure.getByRole('button', { name: '링크 다시 입력' }))
  expect(dialog().getByRole('button', { name: '자료 추가' })).toHaveProperty('disabled', true)
  submit()
  expect(calls('/materials/link')).toHaveLength(1)
  await waitFor(() => expect(dialog().getByRole('button', { name: '자료 추가' })).toHaveProperty('disabled', false), { timeout: 2000 })
  submit()
  await screen.findByText('웹페이지 본문을 가져오고 있어요.')
  expect(calls('/materials/link')).toHaveLength(2)
  expect(mock.count()).toBe(2)
})
