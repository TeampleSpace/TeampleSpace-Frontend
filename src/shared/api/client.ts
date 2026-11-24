import type { z } from 'zod'
import {
  CSRF_HEADER,
  REQUEST_ID_HEADER,
  errorBodySchema,
  sessionBootstrapSchema,
} from './contract.ts'
import type {
  CurrentVersions,
  ErrorBody,
  FieldError,
  SessionBootstrap,
} from './contract.ts'

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  // 문서 변경 요청에 필수인 멱등 키
  idempotencyKey?: string
  headers?: Record<string, string>
  timeoutMs?: number
  signal?: AbortSignal
  // 페이지를 닫는 중에도 끝까지 보낸다
  keepalive?: boolean
} & ({ body?: unknown; binaryBody?: never } | { body?: never; binaryBody: Blob })

// 서버가 공통 오류 구조로 응답한 경우
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly retryable: boolean
  readonly fieldErrors: FieldError[]
  readonly currentVersions?: CurrentVersions
  readonly requestId: string
  // 이 시간이 지나기 전에는 같은 요청을 다시 보내지 않는다
  readonly retryAfterSeconds?: number

  constructor(status: number, body: ErrorBody, retryAfterSeconds?: number) {
    super(body.error.message)
    this.name = 'ApiError'
    this.status = status
    this.code = body.error.code
    this.retryable = body.error.retryable
    this.fieldErrors = body.error.fieldErrors ?? []
    this.currentVersions = body.error.currentVersions
    this.requestId = body.requestId
    this.retryAfterSeconds = retryAfterSeconds
  }
}

// 응답을 받지 못했거나 계약과 다른 응답을 받은 경우
// 요청이 서버에 반영됐는지 알 수 없다
export class TransportError extends Error {
  readonly kind: 'network' | 'timeout' | 'invalid_response'
  readonly status?: number
  // 응답 헤더로 받은 요청 식별자. 본문을 읽지 못해도 서버 로그와 이어 볼 수 있다
  readonly requestId?: string

  constructor(
    kind: TransportError['kind'],
    details: { status?: number; requestId?: string; cause?: unknown } = {},
  ) {
    super(`요청 결과를 확인하지 못했습니다 (${kind})`, { cause: details.cause })
    this.name = 'TransportError'
    this.kind = kind
    this.status = details.status
    this.requestId = details.requestId
  }
}

function readRetryAfter(response: Response): number | undefined {
  const value = response.headers.get('Retry-After')
  if (value === null || value.trim() === '') return undefined
  const seconds = Number(value)
  return Number.isInteger(seconds) && seconds >= 0 ? seconds : undefined
}

// 세션 조회가 끝나지 않아 뒤따르는 요청이 계속 막히는 일을 막는다
const BOOTSTRAP_TIMEOUT_MS = 10000

// 신호가 먼저 끝나면 기다리던 일은 그대로 두고 빠져나온다
function waitUnless<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort))
  })
}

// 응답을 받기 전에 끝난 요청의 이유를 정리한다
function transportFailure(cause: unknown, callerSignal?: AbortSignal): unknown {
  // 호출한 쪽에서 취소한 요청은 그대로 알린다
  if (callerSignal?.aborted) return cause
  // 세션 조회가 실패한 이유는 바꾸지 않는다
  if (cause instanceof ApiError || cause instanceof TransportError) return cause
  const timedOut = cause instanceof DOMException && cause.name === 'TimeoutError'
  return new TransportError(timedOut ? 'timeout' : 'network', { cause })
}

// 토큰을 다시 받는 사이 로그인한 사용자가 바뀌었거나 로그인이 끝났다
function sessionChanged(requestId: string): ApiError {
  return new ApiError(401, {
    error: {
      code: 'UNAUTHENTICATED',
      message: '로그인 상태가 바뀌었어요. 다시 로그인해 주세요',
      retryable: false,
      fieldErrors: [],
    },
    requestId,
  })
}

export type ApiClient = ReturnType<typeof createApiClient>

