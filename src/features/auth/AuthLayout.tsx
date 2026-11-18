import type { ReactNode } from 'react'
import styles from './Auth.module.css'

export function AuthLayout({ children }: { children: ReactNode }) {
  return <div className={styles.layout}>
    <section className={styles.brand} aria-label="TeamPleSpace 소개">
      <p className={styles.wordmark}>TeamPleSpace</p>
      <h1>모은 자료가<br />하나의 발표로</h1>
      <p>자료부터 슬라이드까지, 팀원과 함께</p>
    </section>
    <section className={styles.card}>{children}</section>
  </div>
}
