// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import bootstrap from '../../../../contracts/examples/auth-bootstrap-authenticated.json'
import { CSRF_HEADER } from '../../../shared/api/contract.ts'
import { DesignFontField } from './DesignFontField.tsx'
import { fontsApi } from '../fontsApi.ts'

const projectId = '16cb66cf-babe-45e8-9164-4bc4376eb19c'
const assetId = 'd0429274-32ac-4c66-9447-186e94406e0d'
const rootUrl = `/v1/projects/${projectId}/design-fonts`
const bytes = new Uint8Array([0, 1, 0, 0])
const projectFont = {
  id: assetId,
  fileName: '팀 폰트.ttf',
  format: 'ttf' as const,
  sizeBytes: bytes.byteLength,
  contentUrl: `${rootUrl}/${assetId}/content`,
}
const fontRegistry = { add: vi.fn(), delete: vi.fn() }

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document, 'fonts')
  vi.clearAllMocks()
})

test('업로드 파일을 그대로 전송하고 저장할 글꼴과 미리보기를 선택한다', async () => {
  let uploaded = false
  const fetcher = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const path = String(input)
    if (path === '/v1/auth/bootstrap') return Response.json(bootstrap)
    if (path === rootUrl) return Response.json({ items: uploaded ? [projectFont] : [] })
    if (path === projectFont.contentUrl) return new Response(bytes)
    if (path.startsWith(`${rootUrl}?`) && options?.method === 'POST') {
      uploaded = true
      return Response.json(projectFont)
    }
    return new Response(null, { status: 404 })
  })
  vi.stubGlobal('fetch', fetcher)
  vi.stubGlobal('FontFace', class {
    async load() { return this }
  })
  Object.defineProperty(document, 'fonts', { configurable: true, value: fontRegistry })
  const onSelection = vi.fn()
  const onPreview = vi.fn()
  function Field({ saved }: { saved?: string }) {
    const [selection, setSelection] = useState({ font: 'Pretendard', fontAssetId: saved })
    const [uploading, setUploading] = useState(false)
    return <DesignFontField projectId={projectId} uploadsEnabled fonts={['Pretendard', 'Noto Sans']}
      font={selection.font} fontAssetId={selection.fontAssetId} fieldId="font"
      uploading={uploading} onUploadingChange={setUploading}
      onPreviewChange={onPreview} onChange={(value) => {
        onSelection(value)
        setSelection({ font: value.font, fontAssetId: value.fontAssetId })
      }} />
  }

  const view = render(<Field />)
  await waitFor(() => expect((screen.getByRole('button', { name: '글꼴 업로드' }) as HTMLButtonElement).disabled).toBe(false))
  const picker = screen.getByLabelText('글꼴 파일 선택')
  fireEvent.change(picker, { target: { files: [new File([bytes], 'memo.pdf')] } })
  expect(screen.getByText('TTF 또는 OTF 파일을 선택해 주세요.')).toBeTruthy()
  expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)

  const picked = new File([bytes], projectFont.fileName)
  fireEvent.change(picker, { target: { files: [picked] } })
  await waitFor(() => expect(onPreview).toHaveBeenCalledWith(`ProjectFont-${assetId}`))
  expect(onSelection).toHaveBeenLastCalledWith({ font: 'Pretendard', fontAssetId: assetId })
  const [path, request] = fetcher.mock.calls.find(([, options]) => options?.method === 'POST') ?? []
  expect(new URL(String(path), 'https://teamplespace.test').searchParams.get('fileName')).toBe(picked.name)
  expect(request?.body).toBe(picked)
  expect(request?.credentials).toBe('same-origin')
  expect(request?.headers).toMatchObject({ [CSRF_HEADER]: bootstrap.csrfToken, 'Content-Type': 'application/octet-stream' })
  expect(fontRegistry.add).toHaveBeenCalledOnce()

  view.unmount()
  expect(fontRegistry.delete).toHaveBeenCalledOnce()
  onPreview.mockClear()
  render(<Field saved={assetId} />)
  await waitFor(() => expect(onPreview).toHaveBeenCalledWith(`ProjectFont-${assetId}`))
  const select = screen.getByRole('combobox', { name: '폰트' }) as HTMLSelectElement
  expect(select.selectedOptions[0].textContent).toBe(projectFont.fileName)
  fireEvent.change(select, { target: { value: 'Noto Sans' } })
  expect(onSelection).toHaveBeenLastCalledWith({ font: 'Noto Sans' })
  expect(onPreview).toHaveBeenLastCalledWith(undefined)
})

test('프로젝트 글꼴 경로가 아닌 주소에는 요청하지 않는다', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  await expect(fontsApi.content(projectId, { ...projectFont, contentUrl: '//other.test/font' }, new AbortController().signal))
    .rejects.toMatchObject({ kind: 'invalid_response' })
  expect(fetcher).not.toHaveBeenCalled()
})

test('서버에서 적용한 글꼴이 기존 목록에 없으면 다시 읽어 미리보기에 적용한다', async () => {
  let available = false
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === rootUrl) return Response.json({ items: available ? [projectFont] : [] })
    if (String(input) === projectFont.contentUrl) return new Response(bytes)
    return new Response(null, { status: 404 })
  })
  vi.stubGlobal('fetch', fetcher)
  vi.stubGlobal('FontFace', class {
    async load() { return this }
  })
  Object.defineProperty(document, 'fonts', { configurable: true, value: fontRegistry })
  const onPreview = vi.fn()
  const props = {
    projectId, uploadsEnabled: true, fonts: ['Pretendard'], font: 'Pretendard', fieldId: 'font',
    uploading: false, onUploadingChange: vi.fn(), onChange: vi.fn(), onPreviewChange: onPreview,
  }
  const view = render(<DesignFontField {...props} />)
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: '글꼴 업로드' }).disabled).toBe(false))

  available = true
  view.rerender(<DesignFontField {...props} fontAssetId={assetId} />)

  await screen.findByRole('option', { name: projectFont.fileName })
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '폰트' }).value).toBe(`upload:${assetId}`)
  await waitFor(() => expect(onPreview).toHaveBeenLastCalledWith(`ProjectFont-${assetId}`))
  expect(fetcher.mock.calls.filter(([path]) => String(path) === rootUrl)).toHaveLength(2)
})
