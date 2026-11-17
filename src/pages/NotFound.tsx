import { useNavigate } from 'react-router'
import { Button } from '../shared/ui/Button.tsx'
import { StatusPanel } from '../shared/ui/StatusPanel.tsx'

export default function NotFound() {
  const navigate = useNavigate()
  return (
    <StatusPanel
      kind="empty"
      title="페이지를 찾을 수 없어요"
      description="삭제되었거나 주소가 변경되었을 수 있어요."
      action={
        <>
          <Button onClick={() => navigate('/')}>홈으로</Button>
          <Button variant="text" onClick={() => navigate(-1)}>
            돌아가기
          </Button>
        </>
      }
    />
  )
}
