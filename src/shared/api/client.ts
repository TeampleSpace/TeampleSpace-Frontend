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

export type ApiClient = ReturnType<typeof createApiClient>

// 모든 요청은 /v1 아래로 보내고 세션 쿠키와 CSRF 토큰을 함께 싣는다
export function createApiClient(
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
) {
  let csrfToken: string | undefined
  let bootstrapping: Promise<SessionBootstrap> | undefined

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

    let response: Response
    try {
      if (method !== 'GET') {
        // 세션 조회는 여러 요청이 함께 기다리므로 이 요청의 신호로 끊지 않고 기다리기만 그만둔다
        if (!csrfToken) await waitUnless(bootstrap(), signal)
        if (csrfToken) headers[CSRF_HEADER] = csrfToken
      }
      response = await fetchImpl(`/v1${path}`, {
        method,
        headers,
        credentials: 'same-origin',
        body: options.binaryBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
        signal,
        keepalive: options.keepalive,
      })
    } catch (cause) {
      // 호출한 쪽에서 취소한 요청은 그대로 알린다
      if (options.signal?.aborted) throw cause
      // 세션 조회가 실패한 이유는 바꾸지 않는다
      if (cause instanceof ApiError || cause instanceof TransportError) throw cause
      const timedOut =
        cause instanceof DOMException && cause.name === 'TimeoutError'
      throw new TransportError(timedOut ? 'timeout' : 'network', { cause })
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
      throw new ApiError(response.status, error.data, readRetryAfter(response))
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

  // 세션 컨텍스트를 읽고 CSRF 토큰을 보관한다
  function bootstrap(): Promise<SessionBootstrap> {
    bootstrapping ??= request('/auth/bootstrap', sessionBootstrapSchema, {
      timeoutMs: BOOTSTRAP_TIMEOUT_MS,
    })
      .then((session) => {
        csrfToken = session.csrfToken
        return session
      })
      .finally(() => {
        bootstrapping = undefined
      })
    return bootstrapping
  }

  return { request, bootstrap }
}
