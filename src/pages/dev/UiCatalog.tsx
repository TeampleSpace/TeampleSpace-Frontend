import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../../shared/ui/Button.tsx'
import { Field } from '../../shared/ui/Field.tsx'
import { Modal } from '../../shared/ui/Modal.tsx'
import { StatusPanel } from '../../shared/ui/StatusPanel.tsx'
import styles from './UiCatalog.module.css'

const colors = [
  'surface',
  'canvas',
  'subtle',
  'muted',
  'ink',
  'secondary',
  'tertiary',
  'primary',
  'primary-soft',
  'accent',
  'accent-soft',
  'accent-bright',
  'border',
  'danger',
  'danger-soft',
]

const texts = [
  ['title', '페이지 제목'],
  ['lead', '설명 본문'],
  ['body', '일반 UI 본문'],
  ['button', '버튼'],
  ['meta', '보조 정보'],
  ['nav', '탐색'],
]

const longText =
  '아주 긴 문구가 들어와도 버튼과 모달이 화면 밖으로 넘치지 않고 줄을 바꿔서 끝까지 보여야 합니다'

// 공통 UI의 상태를 한 화면에서 확인하는 개발용 화면
export default function UiCatalog() {
  const [modal, setModal] = useState<'basic' | 'confirm' | 'long' | null>(null)
  const [saving, setSaving] = useState(false)
  const close = () => setModal(null)

  return (
    <>
      <Link to="/">홈으로</Link>
      <h1>공통 UI 확인</h1>

      <section className={styles.section}>
        <h2>색상</h2>
        <ul className={styles.swatches}>
          {colors.map((name) => (
            <li key={name} className={styles.swatch}>
              <span
                className={styles.chip}
                style={{ background: `var(--color-${name})` }}
              />
              {name}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h2>글자</h2>
        {texts.map(([name, label]) => (
          <p key={name} style={{ font: `var(--text-${name})` }}>
            {label} 가나다라마바사 ABC 123
          </p>
        ))}
      </section>

      <section className={styles.section}>
        <h2>버튼</h2>
        <div className={styles.row}>
          <Button>주요 버튼</Button>
          <Button variant="secondary">보조 버튼</Button>
          <Button variant="danger">삭제</Button>
          <Button disabled>비활성</Button>
          <Button
            loading={saving}
            onClick={() => {
              setSaving(true)
              setTimeout(() => setSaving(false), 2000)
            }}
          >
            {saving ? '저장 중' : '눌러서 진행 상태 보기'}
          </Button>
        </div>
        <Button variant="secondary">{longText}</Button>
      </section>

      <section className={styles.section}>
        <h2>입력</h2>
        <div className={styles.fields}>
          <Field label="프로젝트 이름" placeholder="이름을 입력해 주세요" />
          <Field
            label="발표 주제"
            description="비워 두어도 프로젝트를 만들 수 있어요"
          />
          <Field
            label="이메일"
            defaultValue="team@"
            error="이메일 형식을 확인해 주세요"
          />
          <Field label="수정할 수 없는 값" defaultValue="고정 값" disabled />
        </div>
      </section>

      <section className={styles.section}>
        <h2>모달</h2>
        <div className={styles.row}>
          <Button variant="secondary" onClick={() => setModal('basic')}>
            기본 모달 열기
          </Button>
          <Button variant="secondary" onClick={() => setModal('confirm')}>
            확인 모달 열기
          </Button>
          <Button variant="secondary" onClick={() => setModal('long')}>
            긴 내용 모달 열기
          </Button>
        </div>
      </section>

      <section className={styles.section}>
        <h2>상태 표시</h2>
        <StatusPanel kind="loading" title="불러오는 중이에요" />
        <StatusPanel
          kind="empty"
          title="아직 자료가 없어요"
          description="첫 자료를 추가해 보세요"
          action={<Button>자료 추가</Button>}
        />
        <StatusPanel
          kind="error"
          title="저장하지 못했어요"
          description="입력한 내용은 그대로 있어요. 다시 시도해 주세요"
          requestId="req_example"
          action={<Button variant="secondary">다시 시도</Button>}
        />
      </section>

      <Modal
        open={modal === 'basic'}
        title="프로젝트 만들기"
        description="이름만 입력하면 바로 시작할 수 있어요"
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              취소
            </Button>
            <Button onClick={close}>만들기</Button>
          </>
        }
      >
        <Field label="프로젝트 이름" />
      </Modal>

      <Modal
        open={modal === 'confirm'}
        title="자료를 삭제할까요"
        description="삭제한 자료는 되돌릴 수 없어요"
        onClose={close}
        footer={
          <>
            {/* 확인 모달은 취소가 기본 선택이다 */}
            <Button variant="secondary" data-autofocus onClick={close}>
              취소
            </Button>
            <Button variant="danger" onClick={close}>
              삭제
            </Button>
          </>
        }
      />

      <Modal
        open={modal === 'long'}
        title={longText}
        description={longText}
        onClose={close}
        footer={<Button onClick={close}>확인</Button>}
      >
        {Array.from({ length: 12 }, (_, index) => (
          <p key={index}>
            {index + 1}번째 문단. {longText}
          </p>
        ))}
      </Modal>
    </>
  )
}
