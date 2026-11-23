import { Button } from '../../shared/ui/Button.tsx'
import { RequestError } from '../../shared/ui/RequestError.tsx'
import { StatusPanel } from '../../shared/ui/StatusPanel.tsx'
import { useSession } from './sessionContext.ts'
import styles from './SessionStatus.module.css'

// 로그인 상태를 확인하는 중이거나 확인에 실패했을 때의 안내
// standalone은 화면 틀 없이 단독으로 보일 때 가운데에 둔다
export function SessionStatus({ standalone = false }: { standalone?: boolean }) {
  const { loading, error, refresh } = useSession()
  const status = loading ? <StatusPanel kind="loading" title="로그인 상태를 확인하고 있어요" />
    : error ? <RequestError error={error} action={<Button onClick={() => void refresh().catch(() => {})}>다시 시도</Button>} />
    : null
  return standalone && status ? <div className={styles.page}>{status}</div> : status
}
