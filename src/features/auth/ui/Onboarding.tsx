import { useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { authApi } from '../api.ts'
import { requiredDocuments, safeReturnTo } from '../model.ts'
import { useSession } from '../sessionContext.ts'
import { AuthLayout } from './AuthLayout.tsx'
import { Field } from '../../../shared/ui/Field.tsx'
import { Button } from '../../../shared/ui/Button.tsx'
import { RequestError } from '../../../shared/ui/RequestError.tsx'
import styles from './Auth.module.css'

export default function Onboarding() {
  const { user, capabilities, setUser, refresh } = useSession()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [name, setName] = useState(user?.name ?? '')
  const [accepted, setAccepted] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState<unknown>()
  const documents = requiredDocuments(capabilities)
  const canSubmit = documents.length === 2 && documents.every((doc) => accepted[`${doc.type}:${doc.version}`]) && name.trim().length > 0
  const returnTo = safeReturnTo(params.get('returnTo'))
  if (!user) return null
  if (user.onboardingStatus === 'completed') return <Navigate to={returnTo} replace />

  async function submit() {
    if (!user || lock.current || !canSubmit) return
    lock.current = true; setBusy(true); setError(undefined)
    try {
      const updated = await authApi.update(name.trim(), user.version, Object.fromEntries(documents.map((doc) => [doc.type, doc.version])))
      setUser(updated)
      navigate(returnTo, { replace: true })
    } catch (reason) { setError(reason) }
    finally { lock.current = false; setBusy(false) }
  }

  return <AuthLayout>
    <h2>어떻게 불러드릴까요?</h2><p>팀원에게 표시할 이름을 정해주세요</p>
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <Field label="이름" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} autoComplete="name" required />
      {documents.length === 0 ? <div className={styles.notice}>
        <p>가입에 필요한 약관을 준비하고 있어요. 문서가 준비되면 가입을 마칠 수 있어요</p>
        <Button variant="text" onClick={() => void refresh().catch(setError)}>다시 확인</Button>
      </div> : documents.map((doc) => <label className={styles.consent} key={`${doc.type}:${doc.version}`}>
        <input type="checkbox" checked={accepted[`${doc.type}:${doc.version}`] ?? false}
          onChange={(event) => setAccepted((value) => ({ ...value, [`${doc.type}:${doc.version}`]: event.target.checked }))} />
        {doc.type === 'terms' ? '이용약관 동의 (필수)' : '개인정보 수집 및 이용 동의 (필수)'}
      </label>)}
      <div className={styles.links}>{documents.map((doc) => <a href={doc.url} key={doc.type} target="_blank" rel="noopener noreferrer">
        {doc.type === 'terms' ? '이용약관 보기' : '개인정보 처리방침 보기'}
      </a>)}</div>
      <Button type="submit" disabled={!canSubmit} loading={busy}>동의 후 시작하기</Button>
    </form>
    <RequestError error={error} action={<Button variant="text" onClick={() => void refresh().catch(setError)}>최신 정보 확인</Button>} />
    <Button variant="text" disabled={busy} onClick={() => void authApi.logout().then(() => {
      setUser(null)
      const refreshing = refresh()
      navigate('/login', { replace: true })
      return refreshing
    }).catch(setError)}>로그아웃</Button>
  </AuthLayout>
}
