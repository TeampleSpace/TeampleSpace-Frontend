import type { ReactNode } from 'react'
import styles from './Auth.module.css'

export function AuthLayout({ children }: { children: ReactNode }) {
  return <div className={styles.layout}>
    <header className={styles.authHeader}>
      <p className={styles.wordmark}>TeamPleSpace<span className={styles.wordmarkDot} aria-hidden="true" /></p>
      <p className={styles.headerNote}>생각을 모으는 곳, 팀플스페이스</p>
    </header>
    <div className={styles.authBody}>
      <section className={styles.brand} aria-label="TeamPleSpace 소개">
        <p className={styles.eyebrow}><span aria-hidden="true" />BETTER IDEAS, TOGETHER</p>
        <h1><span className={styles.titleLine}>모은 자료가</span><span className={styles.titleLine}><span className={styles.titleMark}><span className={styles.titleInk}>하나의 발표로</span><svg viewBox="0 0 400 20" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M6 13 Q200 2 394 10" /></svg></span></span></h1>
        <p className={styles.brandDescription}>각자의 아이디어를 모아,<br />우리의 발표를 완성해요.</p>
      </section>
      <section className={styles.card}>{children}</section>
    </div>
  </div>
}
