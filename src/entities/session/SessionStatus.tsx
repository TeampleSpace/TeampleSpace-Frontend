import { Button } from '../../shared/ui/Button.tsx'
import { RequestError } from '../../shared/ui/RequestError.tsx'
import { StatusPanel } from '../../shared/ui/StatusPanel.tsx'
import { useSession } from './sessionContext.ts'

// 로그인 상태를 확인하는 중이거나 확인에 실패했을 때의 안내
export function SessionStatus() {
  const { loading, error, refresh } = useSession()
  if (loading) return <StatusPanel kind="loading" title="로그인 상태를 확인하고 있어요" />
  if (error) return <RequestError error={error} action={<Button onClick={() => void refresh().catch(() => {})}>다시 시도</Button>} />
  return null
}
