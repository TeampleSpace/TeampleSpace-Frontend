// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useParams } from 'react-router'
import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import { elementSaveResultSchema } from '../../../entities/presentation/schema.ts'
import { exampleSnapshot } from '../../../mocks/example.ts'
import { createMockServer } from '../../../mocks/server.ts'
import { createApiClient } from '../../../shared/api/client.ts'
import { createEditorSession } from '../session.ts'
import type { EditorSession } from '../session.ts'
import { SlideEditor } from './SlideEditor.tsx'

// 계약 예제 둘째 슬라이드의 본문 글상자. 화면은 모킹 서버에 붙인 실제 편집 세션으로 그린다
const projectId = exampleSnapshot.projectId
const slideId = '0193a000-0000-7000-8000-0000000000a2'
const bodyId = '0193a000-0000-7000-8000-00000000e005'
const [userA, userB] = exampleSnapshot.members.map((member) => member.userId)

const sessions: EditorSession[] = []

function open(fetchImpl: typeof fetch, saveDelayMs = 10) {
  const session = createEditorSession({
    client: createApiClient(fetchImpl),
    fetchImpl,
    projectId,
    saveDelayMs,
  })
  sessions.push(session)
  session.start()
  return session
}

function Screen({ session, onCreateSample }: { session: EditorSession; onCreateSample?: () => Promise<void> }) {
  const { slideId: current } = useParams()
  return (
    <SlideEditor
      projectId={projectId}
      projectName="팀 과제"
      session={session}
      slideId={current}
      onCreateSample={onCreateSample}
    />
  )
}

function mount(session: EditorSession, onCreateSample?: () => Promise<void>) {
  const router = createMemoryRouter(
    [
      {
        path: '/projects/:projectId/slides/:slideId?',
        element: <Screen session={session} onCreateSample={onCreateSample} />,
      },
      { path: '*', element: <p>다른 화면</p> },
    ],
    { initialEntries: [`/projects/${projectId}/slides/${slideId}`] },
  )
  render(<RouterProvider router={router} />)
  return router
}

function setup() {
  const server = createMockServer(exampleSnapshot)
  const serverText = () => {
    const element = server
      .getDocument()
      .slides.flatMap((slide) => slide.elements)
      .find((candidate) => candidate.id === bodyId)
    return element?.type === 'text' ? element.content.text : undefined
  }
  // 화면을 거치지 않고 저장하는 다른 팀원
  const saveAsTeammate = (value: string) =>
    createApiClient(server.fetchAs(userB)).request(
      `/slides/${slideId}/elements/${bodyId}`,
      elementSaveResultSchema,
      {
        method: 'PATCH',
        idempotencyKey: crypto.randomUUID(),
        body: {
          generation: 1,
          baseVersion: 1,
          editGroupId: crypto.randomUUID(),
          clientMutationId: crypto.randomUUID(),
          patch: { content: { text: value } },
        },
      },
    )
  return { server, serverText, saveAsTeammate }
}

const body = () => screen.findByRole('button', { name: /^텍스트 조사 결과 요약/ })

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})

afterEach(() => {
  for (const session of sessions.splice(0)) session.stop()
  cleanup()
})

test('슬라이드 목록과 주소의 슬라이드를 보여 주고 글을 고치면 자동으로 저장한다', async () => {
  const { server, serverText } = setup()
  mount(open(server.fetchAs(userA)))

  expect(await screen.findByRole('heading', { name: '팀 과제' })).toBeTruthy()
  expect(screen.getByText(`팀원 ${exampleSnapshot.members.length}명`)).toBeTruthy()
  const links = screen.getAllByRole('link').filter((link) => link.getAttribute('href')?.includes('/slides/'))
  expect(links).toHaveLength(exampleSnapshot.presentation!.slides.length)
  expect(links[1].getAttribute('aria-current')).toBe('page')
  expect(screen.getByRole('status').textContent).toBe('자동 저장됨')

  fireEvent.doubleClick(await body())
  fireEvent.change(screen.getByRole('textbox', { name: '텍스트 편집' }), { target: { value: '화면에서 고친 본문' } })
  expect(screen.getByText('수정됨')).toBeTruthy()

  await waitFor(() => expect(serverText()).toBe('화면에서 고친 본문'))
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('자동 저장됨'))
  expect(screen.queryByText('수정됨')).toBeNull()
})

test('키보드로 요소를 고르고 방향키로 옮기면 위치를 저장한다', async () => {
  const { server } = setup()
  mount(open(server.fetchAs(userA)))
  const position = () =>
    server.getDocument().slides.flatMap((slide) => slide.elements).find((element) => element.id === bodyId)!.geometry
  const before = { ...position() }

  const target = await body()
  fireEvent.keyDown(target, { key: ' ' })
  expect(target.getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('heading', { name: '텍스트' })).toBeTruthy()
  fireEvent.keyDown(target, { key: 'ArrowRight', shiftKey: true })
  fireEvent.keyDown(target, { key: 'ArrowDown' })

  await waitFor(() => expect(position()).toMatchObject({ x: before.x + 10, y: before.y + 1 }))

  // Enter는 글 수정을 열고 Esc는 닫는다
  fireEvent.keyDown(await body(), { key: 'Enter' })
  const editor = screen.getByRole('textbox', { name: '텍스트 편집' })
  fireEvent.blur(editor)
  expect(screen.queryByRole('textbox', { name: '텍스트 편집' })).toBeNull()
})

