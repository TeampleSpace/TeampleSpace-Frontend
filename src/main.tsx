import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import { router } from './app/router.tsx'
import './shared/styles/global.css'

// 서버 없이 화면을 확인하는 개발 전용 모드. 운영 빌드에는 들어가지 않는다
if (import.meta.env.DEV && import.meta.env.MODE === 'mock') await import('./mocks/devMock.ts')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
