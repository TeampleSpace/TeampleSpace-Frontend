import { Link } from 'react-router'
import { StatusPanel } from '../shared/ui/StatusPanel.tsx'

export default function NotFound() {
  return (
    <StatusPanel
      kind="empty"
      title="페이지를 찾을 수 없어요"
      description="주소가 바뀌었거나 삭제된 페이지입니다"
      action={<Link to="/">홈으로 이동</Link>}
    />
  )
}
