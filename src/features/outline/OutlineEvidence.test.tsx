// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TransportError } from '../../shared/api/client.ts'
import { materialsApi } from '../materials/api.ts'
import type { MaterialSummary } from '../materials/model.ts'
import { outlineApi } from './api.ts'
import OutlineEvidence from './OutlineEvidence.tsx'
import type { Outline } from './model.ts'

vi.mock('../materials/api.ts', () => ({ materialsApi: { get: vi.fn(), list: vi.fn() } }))
vi.mock('../materials/SourceViewer.tsx', () => ({ SourceViewer: ({ revisionId, onClose }: { revisionId: string; onClose: () => void }) =>
  <button type="button" onClick={onClose}>{revisionId} 닫기</button> }))
vi.mock('./api.ts', () => ({ outlineApi: { saveSources: vi.fn() } }))

const source = { materialId: 'material-1', revisionId: 'saved-revision', sourceVersion: 1, sourceDeleted: false }
const outline: Outline = { projectId: 'project-1', version: 3, items: [
  { id: 'item-1', title: '구성', position: 0, summary: '', sourceRefs: [source] },
] }
const material = (id: string, title: string, status: MaterialSummary['status']): MaterialSummary => ({ id, title, status, kind: 'memo', projectId: outline.projectId,
  version: 2, pageCount: null, createdBy: { name: '팀원', userId: 'user-1' }, createdAt: '2026-11-20T00:00:00Z', updatedAt: '2026-11-20T00:00:00Z' })

function mount() {
  const onSaved = vi.fn()
  render(<OutlineEvidence projectId={outline.projectId} item={outline.items[0]} outline={outline} openRequest={0} disabled={false}
    onSaved={onSaved} onReloadOutline={() => Promise.resolve(outline)} onAccessError={vi.fn()} onDirtyChange={vi.fn()} />)
  return onSaved
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(materialsApi.get).mockResolvedValue({ ...material(source.materialId, '기존 근거', 'ready'), description: null,
    source: { fileName: null, mimeType: null, sizeBytes: null, url: null }, currentRevision: null, canDelete: true, job: null })
  vi.mocked(materialsApi.list).mockResolvedValue({ items: [material(source.materialId, '기존 근거', 'ready'), material('material-2', '새 근거', 'ready'), material('material-3', '처리 중 근거', 'processing')],
    nextCursor: null, counts: { all: 3, file: 0, link: 0, memo: 3 } })
})
afterEach(cleanup)

test('연결한 개정을 원문 보기에 전달하고 닫으면 같은 근거 위치로 돌아온다', async () => {
  mount()
  const view = await screen.findByRole('button', { name: '원문 보기' })
  fireEvent.click(view)
  fireEvent.click(await screen.findByRole('button', { name: 'saved-revision 닫기' }))
  expect(screen.getByRole('button', { name: '원문 보기' })).toBe(view)
})

test('준비 완료 자료만 선택 가능하며 항목 전용 API에 정확한 자료와 버전을 저장한다', async () => {
  const onSaved = mount()
  const updated = { ...outline, version: 4 }
  vi.mocked(outlineApi.saveSources).mockRejectedValueOnce(new TransportError('network')).mockResolvedValueOnce(updated)
  fireEvent.click(screen.getByRole('button', { name: '자료에서 찾기' }))
  const extra = await screen.findByRole('checkbox', { name: /새 근거/ })
  expect(screen.queryByRole('checkbox', { name: /처리 중 근거/ })).toBeNull()
  expect((screen.getByRole('checkbox', { name: /기존 근거/ }) as HTMLInputElement).checked).toBe(true)
  fireEvent.click(extra)
  const save = screen.getByRole('button', { name: '2개 연결' })
  fireEvent.click(save)
  await screen.findByText(/서버에 연결할 수 없습니다/)
  fireEvent.click(save)
  const requests = vi.mocked(outlineApi.saveSources).mock.calls
  expect(requests).toHaveLength(2)
  expect(requests[0]).toEqual(requests[1])
  expect(requests[0].slice(0, 2)).toEqual(['item-1', { expectedVersion: 3, sourceIds: ['material-1', 'material-2'] }])
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated))
})