test('다른 팀원이 먼저 고친 요소는 덮어쓰지 않고 두 내용을 보여 준 뒤 고른 대로 이어 간다', async () => {
  const { server, serverText, saveAsTeammate } = setup()
  // 저장을 기다리는 동안 다른 팀원의 저장이 먼저 도착한다
  mount(open(server.fetchAs(userA), 60000))

  fireEvent.doubleClick(await body())
  fireEvent.change(screen.getByRole('textbox', { name: '텍스트 편집' }), { target: { value: '내가 쓰던 본문' } })
  await saveAsTeammate('팀원이 먼저 저장한 본문')

  const dialog = await screen.findByRole('dialog', { name: '같은 요소가 수정됐어요' })
  expect(dialog.textContent).toContain('서버의 최신 내용: 팀원이 먼저 저장한 본문')
  expect(dialog.textContent).toContain('내가 입력한 내용: 내가 쓰던 본문')
  expect(serverText()).toBe('팀원이 먼저 저장한 본문')
  // 해결하기 전에는 그 요소를 다시 고칠 수 없다
  fireEvent.doubleClick(screen.getByRole('button', { name: /^텍스트 내가 쓰던 본문/ }))
  expect(screen.queryByRole('textbox', { name: '텍스트 편집' })).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: '최신 내용으로 계속' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '같은 요소가 수정됐어요' })).toBeNull())
  expect(screen.getByRole('button', { name: /^텍스트 팀원이 먼저 저장한 본문/ })).toBeTruthy()
  expect(screen.getByRole('status').textContent).toBe('자동 저장됨')
})

test('연결이 끊기면 안내하고 편집을 막으며 다시 연결하면 이어서 편집한다', async () => {
  const { server } = setup()
  mount(open(server.fetchAs(userA)))
  await body()

  server.setOffline(true)
  const banner = await screen.findByRole('alert')
  expect(banner.textContent).toContain('연결이 끊겼어요')
  expect(screen.getByText(/연결이 복구되면 편집할 수 있어요/)).toBeTruthy()
  fireEvent.doubleClick(await body())
  expect(screen.queryByRole('textbox', { name: '텍스트 편집' })).toBeNull()

  server.setOffline(false)
  fireEvent.click(screen.getByRole('button', { name: '다시 연결' }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  fireEvent.doubleClick(await body())
  expect(screen.getByRole('textbox', { name: '텍스트 편집' })).toBeTruthy()
})

test('편집 화면을 떠나면 남은 입력을 바로 보내고 막지 않는다', async () => {
  const { server, serverText } = setup()
  const router = mount(open(server.fetchAs(userA), 60000))

  fireEvent.doubleClick(await body())
  fireEvent.change(screen.getByRole('textbox', { name: '텍스트 편집' }), { target: { value: '떠나기 직전의 본문' } })
  await router.navigate('/')

  expect(await screen.findByText('다른 화면')).toBeTruthy()
  await waitFor(() => expect(serverText()).toBe('떠나기 직전의 본문'))
})

test('보내지 못한 입력이 있으면 편집 화면을 떠나기 전에 확인을 받는다', async () => {
  const { server } = setup()
  const router = mount(open(server.fetchAs(userA), 60000))

  fireEvent.doubleClick(await body())
  fireEvent.change(screen.getByRole('textbox', { name: '텍스트 편집' }), { target: { value: '아직 보내지 않은 본문' } })

  // 같은 편집 화면 안의 슬라이드 이동은 막지 않는다
  await router.navigate(`/projects/${projectId}/slides/${exampleSnapshot.presentation!.slides[0].id}`)
  expect(screen.queryByRole('dialog', { name: '저장하지 않은 변경이 있어요' })).toBeNull()

  server.setOffline(true)
  await screen.findByRole('alert')
  void router.navigate('/')
  expect(await screen.findByRole('dialog', { name: '저장하지 않은 변경이 있어요' })).toBeTruthy()
  expect(screen.queryByText('다른 화면')).toBeNull()
})

test('아직 문서가 없으면 안내하고 개발 서버에서는 예제 문서를 만들 수 있다', async () => {
  const fetchImpl: typeof fetch = (input) =>
    Promise.resolve(
      String(input).includes('/sync-snapshot')
        ? Response.json({ ...exampleSnapshot, presentation: null })
        : new Response(new ReadableStream()),
    )
  const create = vi.fn(() => Promise.resolve())
  mount(open(fetchImpl), create)

  expect(await screen.findByRole('heading', { name: '아직 만든 PPT가 없어요.' })).toBeTruthy()
  expect(screen.getByRole('link', { name: '발표 구성으로 이동' }).getAttribute('href')).toBe(`/projects/${projectId}/outline`)
  fireEvent.click(screen.getByRole('button', { name: '개발용 예제 문서 만들기' }))
  expect(create).toHaveBeenCalledOnce()
})

test('프로젝트에 접근할 수 없게 되면 편집 화면 대신 안내를 보여 준다', async () => {
  const denied: typeof fetch = () =>
    Promise.resolve(
      Response.json(
        { error: { code: 'ACCESS_DENIED', message: '프로젝트 접근 권한이 없어요.', retryable: false }, requestId: 'req_denied' },
        { status: 403 },
      ),
    )
  mount(open(denied))

  expect((await screen.findByRole('alert')).textContent).toContain('이 프로젝트에 더 이상 접근할 수 없습니다')
  expect(screen.getByRole('link', { name: '프로젝트 목록으로' })).toBeTruthy()
})
