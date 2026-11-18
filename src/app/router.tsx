import { createBrowserRouter } from 'react-router'
import type { RouteObject } from 'react-router'
import Home from '../pages/Home.tsx'
import NotFound from '../pages/NotFound.tsx'
import RootLayout from './RootLayout.tsx'
import RouteError from './RouteError.tsx'
import { RequireSession, SessionProvider } from '../features/auth/Session.tsx'
import Login from '../features/auth/Login.tsx'
import Onboarding from '../features/auth/Onboarding.tsx'
import AuthResult from '../features/auth/AuthResult.tsx'
import Account from '../features/auth/Account.tsx'
import AppShell from './AppShell.tsx'

// 개발용 화면은 개발 서버에서만 등록하고 운영 빌드에는 포함하지 않는다
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: 'dev/ui',
        lazy: async () => ({
          Component: (await import('../pages/dev/UiCatalog.tsx')).default,
        }),
      },
      {
        path: 'dev/editor',
        lazy: async () => ({
          Component: (await import('../pages/dev/EditorLab.tsx')).default,
        }),
      },
      {
        path: 'dev/reference',
        lazy: async () => ({
          Component: (await import('../pages/dev/RenderReference.tsx')).default,
        }),
      },
    ]
  : []

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      { element: <SessionProvider />, children: [
        { path: 'login', element: <Login /> },
        { path: 'auth/email', element: <Login /> },
        { path: 'auth/result', element: <AuthResult /> },
        { path: 'auth/error', element: <AuthResult /> },
        { element: <RequireSession onboarding />, children: [{ path: 'onboarding', element: <Onboarding /> }] },
        { element: <RequireSession />, children: [{ element: <AppShell />, children: [
          { index: true, element: <Home /> },
          { path: 'account', element: <Account /> },
        ] }] },
      ] },
      ...devRoutes,
      { path: '*', element: <NotFound /> },
    ],
  },
])
