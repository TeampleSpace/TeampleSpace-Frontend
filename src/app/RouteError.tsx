import { StatusPanel } from '../shared/ui/StatusPanel.tsx'

// 화면을 그리다 실패했을 때 보여 주는 공통 오류 화면
export default function RouteError() {
  return (
    <StatusPanel
      kind="error"
      title="화면을 불러오지 못했어요"
      description="잠시 후 다시 시도해 주세요"
      action={<a href="/">홈으로 이동</a>}
    />
  )
}
