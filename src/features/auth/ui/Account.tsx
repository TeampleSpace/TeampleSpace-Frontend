import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { authApi } from '../../../entities/session/api.ts'
import { oauthUrl, providerNames } from '../../../entities/session/model.ts'
import type { Challenge } from '../../../entities/session/model.ts'
import { useSession } from '../../../entities/session/sessionContext.ts'
import { Button } from '../../../shared/ui/Button.tsx'
import { Field } from '../../../shared/ui/Field.tsx'
import { Modal } from '../../../shared/ui/Modal.tsx'
import { RequestError } from '../../../shared/ui/RequestError.tsx'
import { UnsavedGuard } from '../../../shared/ui/UnsavedGuard.tsx'
import { applyTheme, readTheme } from '../../../shared/lib/theme.ts'
import type { Theme } from '../../../shared/lib/theme.ts'
import page from '../../../shared/ui/PageLayout.module.css'
import buttonStyles from '../../../shared/ui/Button.module.css'
import authStyles from './Auth.module.css'
import account from './Account.module.css'

export default function Account() {
  const { user, setUser, capabilities, refresh } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [proof, setProof] = useState(() => new URLSearchParams(location.hash.slice(1)).get('reauthProof') ?? '')
  const [name, setName] = useState(user?.name ?? '')
  const [modal, setModal] = useState<'logout' | 'delete' | null>(proof ? 'delete' : null)
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [code, setCode] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState<unknown>()
  const [notice, setNotice] = useState('')
  const [retryAt, setRetryAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [theme, setTheme] = useState(readTheme)
  const dirty = !!user && name !== user.name
  useEffect(() => {
    if (new URLSearchParams(location.hash.slice(1)).has('reauthProof')) {
      navigate({ pathname: location.pathname, search: location.search, hash: '' }, { replace: true })
    }
  }, [location.hash, location.pathname, location.search, navigate])
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  if (!user) return null
  const activeUser = user
  const hasEmail = !!user.email && user.canEmailReauth
  const emailEnabled = capabilities?.authProviders.some((item) => item.provider === 'email' && item.enabled && item.reauthEnabled)
  const canUseEmail = hasEmail && emailEnabled
  const socialReauth = user.identities.filter((identity) => identity.provider !== 'email'
    && capabilities?.authProviders.some((item) => item.provider === identity.provider && item.enabled && item.reauthEnabled))
  const seconds = Math.max(0, Math.ceil((retryAt - now) / 1000))

  async function act(work: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(undefined); setNotice('')
    try { await work() } catch (reason) { setError(reason) }
    finally { lock.current = false; setBusy(false) }
  }
  function close() { if (!busy) { setModal(null); setError(undefined); setCode(''); setConfirmation(''); setProof('') } }
  async function sendCode() {
    if (!canUseEmail || !activeUser.email || seconds > 0) return
    await act(async () => {
      const next = await authApi.challenge(activeUser.email!, 'reauth')
      setChallenge(next); setRetryAt(Date.now() + next.retryAfter * 1000); setCode('')
    })
  }
  async function removeAccount() {
    if (confirmation !== '탈퇴' || activeUser.ownedProjectCount > 0) return
    await act(async () => {
      let currentProof = proof
      if (!currentProof && challenge) currentProof = (await authApi.reauthenticate(challenge.challengeId, code)).reauthProof
      if (!currentProof) return
      setProof(currentProof)
      await authApi.deleteAccount(currentProof)
      setLeaving(true); setUser(null)
      const refreshing = refresh()
      navigate('/login', { replace: true })
      await refreshing
    })
  }

  return <>
    <header className={page.header}><h1>내 계정</h1><Link className={page.back} to="/">돌아가기</Link></header>
    <div className={page.content}>
      <form className={account.form} onSubmit={(event) => { event.preventDefault(); void act(async () => {
        const next = await authApi.update(name.trim(), activeUser.version); setUser(next); setName(next.name); setNotice('이름을 저장했어요')
      }) }}>
        <Field label="이름" value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} autoComplete="name" />
        <Field label="이메일" value={user.email ?? '제공된 이메일 없음'} readOnly description="로그인 계정 정보라 여기서 바꿀 수 없어요" />
        <div className={account.actions}><Button type="submit" disabled={!dirty || !name.trim()} loading={busy}>저장</Button>
          <Button variant="secondary" disabled={busy} onClick={() => { setError(undefined); setModal('logout') }}>로그아웃</Button></div>
      </form>
      {notice && <p className="motion-feedback" role="status">{notice}</p>}
      {!modal && <RequestError error={error} action={<Button variant="text" onClick={() => void act(async () => { const next = await refresh(); if (next) setName(next.name) })}>최신 정보 다시 불러오기</Button>} />}
      <section className={account.providers}><h2>로그인 수단</h2>
        <ul className={account.identities}>{(['email', 'kakao', 'naver', 'google'] as const).map((provider) => <li key={provider} data-connected={user.identities.some((identity) => identity.provider === provider)}>{providerNames[provider]} <span>{user.identities.some((identity) => identity.provider === provider) ? '연결됨' : '미연결'}</span></li>)}</ul>
      </section>
      <section className={page.section} aria-labelledby="account-theme">
        <h2 id="account-theme">화면 테마</h2>
        <p>시스템 설정을 고르면 기기의 라이트, 다크 모드를 따라가요</p>
        <div><select aria-labelledby="account-theme" value={theme} onChange={(event) => { const next = event.target.value as Theme; setTheme(next); applyTheme(next) }}>
          <option value="system">시스템 설정</option><option value="light">라이트</option><option value="dark">다크</option>
        </select></div>
      </section>
      <section className={page.section} aria-labelledby="account-subscription">
        <h2 id="account-subscription">구독 및 결제</h2>
        <p>개인 월 구독 요금제를 확인할 수 있어요. 결제 서비스는 준비 중이에요.</p>
        <div><Link className={`${buttonStyles.button} ${buttonStyles.secondary}`} to="/account/subscription">요금제 보기</Link></div>
      </section>
      <section className={account.withdrawal}>
        <div><h2>회원 탈퇴</h2><p>소유 프로젝트를 이전하거나 삭제한 뒤 탈퇴할 수 있어요 <Link to="/">프로젝트 보기</Link></p>
          {user.ownedProjectCount > 0 && <p>현재 소유한 프로젝트 {user.ownedProjectCount}개</p>}
        </div>
        <Button variant="dangerText" disabled={busy || user.ownedProjectCount > 0} onClick={() => { setError(undefined); setModal('delete') }}>탈퇴하기</Button>
      </section>
    </div>
    <Modal open={modal === 'logout'} title="로그아웃할까요?" size="confirm" onClose={close}
      description={dirty ? '저장하지 않은 이름 변경은 사라져요' : '현재 기기의 로그인 상태를 종료해요'}
      footer={<><Button variant="secondary" disabled={busy} onClick={close}>취소</Button><Button loading={busy} onClick={() => void act(async () => {
        await authApi.logout(); setLeaving(true); setUser(null)
        const refreshing = refresh()
        navigate('/login', { replace: true })
        await refreshing
      })}>로그아웃</Button></>}><RequestError error={error} /></Modal>
    <Modal open={modal === 'delete'} title="회원 탈퇴" size="confirm" onClose={close}
      description="본인 확인 후 탈퇴할 수 있어요. 이 작업은 되돌릴 수 없어요">
      <div className={authStyles.form}>
        {user.ownedProjectCount > 0 ? <p>소유 프로젝트를 먼저 이전하거나 삭제해 주세요</p> : <>
          {!proof && <>
          {canUseEmail && <>
            <p>{user.email}로 본인 확인 코드를 받아 주세요</p>
            <Button variant="secondary" loading={busy} disabled={!emailEnabled || seconds > 0} onClick={() => void sendCode()}>{seconds > 0 ? `${seconds}초 후 재전송` : challenge ? '코드 다시 받기' : '본인 확인 코드 받기'}</Button>
            {challenge && <Field label="본인 확인 코드" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              error={Date.parse(challenge.expiresAt) <= now ? '코드가 만료됐어요. 새 코드를 받아 주세요' : undefined} />}
          </>}
          {hasEmail && !emailEnabled && <p>이메일 본인 확인을 준비 중이에요</p>}
          {socialReauth.map((identity) => <Button key={identity.provider} disabled={busy}
            onClick={() => window.location.assign(oauthUrl(identity.provider, 'reauth', '/account'))}>{providerNames[identity.provider]}로 본인 확인</Button>)}
          {socialReauth.some((identity) => identity.provider === 'kakao') && <p>카카오 본인 확인은 카카오톡 안의 브라우저에서 지원되지 않아요. 외부 브라우저에서 진행해 주세요</p>}
          {!canUseEmail && socialReauth.length === 0 && <p>현재 사용할 수 있는 본인 확인 수단이 없어요. 계정 지원 담당자에게 문의해 주세요</p>}
          </>}
          {proof && <p>본인 확인을 마쳤어요</p>}
          <Field label="확인을 위해 탈퇴를 입력해 주세요" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
          <div className={authStyles.actions}><Button variant="secondary" disabled={busy} onClick={close}>취소</Button><Button variant="danger" loading={busy}
            disabled={confirmation !== '탈퇴' || (!proof && (!challenge || code.length !== 6 || Date.parse(challenge.expiresAt) <= now))}
            onClick={() => void removeAccount()}>회원 탈퇴</Button></div>
        </>}
        <RequestError error={error} />
      </div>
    </Modal>
    <UnsavedGuard dirty={dirty && !leaving} />
  </>
}
