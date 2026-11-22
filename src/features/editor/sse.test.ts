import { expect, test, vi } from 'vitest'
import { createSseParser, openEventStream } from './sse.ts'
import type { SseMessage } from './sse.ts'

function collect() {
  const messages: SseMessage[] = []
  return { messages, feed: createSseParser((message) => messages.push(message)) }
}

test('식별자, 종류, 내용을 읽는다', () => {
  const { messages, feed } = collect()
  feed('id: 7\nevent: element.updated\ndata: {"a":1}\n\n')
  expect(messages).toEqual([{ id: '7', event: 'element.updated', data: '{"a":1}' }])
})

test('조각이 중간에서 잘려 와도 메시지를 온전히 만든다', () => {
  const { messages, feed } = collect()
  feed('id: 1\nevent: element.up')
  expect(messages).toHaveLength(0)
  feed('dated\ndata: {"text":"한')
  feed('글"}\n\nid: 2\nevent: change.created\ndata: {}\n\n')
  expect(messages.map((message) => message.id)).toEqual(['1', '2'])
  expect(messages[0].data).toBe('{"text":"한글"}')
})

test('연결 유지용 주석 줄은 메시지로 만들지 않는다', () => {
  const { messages, feed } = collect()
  feed(': keep-alive\n\n')
  feed('event: snapshot_required\ndata: {}\n\n')
  expect(messages).toEqual([{ id: undefined, event: 'snapshot_required', data: '{}' }])
})

test('아무것도 오지 않는 연결은 정해 둔 시간이 지나면 끊긴 것으로 본다', async () => {
  vi.useFakeTimers()
  try {
    const encoder = new TextEncoder()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start: (value) => void (controller = value) })
    const result = openEventStream({
      fetchImpl: () => Promise.resolve(new Response(body)),
      url: '/v1/projects/p/events',
      signal: new AbortController().signal,
      idleTimeoutMs: 40000,
      onOpen: () => {},
      onMessage: () => {},
    }).then(
      () => 'ended',
      (error: Error) => error.message,
    )

    // 연결 유지용 주석 줄이 오는 동안은 끊지 않는다
    await vi.advanceTimersByTimeAsync(30000)
    controller.enqueue(encoder.encode(': keep-alive\n\n'))
    await vi.advanceTimersByTimeAsync(30000)
    expect(await Promise.race([result, Promise.resolve('open')])).toBe('open')

    await vi.advanceTimersByTimeAsync(40000)
    expect(await result).toBe('이벤트 연결이 응답하지 않습니다')
  } finally {
    vi.useRealTimers()
  }
})
