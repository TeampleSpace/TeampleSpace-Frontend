import { createBrowserRouter } from 'react-router'
import type { RouteObject } from 'react-router'
import Home from '../pages/Home.tsx'
import NotFound from '../pages/NotFound.tsx'
import RootLayout from './RootLayout.tsx'
import RouteError from './RouteError.tsx'

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
      { index: true, element: <Home /> },
      ...devRoutes,
      { path: '*', element: <NotFound /> },
    ],
  },
])
