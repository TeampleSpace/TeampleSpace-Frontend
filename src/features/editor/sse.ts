// fetch로 읽는 이벤트 스트림
// 기본 EventSource는 새 연결에 Last-Event-ID 헤더를 직접 실을 수 없어 fetch를 쓴다

export type SseMessage = { id?: string; event: string; data: string }

// 스트림 조각을 받아 완성된 메시지마다 콜백을 부른다
// ponytail: 줄바꿈이 조각 경계에서 갈라지는 CRLF는 다루지 않는다. 실제 서버 연동에서 필요하면 보강한다
export function createSseParser(onMessage: (message: SseMessage) => void) {
  let buffer = ''
  return (chunk: string) => {
    buffer += chunk.replaceAll('\r\n', '\n')
    for (;;) {
      const end = buffer.indexOf('\n\n')
      if (end < 0) return
      const block = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)

      let id: string | undefined
      let event = 'message'
      const data: string[] = []
      for (const line of block.split('\n')) {
        // 콜론으로 시작하는 줄은 연결 유지용 주석이다
        if (line.startsWith(':')) continue
        const colon = line.indexOf(':')
        const field = colon < 0 ? line : line.slice(0, colon)
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
        if (field === 'id') id = value
        else if (field === 'event') event = value
        else if (field === 'data') data.push(value)
      }
      if (data.length > 0) onMessage({ id, event, data: data.join('\n') })
    }
  }
}

// 인증이나 권한 문제로 연결이 거절된 경우. 자동으로 다시 연결하지 않는다
export class StreamRejectedError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`이벤트 연결이 거절됐습니다 (${status})`)
    this.name = 'StreamRejectedError'
    this.status = status
  }
}

// 연결이 끝나면 끝나고 끊기면 오류를 던진다
export async function openEventStream(options: {
  fetchImpl: typeof fetch
  url: string
  lastEventId?: string
  signal: AbortSignal
  onOpen: () => void
  onMessage: (message: SseMessage) => void
}): Promise<void> {
  const headers: Record<string, string> = { Accept: 'text/event-stream' }
  if (options.lastEventId !== undefined) headers['Last-Event-ID'] = options.lastEventId

  const response = await options.fetchImpl(options.url, {
    headers,
    credentials: 'same-origin',
    signal: options.signal,
  })
  if (response.status === 401 || response.status === 403) {
    throw new StreamRejectedError(response.status)
  }
  if (!response.ok || !response.body) {
    throw new Error(`이벤트 연결 실패 (${response.status})`)
  }
  options.onOpen()

  const parse = createSseParser(options.onMessage)
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    parse(value)
  }
}
