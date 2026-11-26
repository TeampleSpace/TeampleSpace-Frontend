import { StreamRejectedError, openEventStream } from '../editor/sse.ts'
import type { SseMessage } from '../editor/sse.ts'

// 프로젝트 이벤트 구독 하나를 화면의 여러 기능이 같이 쓴다. 탭 접속 현황과 메모 공유 편집이 듣는다
export type ProjectListener = {
  onMessage?: (message: SseMessage) => void
  // 처음 연결하거나 다시 연결했다. 그 사이 놓친 신호는 다시 읽어야 한다
  onOpen?: () => void
  // 연결이 끊기거나 거절됐다
  onClose?: () => void
}

const retryDelaysMs = [1000, 3000, 10000]

type Channel = { listeners: Set<ProjectListener>; controller: AbortController; closing?: ReturnType<typeof setTimeout> }
const channels = new Map<string, Channel>()

async function run(projectId: string, channel: Channel) {
  const { signal } = channel.controller
  for (let attempt = 0; !signal.aborted; attempt += 1) {
    try {
      await openEventStream({
        fetchImpl: (...args) => fetch(...args),
        url: `/v1/projects/${projectId}/events`,
        signal,
        onOpen: () => {
          attempt = 0
          for (const listener of channel.listeners) listener.onOpen?.()
        },
        onMessage: (message) => {
          for (const listener of channel.listeners) listener.onMessage?.(message)
        },
      })
    } catch (error) {
      // 로그인이 끝났거나 팀원이 아니면 다시 연결하지 않는다
      if (error instanceof StreamRejectedError) {
        if (!signal.aborted) for (const listener of channel.listeners) listener.onClose?.()
        return
      }
    }
    if (signal.aborted) return
    for (const listener of channel.listeners) listener.onClose?.()
    await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[Math.min(attempt, retryDelaysMs.length - 1)]))
  }
}

export function subscribeProjectEvents(projectId: string, listener: ProjectListener) {
  const existing = channels.get(projectId)
  const opened = existing ?? { listeners: new Set(), controller: new AbortController() }
  // 바로 다시 붙으면 끊지 않고 이어 쓴다
  clearTimeout(opened.closing)
  opened.listeners.add(listener)
  if (!existing) {
    channels.set(projectId, opened)
    void run(projectId, opened)
  }
  return () => {
    opened.listeners.delete(listener)
    if (opened.listeners.size > 0) return
    opened.closing = setTimeout(() => {
      if (opened.listeners.size > 0) return
      opened.controller.abort()
      if (channels.get(projectId) === opened) channels.delete(projectId)
    }, 0)
  }
}