// 모든 요청은 /v1 아래로 보내고 세션 쿠키와 CSRF 토큰을 함께 싣는다
export function createApiClient(
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
) {
  let csrfToken: string | undefined
  // 토큰을 받은 세션의 사용자. 토큰을 다시 받았을 때 같은 사용자인지 비교한다
  let sessionUserId: string | null | undefined
  let bootstrapping: Promise<SessionBootstrap> | undefined
  // 사용자가 바뀐 것을 알아챈 요청의 식별자. 화면이 세션을 다시 읽을 때까지 변경 요청을 막는다
  let changedBy: string | undefined
  const sessionListeners = new Set<() => void>()

  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    options: RequestOptions = {},
  ): Promise<T> {
    const method = options.method ?? 'GET'
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options.headers,
    }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    if (options.binaryBody) headers['Content-Type'] = 'application/octet-stream'
    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey
    }

    // 시간 제한은 세션 조회를 기다리는 시간까지 포함해서 센다
    const signals = [
      options.signal,
      options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
    ].filter((signal) => signal !== undefined)
    const signal = signals.length > 0 ? AbortSignal.any(signals) : undefined

    // 거절된 토큰은 서버가 요청을 처리하기 전에 막으므로 새 토큰으로 한 번 더 보낼 수 있다
    for (let attempt = 0; ; attempt++) {
      let sentToken: string | undefined
      let sentUserId: string | null | undefined
      let response: Response
      try {
        if (method !== 'GET') {
          // 이전 사용자의 화면에서 보낸 변경이 새 사용자의 세션으로 처리되지 않게 한다
          if (changedBy !== undefined) throw sessionChanged(changedBy)
          // 세션 조회는 여러 요청이 함께 기다리므로 이 요청의 신호로 끊지 않고 기다리기만 그만둔다
          if (!csrfToken) await waitUnless(loadSession(), signal)
          sentToken = csrfToken
          sentUserId = sessionUserId
        }
        response = await fetchImpl(`/v1${path}`, {
          method,
          headers: sentToken ? { ...headers, [CSRF_HEADER]: sentToken } : headers,
          credentials: 'same-origin',
          body: options.binaryBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
          signal,
          keepalive: options.keepalive,
        })
      } catch (cause) {
        throw transportFailure(cause, options.signal)
      }

      const json: unknown =
        response.status === 204
          ? undefined
          : await response.json().catch(() => undefined)

      // 서버는 모든 응답에 요청 식별자를 싣는다
      const requestId = response.headers.get(REQUEST_ID_HEADER) ?? undefined

      if (!response.ok) {
        const error = errorBodySchema.safeParse(json)
        if (!error.success) {
          throw new TransportError('invalid_response', { status: response.status, requestId })
        }
        const failure = new ApiError(response.status, error.data, readRetryAfter(response))
        if (failure.code !== 'CSRF_INVALID' || method === 'GET' || attempt > 0) throw failure
        try {
          // 함께 거절된 다른 요청이 이미 새 토큰을 받았으면 다시 조회하지 않는다
          if (csrfToken === sentToken) await waitUnless(loadSession(), signal)
        } catch (cause) {
          throw transportFailure(cause, options.signal)
        }
        // 다른 사용자의 세션이나 로그아웃된 세션으로 같은 변경을 다시 보내지 않는다
        if (sessionUserId !== sentUserId) {
          if (changedBy === undefined) {
            changedBy = failure.requestId
            sessionListeners.forEach((listener) => listener())
          }
          throw sessionChanged(changedBy)
        }
        continue
      }

      // 계약과 다른 성공 응답을 조용히 통과시키지 않는다
      const parsed = schema.safeParse(json)
      if (!parsed.success) {
        throw new TransportError('invalid_response', {
          status: response.status,
          requestId,
          cause: parsed.error,
        })
      }
      return parsed.data
    }
  }

  // 화면이 세션을 다시 읽으면 바뀐 사용자를 반영한 것으로 보고 변경 요청을 다시 허용한다
  async function bootstrap(): Promise<SessionBootstrap> {
    const session = await loadSession()
    changedBy = undefined
    return session
  }

  // 로그인한 사용자가 바뀐 것을 알아채면 알린다
  function onSessionChange(listener: () => void): () => void {
    sessionListeners.add(listener)
    return () => {
      sessionListeners.delete(listener)
    }
  }

  // 세션 컨텍스트를 읽고 CSRF 토큰을 보관한다
  function loadSession(): Promise<SessionBootstrap> {
    bootstrapping ??= request('/auth/bootstrap', sessionBootstrapSchema, {
      timeoutMs: BOOTSTRAP_TIMEOUT_MS,
    })
      .then((session) => {
        csrfToken = session.csrfToken
        sessionUserId = session.status === 'authenticated' ? session.user?.id ?? null : null
        return session
      })
      .finally(() => {
        bootstrapping = undefined
      })
    return bootstrapping
  }

  return { request, bootstrap, onSessionChange }
}
