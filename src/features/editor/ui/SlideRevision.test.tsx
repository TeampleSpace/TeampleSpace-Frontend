// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import { elementSaveResultSchema } from '../../../entities/presentation/schema.ts'
import { exampleSnapshot } from '../../../mocks/example.ts'
import { createMockServer } from '../../../mocks/server.ts'
import { createApiClient } from '../../../shared/api/client.ts'
import { createEditorSession } from '../session.ts'
import type { EditorSession } from '../session.ts'
import { SlideEditor } from './SlideEditor.tsx'

// 둘째 슬라이드의 본문 글상자. 작업 등록과 조회, 적용은 이 파일의 대역이 받고 문서 저장은 모킹 서버가 한다
const projectId = exampleSnapshot.projectId
const slideId = '0193a000-0000-7000-8000-0000000000a2'
const bodyId = '0193a000-0000-7000-8000-00000000e005'
const userA = exampleSnapshot.members[0].userId
const sessions: EditorSession[] = []

type Outcome = { failed: string } | { after: string }

function setup(outcomes: Outcome[], applyStatus = 200) {
  const server = createMockServer(exampleSnapshot)
  const fetchA = server.fetchAs(userA)
  const textOf = () => {
    const element = server.getDocument().slides.flatMap((slide) => slide.elements).find((item) => item.id === bodyId)
    return element?.type === 'text' ? element.content.text : ''
  }
  const before = textOf()
  const requests: unknown[] = []
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req_test' } })
  const job = (id: string, status: string, extra: object = {}) => ({
    id, projectId, type: 'slide_revision', status, progress: 0, targetType: 'slide', targetId: slideId,
    createdAt: '2026-11-24T00:00:00Z', updatedAt: '2026-11-24T00:00:00Z', ...extra,
  })
  const stub: typeof fetch = async (input, init = {}) => {
    const path = new URL(String(input), 'http://mock.local').pathname
    if (path === `/v1/slides/${slideId}/ai-revision-jobs`) {
      requests.push(JSON.parse(String(init.body)))
      return reply(202, job(`job-${requests.length}`, 'queued'))
    }
    const read = path.match(/^\/v1\/jobs\/job-(\d+)$/)
    if (read) {
      const outcome = outcomes[Number(read[1]) - 1]
      return reply(200, 'failed' in outcome
        ? job(`job-${read[1]}`, 'failed', { error: { code: 'JOB_REVISION_PROVIDER_UNAVAILABLE', message: outcome.failed } })
        : job(`job-${read[1]}`, 'succeeded', { resultRef: { type: 'slide_revision', slideId, generation: 1,
          targets: [{ elementId: bodyId, baseVersion: 1, before, after: outcome.after }] } }))
    }
    const apply = path.match(/^\/v1\/ai-proposals\/(job-\d+)\/apply$/)
    if (apply) {
      if (applyStatus !== 200) {
        return reply(applyStatus, { error: { code: 'VERSION_CONFLICT', message: '이후 수정이 있어요.', retryable: false }, requestId: 'req_test' })
      }
      const outcome = outcomes[Number(apply[1].slice(4)) - 1] as { after: string }
      const saved = await createApiClient(fetchA).request(`/slides/${slideId}/elements/${bodyId}`, elementSaveResultSchema, {
        method: 'PATCH', idempotencyKey: crypto.randomUUID(),
        body: { generation: 1, baseVersion: 1, editGroupId: crypto.randomUUID(), clientMutationId: crypto.randomUUID(),
          finalizeGroup: true, patch: { content: { text: outcome.after } } },
      })
      return reply(200, { proposalId: apply[1], changes: [saved] })
    }
    return fetchA(input, init)
  }
  vi.stubGlobal('fetch', stub)
  const session = createEditorSession({ client: createApiClient(fetchA), fetchImpl: fetchA, projectId, saveDelayMs: 10 })
  sessions.push(session)
  session.start()
  const router = createMemoryRouter([{
    path: '/projects/:projectId/slides/:slideId?',
    element: <SlideEditor projectId={projectId} projectName="팀 과제" session={session} slideId={slideId} aiRevision />,
  }], { initialEntries: [`/projects/${projectId}/slides/${slideId}`] })
  render(<RouterProvider router={router} />)
  return { textOf, before, requests }
}

async function ask(prompt: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'AI로 수정' }))
  fireEvent.change(screen.getByRole('textbox', { name: '어떻게 바꿀까요?' }), { target: { value: prompt } })
  fireEvent.click(screen.getByRole('button', { name: '제안 받기' }))
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})

afterEach(() => {
  for (const session of sessions.splice(0)) session.stop()
  cleanup()
})

test('제안을 만들지 못하면 요청을 남긴 채 다시 요청하고, 확인한 제안을 적용하면 슬라이드에 바로 반영한다', async () => {
  const { textOf, before, requests } = setup([{ failed: '수정 제안 서비스를 사용할 수 없어요.' }, { after: '짧게 줄인 본문' }])
  await ask('설명을 짧게 줄여줘')

  expect(await screen.findByText('수정 제안을 만들지 못했어요')).toBeTruthy()
  expect(screen.getByText('수정 제안 서비스를 사용할 수 없어요.')).toBeTruthy()
  expect(textOf()).toBe(before)
  fireEvent.click(screen.getByRole('button', { name: '다시 요청' }))

  expect(await screen.findByText('수정 제안을 확인하세요')).toBeTruthy()
  expect(requests).toEqual([{ generation: 1, prompt: '설명을 짧게 줄여줘' }, { generation: 1, prompt: '설명을 짧게 줄여줘' }])
  expect(screen.getByText(`현재: ${before}`)).toBeTruthy()
  expect(screen.getByText('제안: 짧게 줄인 본문')).toBeTruthy()
  expect(textOf()).toBe(before)

  fireEvent.click(screen.getByRole('button', { name: '적용' }))
  await waitFor(() => expect(screen.queryByText('수정 제안을 확인하세요')).toBeNull())
  expect(textOf()).toBe('짧게 줄인 본문')
  expect(await screen.findByRole('button', { name: /^텍스트 짧게 줄인 본문/ })).toBeTruthy()
})

test('제안 뒤에 슬라이드가 바뀌어 적용하지 못하면 알리고 요청 문장을 남긴 채 다시 요청하게 한다', async () => {
  const { textOf, before } = setup([{ after: '새 본문' }], 409)
  await ask('더 힘 있게')
  fireEvent.click(await screen.findByRole('button', { name: '적용' }))

  expect(await screen.findByText('제안을 만든 뒤 슬라이드가 바뀌었어요. 다시 요청해 주세요.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '적용' })).toBeNull()
  expect(textOf()).toBe(before)
  fireEvent.click(screen.getByRole('button', { name: '다시 요청' }))
  expect((screen.getByRole('textbox', { name: '어떻게 바꿀까요?' }) as HTMLTextAreaElement).value).toBe('더 힘 있게')
})
