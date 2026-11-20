import { createBrowserRouter } from 'react-router'
import type { RouteObject } from 'react-router'
import NotFound from '../pages/NotFound.tsx'
import RootLayout from './RootLayout.tsx'
import RouteError from './RouteError.tsx'
import { RequireSession, SessionProvider } from '../features/auth/ui/Session.tsx'
import Login from '../features/auth/ui/Login.tsx'
import Onboarding from '../features/auth/ui/Onboarding.tsx'
import AuthResult from '../features/auth/ui/AuthResult.tsx'
import Account from '../features/auth/ui/Account.tsx'
import AppShell from './AppShell.tsx'
import ProjectHome from '../features/projects/ui/ProjectHome.tsx'
import ProjectPage from '../features/projects/ui/ProjectPage.tsx'
import Invitation from '../features/projects/ui/Invitation.tsx'
import MaterialsRoute from '../features/materials/ui/MaterialsRoute.tsx'

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

const billingPreviewRoutes: RouteObject[] = import.meta.env.DEV ? [
  {
    path: 'account/subscription',
    lazy: async () => ({ Component: (await import('../features/billing/ui/BillingPage.tsx')).SubscriptionPage }),
  },
  {
    path: 'account/subscription/manage',
    lazy: async () => ({ Component: (await import('../features/billing/ui/BillingPage.tsx')).BillingManagePage }),
  },
  {
    path: 'account/subscription/preview/complete',
    lazy: async () => ({ Component: (await import('../features/billing/ui/BillingPage.tsx')).BillingCompletePreviewPage }),
  },
  {
    path: 'account/subscription/preview/interrupted',
    lazy: async () => ({ Component: (await import('../features/billing/ui/BillingPage.tsx')).BillingInterruptedPreviewPage }),
  },
  {
    path: 'billing/return',
    lazy: async () => ({ Component: (await import('../features/billing/ui/BillingPage.tsx')).BillingReturnPage }),
  },
] : []

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
        { path: 'invite/:token', element: <Invitation /> },
        { element: <RequireSession onboarding />, children: [{ path: 'onboarding', element: <Onboarding /> }] },
        { element: <RequireSession />, children: [{ element: <AppShell />, children: [
          { index: true, element: <ProjectHome /> },
          { path: 'account', element: <Account /> },
          ...billingPreviewRoutes,
          { path: 'projects/:projectId', element: <ProjectPage /> },
          { path: 'projects/:projectId/settings', element: <ProjectPage /> },
          { path: 'projects/:projectId/design', lazy: async () => ({
            Component: (await import('../features/design/ui/DesignRoute.tsx')).default,
          }) },
          { path: 'projects/:projectId/materials', element: <MaterialsRoute /> },
          { path: 'projects/:projectId/outline', lazy: async () => ({
            Component: (await import('../features/outline/ui/OutlineRoute.tsx')).default,
          }) },
        ] }] },
      ] },
      ...devRoutes,
      { path: '*', element: <NotFound /> },
    ],
  },
])
