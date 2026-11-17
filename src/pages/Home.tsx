import { Link } from 'react-router'

export default function Home() {
  return (
    <>
      <h1>TeampleSpace</h1>
      {import.meta.env.DEV && (
        <nav aria-label="개발용 화면">
          <ul>
            <li>
              <Link to="/dev/ui">공통 UI 확인</Link>
            </li>
          </ul>
        </nav>
      )}
    </>
  )
}
