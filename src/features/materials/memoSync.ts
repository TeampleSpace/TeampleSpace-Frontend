import * as Y from 'yjs'
import { applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import type { Awareness } from 'y-protocols/awareness'
import { z } from 'zod'
import { ApiError } from '../../shared/api/client.ts'
import { api } from '../../entities/session/api.ts'
import { subscribeProjectEvents } from '../presence/projectEvents.ts'

// 서버에서 받은 조각을 적용할 때의 출처. 이 출처의 변경은 다시 보내지 않는다
export const remote = Symbol('remote')

// 처음 열 때 조각이 이만큼 쌓여 있으면 한 덩어리로 줄인다
const compactAfter = 200
const retryDelaysMs = [1000, 3000, 10000]

const listSchema = z.object({ updates: z.array(z.object({ seq: z.number().int(), data: z.string() })), hasMore: z.boolean() })
const createdSchema = z.object({ seq: z.number().int() })
const updatedSchema = z.object({ materialId: z.string(), seq: z.number().int(), data: z.string() })
const awarenessSchema = z.object({ materialId: z.string(), data: z.string() })
// 커서를 옮기는 동안 상태를 이 간격으로 모아 보낸다
const awarenessDelayMs = 120

const emptyBody = z.unknown()

export function toBase64(bytes: Uint8Array) {
  let text = ''
  for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(text)
}

export function fromBase64(data: string) {
  return Uint8Array.from(atob(data), (char) => char.charCodeAt(0))
}

export type SyncState = { ready: boolean; unsent: boolean; offline: boolean; error?: unknown }

// 메모 하나의 공유 문서를 서버 조각 목록과 이벤트 구독으로 맞춘다
// seed는 조각이 하나도 없는 기존 메모를 저장된 본문으로 처음 채운 조각을 만든다
export function startMemoSync(options: {
  projectId: string
  materialId: string
  doc: Y.Doc
  // 주면 커서와 선택 영역을 팀원과 주고받는다
  awareness?: Awareness
  seed: () => Promise<Uint8Array>
  onState: (state: SyncState) => void
}) {
  const { projectId, materialId, doc } = options
  const path = `/materials/${materialId}/memo-updates`
  let lastSeq = 0
  let stopped = false
  let ready = false
  let pending: Uint8Array[] = []
  let sending = false
  let attempt = 0
  let offline = false
  let error: unknown
  let loading: Promise<void> | undefined
  let reloadAgain = false
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  // 처음 읽을 때 받은 조각 수. 많으면 한 덩어리로 줄인다
  let received = 0

  const report = () => { if (!stopped) options.onState({ ready, unsent: pending.length > 0 || sending, offline, error }) }

  function apply(seq: number, data: string) {
    Y.applyUpdate(doc, fromBase64(data), remote)
    lastSeq = Math.max(lastSeq, seq)
    received += 1
  }

  // 아는 순번 다음 조각을 끝까지 읽는다. 읽는 중에 다시 요청되면 끝난 뒤 한 번 더 읽는다
  function load(): Promise<void> {
    if (loading) { reloadAgain = true; return loading }
    loading = (async () => {
      do {
        reloadAgain = false
        for (;;) {
          const page = await api.request(`${path}?after=${lastSeq}`, listSchema, { timeoutMs: 15000 })
          if (stopped) return
          for (const update of page.updates) apply(update.seq, update.data)
          if (!page.hasMore) break
        }
      } while (reloadAgain)
    })().finally(() => { loading = undefined })
    return loading
  }

  // 놓친 조각을 읽는다. 읽지 못하면 잠시 뒤 다시 읽는다
  let reloadTimer: ReturnType<typeof setTimeout> | undefined
  function reload() {
    clearTimeout(reloadTimer)
    load().catch(() => { if (!stopped) reloadTimer = setTimeout(reload, retryDelaysMs[1]) })
  }

  async function send() {
    if (sending || stopped || !ready || pending.length === 0) return
    const batch = Y.mergeUpdates(pending)
    pending = []
    sending = true
    report()
    try {
      const { seq } = await api.request(path, createdSchema, { method: 'POST', body: { data: toBase64(batch) }, timeoutMs: 15000 })
      attempt = 0
      offline = false
      error = undefined
      // 그 사이 다른 팀원의 조각이 끼었으면 놓친 것을 읽는다
      if (seq === lastSeq + 1) lastSeq = seq
      else reload()
    } catch (reason) {
      // ponytail: 서버가 받았는데 응답만 잃었으면 같은 조각이 한 번 더 쌓인다. 적용 결과는 같아 그대로 둔다
      pending.unshift(batch)
      offline = true
      error = reason
      if (!(reason instanceof ApiError) || reason.retryable || reason.status >= 500) {
        clearTimeout(retryTimer)
        retryTimer = setTimeout(() => void send(), retryDelaysMs[Math.min(attempt++, retryDelaysMs.length - 1)])
      }
    } finally {
      sending = false
      report()
    }
    if (pending.length > 0 && !offline) void send()
  }

  // 바뀐 커서 상태를 모아 보낸다. 처음 보는 팀원이 오면 내 상태를 다시 보내 그 팀원도 내 커서를 본다
  const { awareness } = options
  const changedClients = new Set<number>()
  let awarenessTimer: ReturnType<typeof setTimeout> | undefined
  function sendAwareness(keepalive = false) {
    clearTimeout(awarenessTimer)
    awarenessTimer = undefined
    if (!awareness || changedClients.size === 0) return
    const data = toBase64(encodeAwarenessUpdate(awareness, [...changedClients]))
    changedClients.clear()
    void api.request(`/materials/${materialId}/memo-awareness`, emptyBody, { method: 'POST', body: { data }, keepalive, timeoutMs: 10000 }).catch(() => {})
  }
  // 이미 예약한 전송은 그대로 두어 계속 움직이는 동안에도 정해진 간격마다 최신 상태를 보낸다
  function scheduleAwareness() {
    if (awarenessTimer === undefined) awarenessTimer = setTimeout(() => sendAwareness(), awarenessDelayMs)
  }
  const onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === remote || !awareness) return
    for (const client of [...added, ...updated, ...removed]) if (client === awareness.clientID) changedClients.add(client)
    if (changedClients.size === 0 || !ready) return
    scheduleAwareness()
  }
  awareness?.on('update', onAwareness)
  // 창을 닫거나 주소를 옮기면 화면 정리 없이 사라지므로 이때 내 커서를 지운다
  // 뒤로 가기 캐시에서 되살아나면 지웠던 내 상태를 다시 알린다
  let hidden: Record<string, unknown> | null = null
  function leaveCursor() {
    if (!awareness || !ready) return
    hidden = awareness.getLocalState()
    removeAwarenessStates(awareness, [awareness.clientID], 'local')
    changedClients.add(awareness.clientID)
    sendAwareness(true)
  }
  window.addEventListener('pagehide', leaveCursor)
  const restoreCursor = (event: PageTransitionEvent) => {
    if (!event.persisted || !awareness || !hidden || stopped) return
    awareness.setLocalState(hidden)
    hidden = null
  }
  window.addEventListener('pageshow', restoreCursor)

  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === remote) return
    pending.push(update)
    report()
    void send()
  }
  doc.on('update', onUpdate)

  const unsubscribe = subscribeProjectEvents(projectId, {
    // 다시 연결되면 그 사이 놓친 조각과 보내지 못한 입력을 챙긴다
    onOpen: () => {
      if (!ready) return
      reload()
      void send()
    },
    onMessage: (message) => {
      if (message.event === 'memo.awareness' && awareness && ready) {
        let state
        try { state = awarenessSchema.safeParse(JSON.parse(message.data)) } catch { return }
        if (!state.success || state.data.materialId !== materialId) return
        const known = new Set(awareness.getStates().keys())
        applyAwarenessUpdate(awareness, fromBase64(state.data.data), remote)
        if ([...awareness.getStates().keys()].some((client) => !known.has(client))) {
          changedClients.add(awareness.clientID)
          scheduleAwareness()
        }
        return
      }
      if (message.event !== 'memo.updated') return
      let parsed
      try { parsed = updatedSchema.safeParse(JSON.parse(message.data)) } catch { return }
      if (!parsed.success || parsed.data.materialId !== materialId || !ready) return
      const { seq, data } = parsed.data
      if (seq <= lastSeq) return
      if (seq === lastSeq + 1 && !loading) apply(seq, data)
      else reload()
    },
  })

  void (async () => {
    try {
      await load()
      const count = received
      if (lastSeq === 0) {
        const update = await options.seed()
        if (stopped) return
        try {
          const { seq } = await api.request(path, createdSchema, { method: 'POST', body: { data: toBase64(update), initial: true }, timeoutMs: 15000 })
          Y.applyUpdate(doc, update, remote)
          lastSeq = seq
        } catch (reason) {
          // 다른 팀원이 먼저 열어 초기 내용을 넣었다
          if (!(reason instanceof ApiError && reason.code === 'MATERIAL_STATE_CONFLICT')) throw reason
          await load()
        }
      }
      if (stopped) return
      if (count >= compactAfter) {
        void api.request(`${path}/compaction`, emptyBody, {
          method: 'POST', body: { upTo: lastSeq, data: toBase64(Y.encodeStateAsUpdate(doc)) }, timeoutMs: 30000,
        }).catch(() => {})
      }
      ready = true
      error = undefined
      report()
      // 들어왔음을 알려 팀원들이 자기 커서 상태를 다시 보내게 한다
      if (awareness) { changedClients.add(awareness.clientID); sendAwareness() }
      // 준비하는 동안 버린 팀원의 조각이 있을 수 있어 한 번 더 읽는다
      reload()
    } catch (reason) {
      error = reason
      report()
    }
  })()

  return {
    // 보내지 못한 조각을 바로 다시 보낸다
    retry: () => { clearTimeout(retryTimer); offline = false; void send(); reload() },
    stop: () => {
      stopped = true
      clearTimeout(retryTimer)
      clearTimeout(reloadTimer)
      doc.off('update', onUpdate)
      unsubscribe()
      window.removeEventListener('pagehide', leaveCursor)
      window.removeEventListener('pageshow', restoreCursor)
      // 떠나면 팀원 화면에서 내 커서를 지운다
      awareness?.off('update', onAwareness)
      leaveCursor()
    },
  }
}
