import { Link, Navigate, useSearchParams } from 'react-router'
import { SessionStatus } from './Session.tsx'
import { useSession } from './sessionContext.ts'
import { authDestination, safeReturnTo } from './model.ts'
import { AuthLayout } from './AuthLayout.tsx'

export default function AuthResult() {
  const session = useSession()
  const [params] = useSearchParams()
  if (session.loading || session.error) return <AuthLayout><SessionStatus /></AuthLayout>
  const code = params.get('code')
  const returnTo = safeReturnTo(params.get('returnTo'))
  if (!code && session.user) return <Navigate to={authDestination(session.user.onboardingStatus === 'pending', returnTo)} replace />
  const message = code === 'OAUTH_CANCELED' ? '로그인을 취소했어요' : code === 'IDENTITY_CONFLICT' || code === 'ACCOUNT_LINK_REQUIRED'
    ? '같은 이메일로 가입한 계정이 있어요. 기존 로그인 수단으로 다시 로그인해 주세요'
    : code === 'REAUTH_REQUIRED' ? '본인 확인을 마치지 못했어요. 계정 화면에서 지원하는 방법으로 다시 확인해 주세요'
    : '로그인을 마치지 못했어요. 다시 시도해 주세요'
  return <AuthLayout><h2>로그인 확인</h2><p role="alert">{message}</p>
    {session.user && <Link to="/account">내 계정으로 돌아가기</Link>}
    <Link to={`/login?${new URLSearchParams({ returnTo })}`}>로그인으로 돌아가기</Link></AuthLayout>
}
