import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { Editor } from '@tiptap/react'
import { ApiError } from '../../../shared/api/client.ts'
import { Button } from '../../../shared/ui/Button.tsx'
import { RequestError } from '../../../shared/ui/RequestError.tsx'
import { materialsApi } from '../../../entities/material/api.ts'
import { useSession } from '../../../entities/session/sessionContext.ts'
import { colorOf } from '../../presence/viewers.ts'
import type { Material } from '../../../entities/material/model.ts'
import { remote, startMemoSync } from '../memoSync.ts'
import type { SyncState } from '../memoSync.ts'
import { MarkdownEditor } from './MarkdownEditor.tsx'
import { memoExtensions } from '../memoExtensions.ts'
import type { CaretUser } from '../memoExtensions.ts'
import styles from './Materials.module.css'
import memo from './Memo.module.css'

// 입력을 멈추고 이만큼 지나면 본문을 자료 개정으로 저장한다
export const memoSaveDelayMs = 1200
const saveRetryMs = 5000

// 아직 공유 편집을 시작하지 않은 메모를 저장된 본문으로 처음 채운 조각
async function seedFrom(material: Material) {
  const source = await materialsApi.source(material.id, material.currentRevision?.id)
  const doc = new Y.Doc()
  const editor = new Editor({ extensions: memoExtensions(doc) })
  editor.commands.setContent(source.markdown ?? '', { contentType: 'markdown' })
  editor.destroy()
  return Y.encodeStateAsUpdate(doc)
}

// 메모 자료를 여러 명이 함께 고친다. 입력은 바로 팀원에게 가고, 멈추면 본문을 새 원문 개정으로 저장한다
export function MemoPad({ material, onSaved, onDirtyChange, onError }: {
  material: Material; onSaved: (next: Material) => void
  onDirtyChange: (dirty: boolean) => void; onError: (reason: unknown) => void
}) {
  const fieldId = useId()
  const [attempt, setAttempt] = useState(0)
  // 다시 불러오면 이전 시도의 문서와 상태는 쓰지 않는다
  const [opened, setOpened] = useState<{ attempt: number; doc?: Y.Doc; awareness?: Awareness; sync: SyncState }>()
  const doc = opened?.attempt === attempt ? opened.doc : undefined
  const awareness = opened?.attempt === attempt ? opened.awareness : undefined
  const { user } = useSession()
  const sync = opened?.attempt === attempt ? opened.sync : { ready: false, unsent: false, offline: false }
  const retry = useRef<() => void>(undefined)
  // 본문 저장. 같은 자료의 다른 경로 수정으로 버전이 바뀌면 최신 버전으로 다시 보낸다
  const [saving, setSaving] = useState<'idle' | 'waiting' | 'saving' | 'failed'>('idle')
  const [saveError, setSaveError] = useState<unknown>()
  const version = useRef(material.version)
  const typed = useRef<string>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const busy = useRef(false)
  const onSavedRef = useRef(onSaved)
  useEffect(() => { onSavedRef.current = onSaved })

  const latest = useRef(material)
  useEffect(() => { latest.current = material })
  const { id, projectId } = material
  useEffect(() => {
    const next = new Y.Doc()
    const cursors = new Awareness(next)
    const session = startMemoSync({
      projectId, materialId: id, doc: next, awareness: cursors,
      seed: () => seedFrom(latest.current),
      onState: (state) => setOpened({ attempt, doc: state.ready ? next : undefined, awareness: cursors, sync: state }),
    })
    retry.current = session.retry
    return () => { session.stop(); cursors.destroy(); next.destroy() }
  }, [id, projectId, attempt])
  useEffect(() => () => clearTimeout(timer.current), [])
  // 내 입력으로 공유 문서가 바뀌었을 때만 본문을 저장한다. 팀원의 변경이나 처음 그릴 때의 변경은 그 사람이 저장한다
  const edited = useRef(false)
  useEffect(() => {
    if (!doc) return
    const mark = (_update: Uint8Array, origin: unknown) => { if (origin !== remote) edited.current = true }
    doc.on('update', mark)
    return () => doc.off('update', mark)
  }, [doc])

  // 저장할 본문이 남았는지
  const pending = useRef(false)
  // 이 화면에서 마지막으로 저장한 본문. 저장한 뒤 팀원의 변경이 합쳐져 달라지면 다시 저장한다
  const lastSaved = useRef<string>(undefined)

  // 보낼 때마다 지금 공유 문서의 본문을 읽어 팀원의 입력까지 함께 저장한다
  async function save() {
    clearTimeout(timer.current)
    if (busy.current || !pending.current || typed.current === undefined) return
    pending.current = false
    busy.current = true
    setSaving('saving')
    setSaveError(undefined)
    try {
      for (let tries = 0; ; tries += 1) {
        try {
          const value = typed.current
          const next = await materialsApi.update(material.id, version.current, { markdown: value })
          version.current = next.version
          lastSaved.current = value
          onSavedRef.current(next)
          break
        } catch (reason) {
          if (!(reason instanceof ApiError && reason.code === 'VERSION_CONFLICT') || tries >= 2) throw reason
          // 팀원이 같은 본문을 먼저 저장했으면 다시 저장하지 않는다
          const current = await materialsApi.get(material.id)
          version.current = current.version
          const source = await materialsApi.source(material.id, current.currentRevision?.id)
          if (source.markdown === typed.current) { lastSaved.current = typed.current; onSavedRef.current(current); break }
        }
      }
      if (pending.current) { setSaving('waiting'); timer.current = setTimeout(() => void save(), memoSaveDelayMs) }
      else setSaving('idle')
    } catch (reason) {
      pending.current = true
      // 연결 문제면 입력은 이미 팀원에게 갔으니 잠시 뒤 본문 저장만 다시 한다
      if (!(reason instanceof ApiError) || reason.retryable || reason.status >= 500) {
        setSaving('waiting')
        timer.current = setTimeout(() => void save(), saveRetryMs)
        return
      }
      setSaveError(reason)
      setSaving('failed')
      onError(reason)
    } finally {
      busy.current = false
    }
  }

  // 편집기의 본문은 팀원의 변경까지 늘 최신으로 받아 둔다. 내 입력이거나, 내가 저장한 뒤 팀원의 변경이 합쳐져 본문이 달라졌으면 저장을 예약한다
  // 서로의 변경을 받기 전에 둘 다 저장을 마쳐도 나중에 합쳐진 본문이 개정으로 남는다
  function change(value: string) {
    typed.current = value
    const mine = edited.current
    edited.current = false
    if (!mine && (lastSaved.current === undefined || lastSaved.current === value)) return
    pending.current = true
    if (busy.current) return
    setSaving('waiting')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(), memoSaveDelayMs)
  }

  const dirty = sync.unsent || saving !== 'idle'
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const me = useMemo(() => user ? { name: user.name, color: colorOf(user.id) } : undefined, [user])
  if (!doc && sync.error) return <section className={memo.pad} aria-label="공유 문서">
    <RequestError error={sync.error} action={<Button variant="text" onClick={() => setAttempt((value) => value + 1)}>다시 불러오기</Button>} />
  </section>
  if (!doc) return <section className={memo.pad} aria-label="공유 문서">
    <p className={styles.noteAuthor} role="status">문서를 불러오고 있어요</p>
  </section>

  const [status, tone] = sync.offline ? ['연결을 기다리는 중', 'error'] : sync.unsent ? ['보내는 중', 'busy']
    : saving === 'failed' ? ['저장하지 못했어요', 'error'] : saving === 'idle' ? ['자동 저장됨', 'idle']
      : saving === 'saving' ? ['저장 중', 'busy'] : ['저장 대기', 'busy']
  return <section className={memo.pad} aria-label="공유 문서">
    <div className={memo.doc}>
      <div className={memo.bar}>
        <p className={memo.barTitle}><strong>공유 문서</strong><span className={memo.save} data-state={tone} role="status">{status}</span></p>
        {awareness && <CoEditors awareness={awareness} me={me} />}
      </div>
      <div onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget) && saving === 'waiting') void save() }}>
        <MarkdownEditor id={fieldId} value="" doc={doc} onChange={change} page cursors={awareness && me ? { awareness, user: me } : undefined} />
      </div>
    </div>
    {sync.offline && <RequestError error={sync.error} action={<Button variant="secondary" onClick={() => retry.current?.()}>다시 보내기</Button>} />}
    <RequestError error={saveError} action={saving === 'failed'
      ? <Button variant="secondary" onClick={() => void save()}>다시 저장</Button> : undefined} />
  </section>
}

