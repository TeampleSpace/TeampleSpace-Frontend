import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { authApi } from '../api.ts'
import { oauthUrl, providerNames, safeReturnTo } from '../model.ts'
import { setBillingPreviewReturn } from '../billingPreviewReturn.ts'
import type { Challenge, Provider } from '../model.ts'
import { SessionStatus } from './Session.tsx'
import { useSession } from '../sessionContext.ts'
import { AuthLayout } from './AuthLayout.tsx'
import { Button } from '../../../shared/ui/Button.tsx'
import { Field } from '../../../shared/ui/Field.tsx'
import { RequestError } from '../../../shared/ui/RequestError.tsx'
import styles from './Auth.module.css'

export default function Login() {
  const session = useSession()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const returnTo = safeReturnTo(params.get('returnTo'))
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [retryAt, setRetryAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState<unknown>()
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const enabled = (provider: Provider) => session.capabilities?.authProviders.some((item) => item.provider === provider && item.enabled) ?? false
  const expired = challenge ? now >= Date.parse(challenge.expiresAt) : false
  const seconds = Math.max(0, Math.ceil((retryAt - now) / 1000))

  async function sendCode() {
    if (lock.current || !enabled('email') || seconds > 0) return
    setBillingPreviewReturn()
    lock.current = true; setBusy(true); setError(undefined)
    try {
      const next = await authApi.challenge(email.trim(), 'login')
      setChallenge(next); setCode(''); setRetryAt(Date.now() + next.retryAfter * 1000)
    } catch (reason) { setError(reason) }
    finally { lock.current = false; setBusy(false) }
  }
  async function login() {
    if (lock.current || !challenge || expired) return
    lock.current = true; setBusy(true); setError(undefined)
    try {
      const result = await authApi.login(challenge.challengeId, code.trim())
      await session.refresh()
      navigate(result.needsOnboarding ? `/onboarding?${new URLSearchParams({ returnTo })}` : returnTo, { replace: true })
    } catch (reason) { setError(reason) }
    finally { lock.current = false; setBusy(false) }
  }

  if (session.loading || session.error) return <AuthLayout><SessionStatus /></AuthLayout>
  if (session.user) return <Navigate to={session.user.onboardingStatus === 'pending' ? `/onboarding?${new URLSearchParams({ returnTo })}` : returnTo} replace />
  return <AuthLayout>
    <h2>{challenge ? '이메일을 확인해 주세요' : '팀 발표를 한곳에서'}</h2>
    <p>{challenge ? `${email}로 인증 코드를 보냈어요` : '사용하던 계정으로 간편하게 시작하세요'}</p>
    {!challenge && <>
      <div className={styles.socials}>
        {(['kakao', 'naver', 'google'] as const).map((provider) => <button key={provider}
          className={`${styles.social} ${styles[provider]}`} disabled={!enabled(provider)}
          onClick={() => {
            setBillingPreviewReturn(returnTo)
            window.location.assign(oauthUrl(provider, 'login', returnTo))
          }}>
          <img src={`/assets/auth/${provider}.${provider === 'kakao' ? 'svg' : 'png'}`} alt="" />
          {providerNames[provider]}로 시작하기
        </button>)}
      </div>
      {session.capabilities?.authProviders.some((item) => !item.enabled) && <p className={styles.hint}>준비 중인 로그인 수단은 선택할 수 없어요</p>}
      <p className={styles.hint}>또는 이메일로 로그인</p>
    </>}
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void (challenge ? login() : sendCode()) }}>
      {challenge ? <>
        <Field label="인증 코드" value={code} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
          required autoFocus onChange={(event) => setCode(event.target.value)} error={expired ? '인증 코드가 만료되었어요. 새 코드를 받아 주세요' : undefined} />
        <Button type="submit" loading={busy} disabled={expired || code.length !== 6}>로그인</Button>
        <div className={styles.actions}>
          <Button variant="secondary" loading={busy} disabled={seconds > 0} onClick={() => void sendCode()}>{seconds > 0 ? `${seconds}초 후 재전송` : '코드 다시 받기'}</Button>
          <Button variant="text" disabled={busy} onClick={() => { setChallenge(null); setCode(''); setError(undefined) }}>이메일 변경</Button>
        </div>
      </> : <>
        <Field label="이메일" type="email" autoComplete="email" placeholder="student@university.ac.kr" required maxLength={320}
          value={email} onChange={(event) => setEmail(event.target.value)} disabled={!enabled('email')} />
        {!enabled('email') && <p className={styles.notice}>이메일 로그인 준비 중이에요. 사용 가능한 다른 로그인 수단을 선택해 주세요</p>}
        <Button type="submit" loading={busy} disabled={!enabled('email') || seconds > 0}>{seconds > 0 ? `${seconds}초 후 재전송` : '인증 코드 받기'}</Button>
      </>}
    </form>
    <RequestError error={error} />
  </AuthLayout>
}
