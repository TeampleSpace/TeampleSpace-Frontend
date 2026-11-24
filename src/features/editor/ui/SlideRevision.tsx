import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../../shared/api/client.ts'
import { Button } from '../../../shared/ui/Button.tsx'
import { Field } from '../../../shared/ui/Field.tsx'
import { Modal } from '../../../shared/ui/Modal.tsx'
import { RequestError } from '../../../shared/ui/RequestError.tsx'
import { materialsApi } from '../../../entities/material/api.ts'
import type { Job } from '../../../entities/material/model.ts'
import { JobProgress } from '../../../entities/material/JobProgress.tsx'
import type { Slide } from '../../../entities/presentation/schema.ts'
import type { EditorSession } from '../session.ts'
import { revisionApi, revisionResultSchema } from '../revision.ts'
import type { RevisionResult } from '../revision.ts'
import styles from './SlideEditor.module.css'

type Phase = 'request' | 'working' | 'preview' | 'failed'

const titles: Record<Phase, string> = {
  request: '이 슬라이드 다듬기',
  working: '수정 제안을 만들고 있어요',
  preview: '수정 제안을 확인하세요',
  failed: '수정 제안을 만들지 못했어요',
}

const descriptions: Record<Phase, string> = {
  request: '선택한 슬라이드만 수정합니다.',
  working: '창을 닫아도 슬라이드는 바뀌지 않아요.',
  preview: '적용하기 전에는 팀의 슬라이드가 바뀌지 않습니다.',
  failed: '현재 슬라이드와 요청 내용은 유지됩니다.',
}

const promptMax = 500

// 문장으로 받은 요청으로 현재 슬라이드의 글 수정 제안을 만들고, 확인한 뒤 적용한다
export function SlideRevision({ session, slide, label, busy, disabled }: {
  session: EditorSession
  slide: Slide
  // 모달에 보여 줄 슬라이드 번호와 이름
  label: string
  // 저장하지 않은 입력이 있으면 적용하지 않는다. 적용이 내 입력과 겹치지 않게 한다
  busy: boolean
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('request')
  const [prompt, setPrompt] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<unknown>()
  const [job, setJob] = useState<Job>()
  const [failure, setFailure] = useState<string>()
  const [proposal, setProposal] = useState<{ id: string; result: RevisionResult }>()
  const [applying, setApplying] = useState(false)
  // 같은 제안을 다시 적용할 때는 같은 키를 보내 한 번만 반영되게 한다
  const applyKey = useRef('')

  const jobId = phase === 'working' ? job?.id : undefined
  useEffect(() => {
    if (!jobId) return
    const id = jobId
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    async function check() {
      try {
        const latest = await materialsApi.job(id, controller.signal)
        if (controller.signal.aborted) return
        setJob(latest)
        if (latest.status === 'succeeded') {
          const parsed = revisionResultSchema.safeParse(latest.resultRef)
          if (parsed.success) {
            applyKey.current = crypto.randomUUID()
            setProposal({ id: latest.id, result: parsed.data })
            setPhase('preview')
          } else {
            setFailure(undefined)
            setPhase('failed')
          }
          return
        }
        if (latest.status === 'failed' || latest.status === 'canceled') {
          setFailure(latest.error?.message)
          setPhase('failed')
          return
        }
      } catch {
        if (controller.signal.aborted) return
        // 조회가 잠시 실패해도 작업은 서버에서 이어지므로 조금 뒤 다시 읽는다
      }
      timer = setTimeout(() => void check(), 1500)
    }
    void check()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [jobId])

  async function submit() {
    const text = prompt.trim()
    if (!text || sending) return
    setSending(true)
    setError(undefined)
    try {
      const created = await revisionApi.create(slide.id, { generation: slide.generation, prompt: text }, crypto.randomUUID())
      setJob(created)
      setProposal(undefined)
      setPhase('working')
    } catch (reason) {
      setError(reason)
      setPhase('request')
    } finally {
      setSending(false)
    }
  }

  async function apply() {
    if (!proposal || applying) return
    setApplying(true)
    setError(undefined)
    try {
      const applied = await revisionApi.apply(proposal.id, applyKey.current)
      session.accept(applied.changes)
      close()
    } catch (reason) {
      setError(reason)
    } finally {
      setApplying(false)
    }
  }

  function close() {
    setOpen(false)
    setPhase('request')
    setError(undefined)
    setProposal(undefined)
    setJob(undefined)
  }

  function again() {
    setError(undefined)
    setPhase('request')
  }

  // 적용 전에 슬라이드가 바뀌어 제안이 맞지 않는다
  const stale = error instanceof ApiError && error.code === 'VERSION_CONFLICT'

  return (
    <>
      <Button variant="secondary" disabled={disabled} onClick={() => setOpen(true)}>
        AI로 수정
      </Button>
      <Modal
        open={open}
        title={titles[phase]}
        description={descriptions[phase]}
        size="form"
        onClose={close}
        footer={
          phase === 'request' ? (
            <>
              <Button loading={sending} disabled={!prompt.trim()} onClick={() => void submit()}>제안 받기</Button>
              <Button variant="secondary" onClick={close}>취소</Button>
            </>
          ) : phase === 'preview' ? (
            <>
              {!stale && <Button loading={applying} disabled={busy} onClick={() => void apply()}>적용</Button>}
              <Button variant={stale ? 'primary' : 'secondary'} disabled={applying} onClick={again}>다시 요청</Button>
              <Button variant="secondary" disabled={applying} onClick={close}>취소</Button>
            </>
          ) : phase === 'failed' ? (
            <Button loading={sending} onClick={() => void submit()}>다시 요청</Button>
          ) : null
        }
      >
        {phase === 'request' && (
          <form className={styles.revision} onSubmit={(event) => { event.preventDefault(); void submit() }}>
            <Field
              multiline
              label="어떻게 바꿀까요?"
              placeholder="핵심 메시지가 보이도록 설명을 짧게 줄여줘."
              value={prompt}
              maxLength={promptMax}
              rows={3}
              autoFocus
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                // 한글 조합 중의 Enter는 글자 확정이다
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void submit()
                }
              }}
            />
            <p className={styles.compare}>{label}</p>
          </form>
        )}
        {phase === 'working' && job && <JobProgress job={job} label="수정 제안 진행률" />}
        {phase === 'preview' && proposal && (
          <ul className={styles.revisionList}>
            {proposal.result.targets.map((target) => (
              <li key={target.elementId}>
                <p className={styles.compare}>현재: {target.before}</p>
                <p className={styles.compare}>제안: {target.after}</p>
              </li>
            ))}
          </ul>
        )}
        {phase === 'preview' && busy && <p role="status">저장 중인 입력이 끝나면 적용할 수 있어요.</p>}
        {phase === 'failed' && failure && <p role="alert">{failure}</p>}
        {stale ? (
          <p role="alert">제안을 만든 뒤 슬라이드가 바뀌었어요. 다시 요청해 주세요.</p>
        ) : (
          <RequestError error={error} />
        )}
      </Modal>
    </>
  )
}
