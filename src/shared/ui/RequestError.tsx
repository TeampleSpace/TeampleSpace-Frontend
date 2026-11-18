import { ApiError, TransportError } from '../api/client.ts'
import { StatusPanel } from './StatusPanel.tsx'

function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      UNAUTHENTICATED: '로그인이 만료되었습니다. 다시 로그인해 주세요',
      AUTH_REQUIRED: '다시 로그인해 주세요',
      ACCESS_DENIED: '이 프로젝트에 더 이상 접근할 수 없습니다',
      FORBIDDEN: '이 작업을 할 권한이 없습니다',
      VERSION_CONFLICT: '다른 곳에서 내용이 변경되었습니다. 최신 내용을 다시 불러와 주세요',
      FEATURE_NOT_ENABLED: '아직 사용할 수 없는 기능입니다',
      RATE_LIMITED: '요청이 많습니다. 잠시 뒤 다시 시도해 주세요',
    }
    return messages[error.code] ?? error.message
  }
  if (error instanceof TransportError) return error.kind === 'timeout'
    ? '응답이 늦어지고 있습니다. 잠시 뒤 다시 시도해 주세요'
    : '서버에 연결할 수 없습니다. 연결 상태를 확인하고 다시 시도해 주세요'
  return '처리하지 못했습니다. 다시 시도해 주세요'
}

export function RequestError({ error, action }: { error: unknown; action?: React.ReactNode }) {
  if (!error) return null
  return <StatusPanel kind="error" title={errorMessage(error)} action={action}
    requestId={error instanceof ApiError || error instanceof TransportError ? error.requestId : undefined} />
}
