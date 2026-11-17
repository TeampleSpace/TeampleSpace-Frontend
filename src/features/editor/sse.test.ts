import { expect, test } from 'vitest'
import { createSseParser } from './sse.ts'
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