// 커서 상태에서 나를 뺀 팀원을 이름과 색으로 하나씩 고른다. 같은 사람이 창을 여러 개 열어도 한 번만 센다
function coEditors(states: Map<number, Record<string, unknown>>, self: number, me?: CaretUser) {
  const found = new Map<string, CaretUser>()
  states.forEach((state, client) => {
    const user = state.user as Partial<CaretUser> | undefined
    if (client === self || typeof user?.name !== 'string' || typeof user.color !== 'string') return
    if (me && user.name === me.name && user.color === me.color) return
    found.set(`${user.color} ${user.name}`, { name: user.name, color: user.color })
  })
  return [...found.values()]
}

// 지금 이 문서를 열어 둔 팀원. 커서가 움직일 때마다 다시 그리지 않도록 목록이 바뀔 때만 다시 그린다
function CoEditors({ awareness, me }: { awareness: Awareness; me?: CaretUser }) {
  const subscribe = useCallback((notify: () => void) => {
    awareness.on('change', notify)
    return () => awareness.off('change', notify)
  }, [awareness])
  const key = useSyncExternalStore(subscribe, () => JSON.stringify(coEditors(awareness.getStates(), awareness.clientID, me)))
  const people = useMemo(() => JSON.parse(key) as CaretUser[], [key])
  if (!people.length) return null
  return <div className={memo.people}>
    <ul aria-label="지금 함께 편집 중인 팀원">
      {people.map((person) => <li key={`${person.color} ${person.name}`} title={person.name}>
        <span className={memo.avatar} style={{ background: person.color }} aria-hidden="true">{person.name.trim().slice(0, 1) || '?'}</span>
        <span className={styles.visuallyHidden}>{person.name}</span>
      </li>)}
    </ul>
    <span aria-hidden="true">{people.length === 1 ? `${people[0].name} 님과 함께 편집 중` : `${people.length}명과 함께 편집 중`}</span>
  </div>
}
