import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import exampleImage from '../../entities/presentation/example-image.png'
import example from '../../entities/presentation/example.json'
import { presentationSchema } from '../../entities/presentation/schema.ts'
import { createEditorSession } from '../../features/editor/session.ts'
import { createMockServer } from '../../mocks/server.ts'
import { createApiClient } from '../../shared/api/client.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { Field } from '../../shared/ui/Field.tsx'
import { EditorPanel } from './EditorPanel.tsx'
import styles from './EditorLab.module.css'

const imageFileId = 'c3000000-0000-4000-8000-000000000001'

// 모킹 서버 하나에 두 사용자의 세션을 붙인다
function createLab(log: (message: string) => void) {
  const doc = presentationSchema.parse(example)
  const server = createMockServer(doc, { assetUrls: { [imageFileId]: exampleImage } })
  const open = (actor: string, name: string) => {
    const fetchImpl = server.fetchAs(actor)
    return createEditorSession({
      client: createApiClient(fetchImpl),
      fetchImpl,
      projectId: doc.projectId,
      onLog: (message) => log(`${name}: ${message}`),
    })
  }
  return { server, a: open('user-a', '세션 A'), b: open('user-b', '세션 B') }
}

// 화면을 나갔다 돌아와도 같은 실험 상태를 쓰도록 한 번만 만든다
let lab: ReturnType<typeof createLab> | undefined
let logSink: (message: string) => void = () => {}

function getLab() {
  lab ??= createLab((message) => logSink(message))
  return lab
}

// 공유 문서 예제로 한글 입력, 선택, 확대, 저장 흐름을 확인하는 개발용 화면
export default function EditorLab() {
  const lab = getLab()
  const [logs, setLogs] = useState<string[]>([])
  const [zoom, setZoom] = useState(0)
  const [delayMs, setDelayMs] = useState(0)
  const [dropArmed, setDropArmed] = useState(false)
  const [duplicate, setDuplicate] = useState(false)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    logSink = (message) => {
      // 유실 스위치는 한 번 쓰이면 꺼진다
      setDropArmed(lab.server.faults.dropNextResponse)
      setLogs((current) => [...current.slice(-39), message])
    }
    lab.a.start()
    lab.b.start()
    return () => {
      logSink = () => {}
      lab.a.stop()
      lab.b.stop()
    }
  }, [lab])

  return (
    <>
      <Link to="/">홈으로</Link>
      <h1>편집 실험</h1>
      <p className={styles.notice}>
        모킹 서버로 동작합니다. 실제 서버 연동이 아니며 새로 고치면 처음 상태로 돌아갑니다
      </p>

      <section className={styles.controls} aria-label="실험 조건">
        <label className={styles.inline}>
          배율
          <select value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>
            <option value={0}>맞춤</option>
            <option value={0.5}>50%</option>
            <option value={1}>100%</option>
            <option value={1.5}>150%</option>
          </select>
        </label>
        <div className={styles.delay}>
          <Field
            label="저장 응답 지연 (ms)"
            type="number"
            min={0}
            step={500}
            value={delayMs}
            onChange={(event) => {
              const value = Math.max(0, Number(event.target.value))
              setDelayMs(value)
              lab.server.setFaults({ delayMs: value })
            }}
          />
        </div>
        <Button
          variant="secondary"
          aria-pressed={dropArmed}
          onClick={() => {
            lab.server.setFaults({ dropNextResponse: !dropArmed })
            setDropArmed(!dropArmed)
          }}
        >
          {dropArmed ? '다음 저장 응답을 버리도록 설정됨' : '다음 저장 응답 버리기'}
        </Button>
        <label className={styles.inline}>
          <input
            type="checkbox"
            checked={duplicate}
            onChange={(event) => {
              setDuplicate(event.target.checked)
              lab.server.setFaults({ duplicateEvents: event.target.checked })
            }}
          />
          이벤트 두 번 보내기
        </label>
        <Button
          variant="secondary"
          aria-pressed={offline}
          onClick={() => {
            lab.server.setOffline(!offline)
            setOffline(!offline)
          }}
        >
          {offline ? '서버 다시 연결' : '서버 연결 끊기'}
        </Button>
        <Button variant="secondary" onClick={() => lab.server.closeStreams()}>
          이벤트 연결만 끊기
        </Button>
      </section>

      <div className={styles.panels}>
        <EditorPanel label="세션 A" session={lab.a} zoom={zoom} />
        <EditorPanel label="세션 B" session={lab.b} zoom={zoom} />
      </div>

      <section className={styles.log} aria-label="기록">
        <h2>기록</h2>
        <p className={styles.meta}>
          서버 문서 버전 {lab.server.getDocument().version}, 서버 이벤트 {lab.server.events.length}건
        </p>
        <ol>
          {logs.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ol>
      </section>
    </>
  )
}
