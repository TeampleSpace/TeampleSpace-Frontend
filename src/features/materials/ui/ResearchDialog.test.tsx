// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import { TransportError } from '../../../shared/api/client.ts'
import { materialsApi } from '../../../entities/material/api.ts'
import { researchApi, researchMarkdown } from '../../../entities/material/research.ts'
import type { ResearchResult } from '../../../entities/material/research.ts'
import type { Job, Material } from '../../../entities/material/model.ts'
import type { Project } from '../../../entities/project/model.ts'
import { ResearchDialog } from './ResearchDialog.tsx'

const date = '2026-11-26T00:00:00Z'
const project = { id: 'project', name: '팀 발표' } as Project
const queued: Job = { id: 'job', projectId: 'project', type: 'material_research', targetType: 'project', targetId: 'project',
  status: 'queued', progress: 0, createdAt: date, updatedAt: date }
const result: ResearchResult = { type: 'material_research', topic: '대학생 AI 활용', markdown: '## 현황\n- 과제 조사에 많이 쓴다 [1]',
  sources: [{ title: '이용 조사 [2026]', url: 'https://example.com/survey' }] }

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function mount() {
  const props = { onClose: vi.fn(), onDone: vi.fn(), onDirtyChange: vi.fn(), onError: vi.fn() }
  render(<ResearchDialog project={project} {...props} />)
  return props
}

test('응답을 못 받은 조사 요청은 같은 키로 다시 보내고 결과를 출처와 함께 메모로 추가한다', async () => {
  const start = vi.spyOn(researchApi, 'start').mockRejectedValueOnce(new TransportError('network')).mockResolvedValueOnce(queued)
  vi.spyOn(materialsApi, 'job').mockResolvedValue({ ...queued, status: 'succeeded', resultRef: result })
  const created = { id: 'memo' } as Material
  const createMemo = vi.spyOn(materialsApi, 'createMemo').mockResolvedValue({ material: created, job: null })
  const props = mount()

  fireEvent.change(screen.getByLabelText('조사할 주제'), { target: { value: '  대학생 AI 활용 ' } })
  fireEvent.click(screen.getByRole('button', { name: '조사 시작' }))
  await screen.findByText(/서버에 연결할 수 없습니다/)
  fireEvent.click(screen.getByRole('button', { name: '조사 시작' }))
  await screen.findByRole('status')
  expect(start).toHaveBeenCalledTimes(2)
  expect(start.mock.calls[1]).toEqual(start.mock.calls[0])
  expect(start.mock.calls[0].slice(0, 2)).toEqual(['project', '대학생 AI 활용'])

  await screen.findByText('과제 조사에 많이 쓴다 [1]', {}, { timeout: 3000 })
  expect(screen.getByRole('link', { name: '이용 조사 [2026]' }).getAttribute('href')).toBe('https://example.com/survey')
  expect((screen.getByLabelText('자료 이름') as HTMLInputElement).value).toBe('대학생 AI 활용')
  fireEvent.click(screen.getByRole('button', { name: '자료로 추가' }))
  await vi.waitFor(() => expect(props.onDone).toHaveBeenCalledWith(created))
  expect(createMemo).toHaveBeenCalledWith('project', { title: '대학생 AI 활용', markdown: researchMarkdown(result) }, expect.any(String))
})

test('조사가 실패해도 주제를 남기고 다시 조사하며 결과를 두고 닫으면 확인한다', async () => {
  vi.spyOn(researchApi, 'start').mockResolvedValue(queued)
  vi.spyOn(materialsApi, 'job').mockResolvedValueOnce({ ...queued, status: 'failed',
    error: { code: 'JOB_RESEARCH_INVALID_RESULT', message: '조사 결과에서 확인된 출처를 찾지 못했어요.' } })
    .mockResolvedValue({ ...queued, status: 'succeeded', resultRef: result })
  const props = mount()
  fireEvent.change(screen.getByLabelText('조사할 주제'), { target: { value: '대학생 AI 활용' } })
  fireEvent.click(screen.getByRole('button', { name: '조사 시작' }))
  await screen.findByText('조사 결과에서 확인된 출처를 찾지 못했어요.', {}, { timeout: 3000 })
  fireEvent.click(screen.getByRole('button', { name: '다시 조사' }))
  await screen.findByText('과제 조사에 많이 쓴다 [1]', {}, { timeout: 3000 })

  fireEvent.click(screen.getByRole('button', { name: '닫기' }))
  expect(screen.getByText('조사 결과를 저장하지 않고 닫을까요?')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '계속 보기' }))
  expect(props.onClose).not.toHaveBeenCalled()
  expect(screen.getByText('과제 조사에 많이 쓴다 [1]')).toBeTruthy()
})

test('출처 제목의 대괄호를 이스케이프해 메모 본문에 출처 목록을 남긴다', () => {
  expect(researchMarkdown(result)).toContain('1. [이용 조사 \\[2026\\]](<https://example.com/survey>)')
  expect(researchMarkdown(result)).toContain('## 출처')
})
