import { Button } from '../../shared/ui/Button.tsx'
import styles from './Projects.module.css'

export function GettingStarted({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return <>
    <section className={styles.intro}>
      <h2>자료를 모으면, 발표가 시작돼요.</h2>
      <p>프로젝트를 만들고 팀원을 초대하세요. 자료 편집과 PPT 생성은 준비 중이에요.</p>
    </section>
    <div className={styles.startOptions}>
      <section className={styles.startCard}>
        <h2>새 프로젝트 만들기</h2><p>프로젝트 이름만 정하면 시작할 수 있어요.</p>
        <Button onClick={onCreate}>프로젝트 만들기</Button>
      </section>
      <section className={styles.startCard}>
        <h2>초대받은 프로젝트 참여하기</h2><p>팀원이 보낸 초대 링크를 준비해 주세요.</p>
        <Button variant="secondary" onClick={onJoin}>초대 링크로 참여</Button>
      </section>
    </div>
  </>
}

export function HowItWorks() {
  return <ol className={styles.howItWorks} aria-label="서비스 이용 안내">
    <li><span>01</span><p>자료 모으기 <small>준비 중</small></p><p>PDF, 링크, 마크다운 메모</p></li>
    <li><span>02</span><p>발표 구성하기 <small>준비 중</small></p><p>목차와 근거를 함께 정리</p></li>
    <li><span>03</span><p>PPT 함께 편집하기 <small>준비 중</small></p><p>요소를 고치고 이력에서 확인</p></li>
  </ol>
}
