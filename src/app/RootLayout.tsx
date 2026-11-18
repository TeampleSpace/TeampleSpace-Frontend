import { Outlet, useLocation } from 'react-router'
import styles from './RootLayout.module.css'

export default function RootLayout() {
  const location = useLocation()
  return (
    <>
      <a className={styles.skip} href="#main">
        본문으로 건너뛰기
      </a>
      <main id="main" className={location.pathname.startsWith('/dev/') ? styles.main : styles.product} tabIndex={-1}>
        <Outlet />
      </main>
    </>
  )
}
