import { Link, Navigate, useSearchParams } from 'react-router'
import { SessionStatus } from './Session.tsx'
import { useSession } from './sessionContext.ts'
import { authDestination } from './model.ts'
import { AuthLayout } from './AuthLayout.tsx'

export default function AuthResult() {
  const session = useSession()
  const [params] = useSearchParams()
  if (session.loading || session.error) return <AuthLayout><SessionStatus /></AuthLayout>
  if (session.user) return <Navigate to={authDestination(session.user.onboardingStatus === 'pending', params.get('returnTo'))} replace />
  const code = params.get('code')
  const message = code === 'OAUTH_CANCELED' ? '로그인을 취소했어요' : code === 'ACCOUNT_LINK_REQUIRED'
    ? '같은 이메일로 가입한 계정이 있어요. 기존 로그인 수단으로 다시 로그인해 주세요' : '로그인을 마치지 못했어요. 다시 시도해 주세요'
  return <AuthLayout><h2>로그인 확인</h2><p role="alert">{message}</p><Link to="/login">로그인으로 돌아가기</Link></AuthLayout>
}
