// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest'
import * as Y from 'yjs'
import { ApiError } from '../../shared/api/client.ts'
import { api } from '../../entities/session/api.ts'
import { subscribeProjectEvents } from '../presence/projectEvents.ts'
import type { ProjectListener } from '../presence/projectEvents.ts'
import { startMemoSync, toBase64 } from './memoSync.ts'

vi.mock('../../entities/session/api.ts', () => ({ api: { request: vi.fn() } }))
vi.mock('../presence/projectEvents.ts', () => ({ subscribeProjectEvents: vi.fn() }))

// 서버처럼 조각을 순번대로 쌓고 구독한 쪽에 바로 넘기는 대역. 실제 서버 연동은 화면 검증에서 확인한다
let log: { seq: number; data: string }[]
let listeners: ProjectListener[]
let dropFor: ProjectListener | undefined
beforeEach(() => {
  log = []
  listeners = []
  dropFor = undefined
  vi.mocked(subscribeProjectEvents).mockImplementation((_projectId, listener) => {
    listeners.push(listener)
    return () => { listeners = listeners.filter((item) => item !== listener) }
  })
  vi.mocked(api.request).mockImplementation(async (path: string, _schema: unknown, options?: { method?: string; body?: unknown }) => {
    if (!options?.method) {
      const after = Number(new URL(path, 'http://local').searchParams.get('after'))
      return { updates: log.filter((update) => update.seq > after), hasMore: false }
    }
    const body = options.body as { data: string; initial?: boolean }
    if (body.initial && log.length) throw new ApiError(409, { error: { code: 'MATERIAL_STATE_CONFLICT', message: '이미 시작됐어요', retryable: false }, requestId: 'request' })
    const seq = log.length + 1
    log.push({ seq, data: body.data })
    // 응답 뒤에 구독으로 넘긴다
    setTimeout(() => {
      for (const listener of listeners) {
        if (listener === dropFor) { dropFor = undefined; continue }
        listener.onMessage?.({ event: 'memo.updated', data: JSON.stringify({ materialId: 'memo', seq, data: body.data }) })
      }
    })
    return { seq }
  })
})

function client(seedText: string) {
  const doc = new Y.Doc()
  const states: { ready: boolean }[] = []
  const sync = startMemoSync({
    projectId: 'project', materialId: 'memo', doc,
    seed: async () => {
      const seeded = new Y.Doc()
      seeded.getText('body').insert(0, seedText)
      return Y.encodeStateAsUpdate(seeded)
    },
    onState: (state) => states.push(state),
  })
  return { doc, text: () => doc.getText('body').toString(), ready: () => states.at(-1)?.ready === true, sync }
}

test('처음 연 두 사람 중 한 사람의 초기 내용만 남고 입력이 서로에게 바로 간다', async () => {
  const first = client('저장된 본문')
  const second = client('저장된 본문')
  await vi.waitFor(() => expect(first.ready() && second.ready()).toBe(true))
  expect(log).toHaveLength(1)
  expect(first.text()).toBe('저장된 본문')
  expect(second.text()).toBe('저장된 본문')

  first.doc.getText('body').insert(0, '가')
  second.doc.getText('body').insert(second.text().length, '나')
  await vi.waitFor(() => expect(first.text()).toBe('가저장된 본문나'))
  expect(second.text()).toBe('가저장된 본문나')
})

test('놓친 조각은 순번 차이로 알아채고 목록에서 다시 읽는다', async () => {
  const first = client('본문')
  const second = client('본문')
  await vi.waitFor(() => expect(first.ready() && second.ready()).toBe(true))
  dropFor = listeners[1]
  first.doc.getText('body').insert(0, '하나 ')
  await vi.waitFor(() => expect(log).toHaveLength(2))
  first.doc.getText('body').insert(0, '둘 ')
  await vi.waitFor(() => expect(second.text()).toBe('둘 하나 본문'))
  first.sync.stop()
  second.sync.stop()
})

test('보내지 못한 입력은 남겨 두었다가 다시 보낸다', async () => {
  const only = client('본문')
  await vi.waitFor(() => expect(only.ready()).toBe(true))
  const request = vi.mocked(api.request).getMockImplementation()!
  vi.mocked(api.request).mockRejectedValueOnce(new TypeError('연결 끊김'))
  only.doc.getText('body').insert(0, '끊긴 동안 ')
  await vi.waitFor(() => expect(vi.mocked(api.request)).toHaveBeenCalledTimes(3))
  expect(log).toHaveLength(1)
  vi.mocked(api.request).mockImplementation(request)
  only.sync.retry()
  await vi.waitFor(() => expect(log).toHaveLength(2))
  const check = new Y.Doc()
  for (const update of log) Y.applyUpdate(check, Uint8Array.from(atob(update.data), (char) => char.charCodeAt(0)))
  expect(check.getText('body').toString()).toBe('끊긴 동안 본문')
  expect(toBase64(new Uint8Array([1, 2, 3]))).toBe('AQID')
})

