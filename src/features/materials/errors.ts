import { ApiError, TransportError } from '../../shared/api/client.ts'

// 로그인이 풀렸거나 프로젝트에서 나갔거나 제거된 경우. 기존 내용을 가려야 한다
export function isAccessLoss(reason: unknown) {
  return reason instanceof ApiError && (reason.status === 401 || reason.code === 'ACCESS_DENIED')
}

// 자료가 없거나 삭제된 경우
export function isGone(reason: unknown) {
  return reason instanceof ApiError && (reason.code === 'MATERIAL_DELETED' || reason.code === 'NOT_FOUND')
}

// 요청이 서버에 반영됐는지 알 수 없는 경우. 같은 멱등 키로 다시 보낼 수 있다
export function isUncertain(reason: unknown) {
  return reason instanceof TransportError
    || (reason instanceof ApiError && (reason.status >= 500 || reason.code === 'REQUEST_IN_PROGRESS'))
}
