import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import exampleImage from '../../../contracts/examples/assets/0193a000-0000-7000-8000-0000000000c1.png'
import { createEditorSession } from '../../features/editor/session.ts'
import { exampleImageFileId, exampleSnapshot } from '../../mocks/example.ts'
import { createMockServer } from '../../mocks/server.ts'
import { createApiClient } from '../../shared/api/client.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { Field } from '../../shared/ui/Field.tsx'
import { EditorPanel } from './EditorPanel.tsx'
import styles from './EditorLab.module.css'

// 모킹 서버 하나에 예제의 두 팀원 세션을 붙인다
function createLab(log: (message: string) => void) {
  const server = createMockServer(exampleSnapshot, {
    assetUrls: { [exampleImageFileId]: exampleImage },
  })
  const open = (index: number, name: string) => {
    const fetchImpl = server.fetchAs(exampleSnapshot.members[index].userId)
    return createEditorSession({
      client: createApiClient(fetchImpl),
      fetchImpl,
      projectId: exampleSnapshot.projectId,
      onLog: (message) => log(`${name}: ${message}`),
    })
  }
  return { server, a: open(0, '세션 A'), b: open(1, '세션 B') }
}

// 사람이 실제 한글 입력기로 확인할 항목
const imeChecks = [
  {
    action: '한글 문장을 입력한다',
    expect:
      '글자가 깨지거나 두 번 들어가지 않는다. 입력을 멈추고 1초쯤 지나면 세션 A가 저장됨으로 바뀌고 세션 B에 같은 문장이 보인다',
  },
  {
    action: '문장 가운데로 커서를 옮겨 한 글자를 지우고 다른 글자를 넣는다',
    expect: '커서가 다른 곳으로 튀지 않고 고친 결과가 세션 B에 같게 보인다',
  },
  {
    action: '글자 하나를 조합하다가 받침을 넣기 전에 3초 동안 멈춘다',
    expect:
      '멈춘 동안 기록에 저장 요청이 늘지 않고 세션 B에 조합 중인 글자가 보이지 않는다. 글자를 완성하고 다음 글자나 띄어쓰기를 넣으면 한 번만 저장된다',
  },
  {
    action:
      '저장 응답 지연을 3000으로 두고 입력한 뒤 저장 중으로 바뀌면 곧바로 이어서 더 입력한다',
    expect:
      '이어서 넣은 글자가 사라지거나 이전 내용으로 돌아가지 않는다. 잠시 뒤 세션 B에 마지막 내용까지 보인다. 확인 뒤 지연을 0으로 되돌린다',
  },
  {
    action: 'Esc를 누르거나 바깥을 눌러 편집을 끝낸다',
    expect: '입력창이 닫히고 마지막에 조합하던 글자까지 남아 저장된다',
  },
]

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
  // 예제의 둘째 슬라이드에 본문, 이미지, 도형, 출처가 모여 있다
  const [slideIndex, setSlideIndex] = useState(1)
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
        <label className={styles.inline}>
          슬라이드
          <select
            value={slideIndex}
            onChange={(event) => setSlideIndex(Number(event.target.value))}
          >
            {exampleSnapshot.presentation?.slideIds.map((id, index) => (
              <option key={id} value={index}>
                {index + 1}번
              </option>
            ))}
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

      <details className={styles.checklist}>
        <summary>실제 한글 입력기로 직접 확인할 항목</summary>
        <p>
          자동 검사는 입력기를 거치지 않는다. 아래는 사람이 한글 입력기로 직접 입력해 확인하는
          절차다. 슬라이드 2번에서 세션 A의 요소 목록에 있는 조사 결과 요약 편집을 눌러 시작한다.
          저장 요청은 아래 기록에서, 다른 사람에게 보이는 내용은 세션 B에서 본다
        </p>
        <ol>
          {imeChecks.map((item) => (
            <li key={item.action}>
              <strong>{item.action}</strong>
              <br />
              {item.expect}
            </li>
          ))}
        </ol>
        <p>결과는 실행일, 브라우저, 입력기와 함께 ../Docs/fe/editor-experiment.md의 표에 적는다</p>
      </details>

      <div className={styles.panels}>
        <EditorPanel label="세션 A" session={lab.a} zoom={zoom} slideIndex={slideIndex} />
        <EditorPanel label="세션 B" session={lab.b} zoom={zoom} slideIndex={slideIndex} />
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
