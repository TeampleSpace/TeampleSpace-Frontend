import { lazy, Suspense } from 'react'
import { StatusPanel } from '../../../shared/ui/StatusPanel.tsx'

// 자료 화면은 들어갈 때 불러와 첫 화면의 묶음을 키우지 않는다
const MaterialsPage = lazy(() => import('./MaterialsPage.tsx'))

export default function MaterialsRoute() {
  return <Suspense fallback={<StatusPanel kind="loading" title="자료를 불러오고 있어요" />}><MaterialsPage /></Suspense>
}
