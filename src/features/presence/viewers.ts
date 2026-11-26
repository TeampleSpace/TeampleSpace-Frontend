import { useEffect, useState } from 'react'
import { z } from 'zod'
import { api } from '../../entities/session/api.ts'
import { emptySchema } from '../../entities/session/model.ts'
import { allMembers } from '../../entities/project/api.ts'
import { StreamRejectedError, openEventStream } from '../editor/sse.ts'

export const tabs = ['overview', 'materials', 'outline', 'design', 'slides', 'settings'] as const
export type Tab = typeof tabs[number]
export const tabLabels: Record<Tab, string> = {
  overview: '프로젝트 개요', materials: '자료', outline: '발표 구성', design: '디자인 설정', slides: '슬라이드', settings: '프로젝트 설정',
}

// 서버는 20초 동안 알림이 없으면 떠난 것으로 본다
export const viewingBeatMs = 8000
export const nameRetryMs = 5000
const retryDelaysMs = [1000, 3000, 10000]

const viewersSchema = z.object({
  projectId: z.string(),
  viewers: z.array(z.object({ userId: z.string(), tab: z.enum(tabs) })),
})

export type Viewer = { userId: string; name: string; tab: Tab }

// 프로젝트 주소의 첫 단계로 탭을 정한다
export function tabOf(pathname: string): Tab | undefined {
  const match = /^\/projects\/[^/]+(?:\/([^/]+))?/.exec(pathname)
  if (!match) return undefined
  const segment = match[1] ?? 'overview'
  return (tabs as readonly string[]).includes(segment) ? segment as Tab : undefined
}

// 팀원마다 같은 색을 쓴다. 메모 커서도 이 색을 쓴다
const palette = ['#d9480f', '#1971c2', '#2f9e44', '#9c36b5', '#e8590c', '#0c8599', '#c2255c', '#5f3dc4']
export function colorOf(userId: string) {
  let hash = 0
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return palette[Math.abs(hash) % palette.length]
}

// 페이지마다 다른 값. 새로고침 때 이전 페이지의 떠남이 늦게 도착해도 서버가 새 페이지를 지우지 않는다
const viewId = crypto.randomUUID()
// 이 창에서 보낼 때마다 늘린다. 서버는 늦게 도착한 이전 알림을 버린다
let noticeSeq = 0

let pendingLeave: { projectId: string; timer: ReturnType<typeof setTimeout> } | undefined

function leave(projectId: string) {
  void api.request(`/projects/${projectId}/viewing`, emptySchema, { method: 'PUT', body: { tab: null, viewId, seq: ++noticeSeq }, keepalive: true }).catch(() => {})
}

// 내가 보는 탭을 알리고 다른 팀원이 보는 탭을 받는다
export function useProjectViewers(projectId: string | undefined, tab: Tab | undefined): Viewer[] {
  const [raw, setRaw] = useState<{ projectId: string; viewers: { userId: string; tab: Tab }[] }>()
  const [names, setNames] = useState<{ projectId: string; map: Map<string, string> }>()
  // 팀원 이름을 읽지 못하면 잠시 뒤 다시 읽는다
  const [nameAttempt, setNameAttempt] = useState(0)

  // 탭을 옮길 때는 떠남을 보내지 않는다. 떠남이 새 탭 알림보다 늦게 도착하면 잠깐 사라져 보인다
  useEffect(() => {
    if (!projectId || !tab) return
    const beat = () => { void api.request(`/projects/${projectId}/viewing`, emptySchema, { method: 'PUT', body: { tab, viewId, seq: ++noticeSeq }, timeoutMs: 10000 }).catch(() => {}) }
    beat()
    const timer = setInterval(beat, viewingBeatMs)
    return () => clearInterval(timer)
  }, [projectId, tab])

  useEffect(() => {
    if (!projectId) return
    // 같은 프로젝트로 바로 다시 붙으면 앞서 예약한 떠남을 취소한다. 개발 모드의 두 번 실행에서도 떠남이 새 알림 뒤에 도착하지 않는다
    if (pendingLeave?.projectId === projectId) clearTimeout(pendingLeave.timer)
    pendingLeave = undefined
    const controller = new AbortController()
    const onHide = () => leave(projectId)
    window.addEventListener('pagehide', onHide)
    void (async () => {
      for (let attempt = 0; !controller.signal.aborted; attempt += 1) {
        try {
          await openEventStream({
            fetchImpl: (...args) => fetch(...args),
            url: `/v1/projects/${projectId}/events`,
            signal: controller.signal,
            onOpen: () => { attempt = 0; setRaw({ projectId, viewers: [] }) },
            onMessage: (message) => {
              if (message.event !== 'viewers.updated') return
              try {
                const parsed = viewersSchema.safeParse(JSON.parse(message.data))
                if (parsed.success) setRaw({ projectId, viewers: parsed.data.viewers })
              } catch { /* 깨진 신호는 버린다 */ }
            },
          })
        } catch (error) {
          // 로그인이 끝났거나 팀원이 아니면 다시 연결하지 않는다
          if (error instanceof StreamRejectedError) {
            if (!controller.signal.aborted) setRaw({ projectId, viewers: [] })
            return
          }
        }
        if (controller.signal.aborted) return
        // 연결이 끊긴 동안에는 팀원이 떠나도 알 수 없으니 목록을 비운다
        setRaw({ projectId, viewers: [] })
        await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[Math.min(attempt, retryDelaysMs.length - 1)]))
      }
    })()
    return () => {
      controller.abort()
      window.removeEventListener('pagehide', onHide)
      pendingLeave = { projectId, timer: setTimeout(() => leave(projectId), 0) }
    }
  }, [projectId])

  const viewers = raw && raw.projectId === projectId ? raw.viewers : []
  const known = names && names.projectId === projectId ? names.map : undefined
  // 처음이거나 모르는 팀원이 보이면 팀원 이름을 다시 읽는다
  const missing = viewers.some((viewer) => !known?.has(viewer.userId))
  useEffect(() => {
    if (!projectId || !missing) return
    const controller = new AbortController()
    let retry: ReturnType<typeof setTimeout> | undefined
    void allMembers(projectId, controller.signal)
      .then((members) => setNames({ projectId, map: new Map(members.map((member) => [member.userId, member.name])) }))
      .catch(() => { if (!controller.signal.aborted) retry = setTimeout(() => setNameAttempt((value) => value + 1), nameRetryMs) })
    return () => { controller.abort(); clearTimeout(retry) }
  }, [projectId, missing, nameAttempt])

  return viewers.map((viewer) => ({ ...viewer, name: known?.get(viewer.userId) ?? '팀원' }))
}
