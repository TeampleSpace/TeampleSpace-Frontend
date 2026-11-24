import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router'
import { api, authApi } from '../../../entities/session/api.ts'
import type { AuthCapabilities, User } from '../../../entities/session/model.ts'
import { authDestination, safeReturnTo } from '../../../entities/session/model.ts'
import { takeBillingPreviewReturn } from '../../../entities/session/billingPreviewReturn.ts'
import { SessionStatus } from '../../../entities/session/SessionStatus.tsx'
import { SessionContext, useSession } from '../../../entities/session/sessionContext.ts'

export function SessionProvider() {
  const [user, setUser] = useState<User | null>(null)
  const [capabilities, setCapabilities] = useState<AuthCapabilities | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>()
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    const current = ++generation.current
    setLoading(true)
    try {
      const [session, config] = await Promise.all([api.bootstrap(), authApi.capabilities()])
      const nextUser = session.status === 'authenticated' ? await authApi.me() : null
      if (current === generation.current) { setUser(nextUser); setCapabilities(config); setError(undefined) }
      return nextUser
    } catch (reason) {
      if (current === generation.current) setError(reason)
      throw reason
    } finally { if (current === generation.current) setLoading(false) }
  }, [])
  useEffect(() => { void Promise.resolve().then(refresh).catch(() => {}) }, [refresh])
  // 다른 탭에서 로그인한 사용자가 바뀌면 세션을 다시 읽어 이전 사용자의 화면을 내린다
  useEffect(() => api.onSessionChange(() => void refresh().catch(() => {})), [refresh])
  return <SessionContext value={{ user, capabilities, loading, error, refresh, setUser }}><Outlet /></SessionContext>
}

export function RequireSession({ onboarding = false }: { onboarding?: boolean }) {
  const { user, loading, error } = useSession()
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    if (!user || loading || error || location.hash) return
    const accountReturn = location.pathname === '/account' && !location.search && user.onboardingStatus === 'completed'
    const onboardingReturn = onboarding && (!location.search || new URLSearchParams(location.search).get('returnTo') === '/account')
    if (!accountReturn && !onboardingReturn) return
    const preview = takeBillingPreviewReturn()
    if (preview) void navigate(authDestination(user.onboardingStatus === 'pending', preview), { replace: true })
  }, [user, loading, error, location, navigate, onboarding])
  if (loading || error) return <SessionStatus standalone />
  const returnTo = safeReturnTo(location.pathname + location.search)
  if (!user) return <Navigate to={`/login?${new URLSearchParams({ returnTo })}`} replace />
  if (!onboarding && user.onboardingStatus === 'pending') return <Navigate to={`/onboarding?${new URLSearchParams({ returnTo })}`} replace />
  return <Outlet />
}
