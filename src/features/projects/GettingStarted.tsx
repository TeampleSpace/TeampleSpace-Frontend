import { Button } from '../../shared/ui/Button.tsx'
import styles from './Projects.module.css'

export function GettingStarted({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return <>
    <section className={styles.intro}>
      <h2>팀 프로젝트 시작하기</h2>
      <p>프로젝트를 만들거나 초대 링크로 참여하세요.</p>
    </section>
    <div className={styles.startOptions}>
      <section className={styles.startCard}>
        <h2>새 프로젝트</h2><p>이름을 정하고 팀원을 초대하세요.</p>
        <Button onClick={onCreate}>프로젝트 만들기</Button>
      </section>
      <section className={styles.startCard}>
        <h2>초대받은 프로젝트</h2><p>팀원이 보낸 초대 링크를 붙여 넣으세요.</p>
        <Button variant="secondary" onClick={onJoin}>초대 링크로 참여</Button>
      </section>
    </div>
  </>
}

export function HowItWorks() {
  return <ul className={styles.howItWorks} aria-label="프로젝트 이용 안내">
    <li><p>자료 추가</p><p>PDF, 링크, 마크다운 메모</p></li>
    <li><p>팀원 초대</p><p>팀원 관리에서 초대 링크 복사</p></li>
    <li><p>프로젝트 설정</p><p>발표 주제와 조건 확인</p></li>
  </ul>
}
