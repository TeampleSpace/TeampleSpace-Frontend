import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { ApiError } from '../../../shared/api/client.ts'
import { Button } from '../../../shared/ui/Button.tsx'
import { RequestError } from '../../../shared/ui/RequestError.tsx'
import { useSession } from '../../../entities/session/sessionContext.ts'
import { announceDecided, createdEvent, requestsApi } from '../../../entities/request/api.ts'
import type { ChangeRequest, ChangeRequestType } from '../../../entities/request/api.ts'
import styles from './RequestBanner.module.css'

export const requestPollMs = 5000
// 조사까지 붙인 작업 이름
const objects: Record<ChangeRequestType, string> = {
  outline_generation: 'AI 구성 만들기를', presentation_generation: 'PPT 만들기를', design_change: '디자인 변경을',
}
const names: Record<ChangeRequestType, string> = {
  outline_generation: 'AI 구성 만들기', presentation_generation: 'PPT 만들기', design_change: '디자인 변경',
}

function noticeOf(request: ChangeRequest, me?: string) {
  const who = request.requestedBy.userId === me ? '내' : `${request.requestedBy.name}님의`
  const by = request.decidedBy?.userId === me ? '' : `${request.decidedBy?.name ?? '팀원'}님이 `
  const task = `${who} ${names[request.type]} 요청`
  if (request.state === 'approved') return `${by}${task}을 승인했어요`
  if (request.state === 'rejected') return `${by}${task}을 거절했어요`
  if (request.state === 'canceled') return `${task}이 취소됐어요`
  return `${task}을 승인했지만 실행하지 못했어요. ${request.error?.message ?? ''}`.trim()
}

// 프로젝트 화면 위에 기다리는 승인 요청과 방금 처리된 요청을 보여 준다
export function RequestBanner({ projectId }: { projectId: string }) {
  const { user } = useSession()
  const [pending, setPending] = useState<ChangeRequest[]>([])
  const [notices, setNotices] = useState<ChangeRequest[]>([])
  const [acting, setActing] = useState<string>()
  const [failure, setFailure] = useState<unknown>()
  // 처음 읽은 목록은 이미 지난 일이라 알리지 않는다
  const seen = useRef<Map<string, ChangeRequest['state']> | null>(null)
  const section = useRef<HTMLElement>(null)
  // 누른 버튼이 사라지면 결과 알림이나 다음 버튼으로 포커스를 옮긴다
  const focusNext = useRef<string | null>(null)
  useEffect(() => {
    const target = focusNext.current
    if (target === null) return
    focusNext.current = null
    const next = section.current?.querySelector<HTMLElement>(`[data-request="${target}"] button`)
      ?? section.current?.querySelector<HTMLElement>('button') ?? document.getElementById('main')
    next?.focus()
  })

  function observe(items: ChangeRequest[]) {
    const known = seen.current
    const next = new Map(known ?? [])
    const decided: ChangeRequest[] = []
    for (const item of items) {
      if (known && item.state !== 'pending' && known.get(item.id) !== item.state) decided.push(item)
      next.set(item.id, item.state)
    }
    seen.current = next
    if (!decided.length) return
    setNotices((current) => [...decided, ...current.filter((notice) => !decided.some((item) => item.id === notice.id))].slice(0, 3))
    decided.forEach(announceDecided)
  }

  async function load(signal?: AbortSignal) {
    try {
      const { items } = await requestsApi.list(projectId, signal)
      if (signal?.aborted) return
      setPending(items.filter((item) => item.state === 'pending'))
      observe(items)
    } catch (reason) {
      // 접근을 잃으면 숨긴다. 잠깐 끊긴 것은 다음 조회에서 다시 읽는다
      if (!signal?.aborted && reason instanceof ApiError && [403, 404, 410].includes(reason.status)) setPending([])
    }
  }
  const poll = useEffectEvent((signal: AbortSignal) => { void load(signal) })

  useEffect(() => {
    const controller = new AbortController()
    const focus = () => poll(controller.signal)
    queueMicrotask(focus)
    const timer = setInterval(() => { if (document.visibilityState === 'visible') focus() }, requestPollMs)
    window.addEventListener('focus', focus)
    window.addEventListener(createdEvent, focus)
    return () => {
      controller.abort(); clearInterval(timer)
      window.removeEventListener('focus', focus); window.removeEventListener(createdEvent, focus)
    }
  }, [projectId])

  async function act(request: ChangeRequest, action: 'approve' | 'reject' | 'cancel') {
    if (acting) return
    setActing(request.id)
    setFailure(undefined)
    try {
      const decided = await requestsApi[action](request.id)
      setPending((items) => items.filter((item) => item.id !== decided.id))
      observe([decided])
    } catch (reason) {
      setFailure(reason)
      await load()
    } finally {
      focusNext.current = request.id
      setActing(undefined)
    }
  }

  if (!pending.length && !notices.length && !failure) return null
  return <section ref={section} className={styles.banner} aria-label="승인 요청">
    {pending.map((request) => {
      const mine = request.requestedBy.userId === user?.id
      return <div key={request.id} className={styles.item} data-request={request.id}>
        <p>{mine ? `${objects[request.type]} 요청했어요. 다른 팀원 한 명이 승인하면 실행돼요` : `${request.requestedBy.name}님이 ${objects[request.type]} 요청했어요`}</p>
        <div className={styles.actions}>
          {mine
            ? <Button variant="secondary" loading={acting === request.id} disabled={Boolean(acting)} onClick={() => void act(request, 'cancel')}>요청 취소</Button>
            : <>
              <Button loading={acting === request.id} disabled={Boolean(acting)} onClick={() => void act(request, 'approve')}>승인하기</Button>
              <Button variant="secondary" disabled={Boolean(acting)} onClick={() => void act(request, 'reject')}>거절</Button>
            </>}
        </div>
      </div>
    })}
    {notices.map((request) => <div key={request.id} className={styles.item} role="status" data-request={request.id}>
      <p className={request.state === 'failed' ? styles.failed : undefined}>{noticeOf(request, user?.id)}</p>
      <Button variant="text" aria-label="알림 닫기" onClick={() => {
        focusNext.current = ''
        setNotices((items) => items.filter((item) => item.id !== request.id))
      }}>닫기</Button>
    </div>)}
    <RequestError error={failure} />
  </section>
}
