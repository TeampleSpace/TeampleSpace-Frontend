// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import { TransportError } from '../../../shared/api/client.ts'
import { SessionContext } from '../../../entities/session/sessionContext.ts'
import { authCapabilitiesSchema } from '../../../entities/session/model.ts'
import sampleCapabilities from '../../../../contracts/examples/capabilities.json'
import { materialsApi } from '../../../entities/material/api.ts'
import { MaterialAiSummary } from './MaterialAiSummary.tsx'
import type { Job, Material } from '../../../entities/material/model.ts'

const date = '2026-11-20T00:00:00Z'
const author = { userId: 'user', name: '팀원' }
const revision = { id: 'revision', sourceVersion: 1, pageCount: null, createdAt: date, createdBy: author,
  summary: null, excerpt: { text: '원문 미리보기', page: null } }
const material: Material = { id: 'material', projectId: 'project', kind: 'memo', title: '자료', status: 'ready',
  version: 1, createdBy: author, createdAt: date, updatedAt: date, pageCount: null, description: null,
  source: { url: null, fileName: null, mimeType: null, sizeBytes: null }, currentRevision: revision, job: null, canDelete: true }
const job: Job = { id: 'job', projectId: 'project', type: 'material_summary', targetType: 'material_summary',
  targetId: 'revision', status: 'queued', progress: 0, createdAt: date, updatedAt: date }

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function mount(initial: Material, enabled: boolean) {
  const capabilities = authCapabilitiesSchema.parse({ ...sampleCapabilities, featureFlags: { materialSummary: enabled } })
  const reportError = vi.fn()
  const reportGone = vi.fn()
  function Harness() {
    const [current, setCurrent] = useState(initial)
    return <MaterialAiSummary material={current} onChanged={setCurrent} onError={reportError} onGone={reportGone} />
  }
  render(<SessionContext value={{ user: null, setUser: vi.fn(), refresh: vi.fn(), capabilities, loading: false, error: undefined }}>
    <Harness />
  </SessionContext>)
}

test('새 요약을 만들 수 없어도 저장한 요약을 표시한다', () => {
  mount({ ...material, currentRevision: { ...revision, summary: '팀 회의 결과를 정리했어요.' } }, false)
  expect(screen.getByText('팀 회의 결과를 정리했어요.')).toBeTruthy()
  expect(screen.queryByText('원문 미리보기')).toBeNull()
  expect(screen.queryByRole('button', { name: 'AI 요약 만들기' })).toBeNull()
})

test('요약은 확인 뒤에만 요청하고 응답 유실 뒤 같은 키로 복구한다', async () => {
  const summarize = vi.spyOn(materialsApi, 'summarize').mockRejectedValueOnce(new TransportError('network')).mockResolvedValueOnce(job)
  const get = vi.spyOn(materialsApi, 'get').mockResolvedValue({ ...material, summaryJob: { ...job, status: 'succeeded' },
    currentRevision: { ...revision, summary: '추출한 본문의 핵심 내용' } })
  mount(material, true)
  fireEvent.click(screen.getByRole('button', { name: 'AI 요약 만들기' }))
  expect(summarize).not.toHaveBeenCalled()
  const action = screen.getByRole('button', { name: '요약 요청' })
  fireEvent.click(action)
  await screen.findByText(/서버에 연결할 수 없습니다/)
  fireEvent.click(action)
  await screen.findByText('추출한 본문의 핵심 내용')
  expect(summarize).toHaveBeenCalledTimes(2)
  expect(summarize.mock.calls[1]).toEqual(summarize.mock.calls[0])
  expect(summarize.mock.calls[1].slice(0, 2)).toEqual(['material', 'revision'])
  expect(get).toHaveBeenCalledWith('material', expect.any(AbortSignal))
})
