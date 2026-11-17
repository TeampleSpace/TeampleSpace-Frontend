import { Outlet } from 'react-router'
import styles from './RootLayout.module.css'

export default function RootLayout() {
  return (
    <>
      <a className={styles.skip} href="#main">
        본문으로 건너뛰기
      </a>
      <main id="main" className={styles.main} tabIndex={-1}>
        <Outlet />
      </main>
    </>
  )
}
