import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router'
import { api, authApi } from './api.ts'
import type { AuthCapabilities, User } from './model.ts'
import { authDestination, safeReturnTo } from './model.ts'
import { takeBillingPreviewReturn } from './billingPreviewReturn.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { StatusPanel } from '../../shared/ui/StatusPanel.tsx'
import { RequestError } from '../../shared/ui/RequestError.tsx'
import { SessionContext, useSession } from './sessionContext.ts'

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
  return <SessionContext value={{ user, capabilities, loading, error, refresh, setUser }}><Outlet /></SessionContext>
}

export function SessionStatus() {
  const { loading, error, refresh } = useSession()
  if (loading) return <StatusPanel kind="loading" title="로그인 상태를 확인하고 있어요" />
  if (error) return <RequestError error={error} action={<Button onClick={() => void refresh().catch(() => {})}>다시 시도</Button>} />
  return null
}

export function RequireSession({ onboarding = false }: { onboarding?: boolean }) {
  const { user, loading, error } = useSession()
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    if (!import.meta.env.DEV || !user || loading || error || location.hash) return
    const accountReturn = location.pathname === '/account' && !location.search && user.onboardingStatus === 'completed'
    const onboardingReturn = onboarding && (!location.search || new URLSearchParams(location.search).get('returnTo') === '/account')
    if (!accountReturn && !onboardingReturn) return
    const preview = takeBillingPreviewReturn()
    if (preview) void navigate(authDestination(user.onboardingStatus === 'pending', preview), { replace: true })
  }, [user, loading, error, location, navigate, onboarding])
  if (loading || error) return <SessionStatus />
  const returnTo = safeReturnTo(location.pathname + location.search)
  if (!user) return <Navigate to={`/login?${new URLSearchParams({ returnTo })}`} replace />
  if (!onboarding && user.onboardingStatus === 'pending') return <Navigate to={`/onboarding?${new URLSearchParams({ returnTo })}`} replace />
  return <Outlet />
}
