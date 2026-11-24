import { expect, test, vi } from 'vitest'
import { z } from 'zod'
import bootstrapBody from '../../../contracts/examples/auth-bootstrap-authenticated.json'
import anonymousBody from '../../../contracts/examples/auth-bootstrap-anonymous.json'
import versionConflict from '../../../contracts/examples/error-version-conflict.json'
import { ApiError, TransportError, createApiClient } from './client.ts'
import { CSRF_HEADER } from './contract.ts'

const okSchema = z.object({ ok: z.boolean() })

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers })
}

// 요청 기록을 남기고 주소별로 응답하는 가짜 fetch
function fakeFetch(respond: (url: string, init: RequestInit) => Response) {
  return vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    if (url === '/v1/auth/bootstrap') return json(200, bootstrapBody)
    return respond(url, init)
  })
}

test('조회 요청은 /v1 아래로 보내고 응답을 형식 검사한다', async () => {
  const fetchImpl = fakeFetch(() => json(200, { ok: true }))
  const client = createApiClient(fetchImpl)

  await expect(client.request('/capabilities', okSchema)).resolves.toEqual({
    ok: true,
  })
  const [url, init] = fetchImpl.mock.calls[0]
  expect(url).toBe('/v1/capabilities')
  expect(init?.credentials).toBe('same-origin')
})

test('변경 요청에는 CSRF 토큰과 멱등 키를 싣고 세션 조회는 한 번만 한다', async () => {
  const fetchImpl = fakeFetch(() => json(200, { ok: true }))
  const client = createApiClient(fetchImpl)

  await Promise.all([
    client.request('/a', okSchema, { method: 'PATCH', body: { n: 1 }, idempotencyKey: 'key-1' }),
    client.request('/b', okSchema, { method: 'POST', body: { n: 2 } }),
  ])

  const urls = fetchImpl.mock.calls.map(([url]) => url)
  expect(urls.filter((url) => url === '/v1/auth/bootstrap')).toHaveLength(1)

  const patch = fetchImpl.mock.calls.find(([url]) => url === '/v1/a')
  const headers = patch?.[1]?.headers as Record<string, string>
  expect(headers[CSRF_HEADER]).toBe(bootstrapBody.csrfToken)
  expect(headers['Idempotency-Key']).toBe('key-1')
  expect(patch?.[1]?.body).toBe('{"n":1}')
})

test('공통 오류 구조와 현재 버전, 재시도 대기 시간을 읽는다', async () => {
  // 계약의 버전 충돌 예제를 그대로 응답으로 쓴다
  const client = createApiClient(
    fakeFetch(() => json(409, versionConflict, { 'Retry-After': '3' })),
  )

  const error = await client.request('/x', okSchema).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(ApiError)
  expect(error).toMatchObject({
    status: 409,
    code: 'VERSION_CONFLICT',
    retryable: false,
    currentVersions: versionConflict.error.currentVersions,
    requestId: versionConflict.requestId,
    retryAfterSeconds: 3,
  })
})

test('계약과 다른 응답은 성공으로 처리하지 않는다', async () => {
  const wrongSuccess = createApiClient(fakeFetch(() => json(200, { nope: 1 })))
  await expect(wrongSuccess.request('/x', okSchema)).rejects.toMatchObject({
    name: 'TransportError',
    kind: 'invalid_response',
    status: 200,
  })

  const wrongError = createApiClient(fakeFetch(() => json(500, { message: 'x' })))
  await expect(wrongError.request('/x', okSchema)).rejects.toMatchObject({
    kind: 'invalid_response',
    status: 500,
  })
})

test('공통 오류 형식이 아닌 응답도 헤더의 요청 식별자로 추적할 수 있다', async () => {
  const client = createApiClient(
    fakeFetch(() => json(400, { status: 400 }, { 'X-Request-Id': 'req_from_header' })),
  )
  await expect(client.request('/x', okSchema)).rejects.toMatchObject({
    kind: 'invalid_response',
    status: 400,
    requestId: 'req_from_header',
  })
})

test('응답을 받지 못한 경우를 서버 오류와 구분한다', async () => {
  const offline = createApiClient(
    fakeFetch(() => {
      throw new TypeError('Failed to fetch')
    }),
  )
  const error = await offline.request('/x', okSchema).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(TransportError)
  expect(error).toMatchObject({ kind: 'network' })
})

test('제한 시간을 넘기면 timeout으로 알린다', async () => {
  // 취소 신호가 올 때까지 응답하지 않는 서버
  const hanging = createApiClient((_input, init) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
    })
  })
  await expect(
    hanging.request('/x', okSchema, { timeoutMs: 10 }),
  ).rejects.toMatchObject({ kind: 'timeout' })
})

// 세션 조회만 원하는 때에 끝나는 가짜 fetch
function gatedBootstrap() {
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init: RequestInit = {}) => {
    if (String(input) !== '/v1/auth/bootstrap') return json(200, { ok: true })
    await gate
    return json(200, bootstrapBody)
  })
  const sent = (path: string) => fetchImpl.mock.calls.filter(([url]) => url === `/v1${path}`)
  return { fetchImpl, release, sent }
}

test('세션 조회가 응답하지 않아도 변경 요청은 제한 시간에 끝난다', async () => {
  const { fetchImpl, sent } = gatedBootstrap()
  const client = createApiClient(fetchImpl)

  const error = await client
    .request('/x', okSchema, { method: 'PATCH', body: {}, timeoutMs: 10 })
    .catch((e: unknown) => e)
  expect(error).toBeInstanceOf(TransportError)
  expect(error).toMatchObject({ kind: 'timeout' })
  // 실제 변경 요청은 보내지 않았고 세션 조회에도 자체 시간 제한이 걸려 있다
  expect(sent('/x')).toHaveLength(0)
  expect(sent('/auth/bootstrap')[0][1]?.signal).toBeInstanceOf(AbortSignal)
})

test('세션 조회를 기다리던 요청을 취소해도 함께 기다리던 요청은 진행한다', async () => {
  const { fetchImpl, release, sent } = gatedBootstrap()
  const client = createApiClient(fetchImpl)
  const controller = new AbortController()

  const canceled = client
    .request('/a', okSchema, { method: 'PATCH', body: {}, signal: controller.signal })
    .catch((e: unknown) => e)
  const other = client.request('/b', okSchema, { method: 'PATCH', body: {} })

  controller.abort()
  expect(await canceled).toMatchObject({ name: 'AbortError' })

  release()
  await expect(other).resolves.toEqual({ ok: true })
  expect(sent('/a')).toHaveLength(0)
  expect(sent('/b')).toHaveLength(1)

  // 조회가 끝난 뒤의 변경 요청은 다시 조회하지 않고 토큰을 싣는다
  await client.request('/c', okSchema, { method: 'POST', body: {}, timeoutMs: 1000 })
  expect(sent('/auth/bootstrap')).toHaveLength(1)
  const headers = sent('/c')[0][1]?.headers as Record<string, string>
  expect(headers[CSRF_HEADER]).toBe(bootstrapBody.csrfToken)
})

const csrfInvalid = {
  error: { code: 'CSRF_INVALID', message: '요청 확인 정보가 만료됐어요.', retryable: false },
  requestId: 'req_csrf',
}

// 세션 조회마다 다음 응답을 돌려주고, 변경 요청은 받은 토큰에 따라 응답하는 가짜 fetch
function rotatingSession(sessions: unknown[], respond: (token: string | undefined) => Response) {
  let index = 0
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (String(input) === '/v1/auth/bootstrap') return json(200, sessions[Math.min(index++, sessions.length - 1)])
    return respond((init.headers as Record<string, string>)[CSRF_HEADER])
  })
  const sent = (path: string) => fetchImpl.mock.calls.filter(([url]) => url === `/v1${path}`)
  const tokens = (path: string) => sent(path).map(([, init]) => (init?.headers as Record<string, string> | undefined)?.[CSRF_HEADER])
  return { fetchImpl, sent, tokens }
}

const renewed = { ...bootstrapBody, csrfToken: 'csrf_renewed' }

test('CSRF 토큰이 거절되면 세션을 다시 읽고 새 토큰으로 한 번 더 보낸다', async () => {
  const { fetchImpl, sent, tokens } = rotatingSession([bootstrapBody, renewed],
    (token) => token === 'csrf_renewed' ? json(200, { ok: true }) : json(403, csrfInvalid))
  const client = createApiClient(fetchImpl)

  await expect(client.request('/x', okSchema, { method: 'PATCH', body: { n: 1 }, idempotencyKey: 'key-1' }))
    .resolves.toEqual({ ok: true })
  expect(tokens('/x')).toEqual([bootstrapBody.csrfToken, 'csrf_renewed'])
  expect(sent('/x')[1][1]?.headers).toMatchObject({ 'Idempotency-Key': 'key-1' })
  expect(sent('/auth/bootstrap')).toHaveLength(2)

  // 다음 변경 요청은 새 토큰을 바로 싣는다
  await client.request('/y', okSchema, { method: 'POST', body: {} })
  expect(tokens('/y')).toEqual(['csrf_renewed'])
  expect(sent('/auth/bootstrap')).toHaveLength(2)
})

test('함께 거절된 요청들은 세션을 한 번만 다시 읽는다', async () => {
  const { fetchImpl, sent } = rotatingSession([bootstrapBody, renewed],
    (token) => token === 'csrf_renewed' ? json(200, { ok: true }) : json(403, csrfInvalid))
  const client = createApiClient(fetchImpl)

  await Promise.all([
    client.request('/a', okSchema, { method: 'PATCH', body: {} }),
    client.request('/b', okSchema, { method: 'POST', body: {} }),
  ])
  expect(sent('/auth/bootstrap')).toHaveLength(2)
})

test('다시 읽은 세션의 사용자가 바뀌었으면 다시 보내지 않고 로그인 필요로 알린다', async () => {
  const { fetchImpl, sent } = rotatingSession([bootstrapBody, { ...anonymousBody, csrfToken: 'csrf_renewed' }],
    () => json(403, csrfInvalid))
  const client = createApiClient(fetchImpl)

  const changed = vi.fn()
  client.onSessionChange(changed)

  const error = await client.request('/x', okSchema, { method: 'PATCH', body: {} }).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(ApiError)
  expect(error).toMatchObject({ status: 401, code: 'UNAUTHENTICATED', requestId: 'req_csrf' })
  expect(sent('/x')).toHaveLength(1)
  expect(changed).toHaveBeenCalledTimes(1)

  // 이전 사용자의 화면에서 다시 저장해도 새 세션의 토큰으로 보내지 않는다
  await expect(client.request('/x', okSchema, { method: 'PATCH', body: {} }))
    .rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })
  await expect(client.request('/y', okSchema, { method: 'POST', body: {} }))
    .rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })
  expect(sent('/x')).toHaveLength(1)
  expect(sent('/y')).toHaveLength(0)
  expect(changed).toHaveBeenCalledTimes(1)
  // 조회 요청은 막지 않는다
  await client.request('/z', okSchema).catch(() => {})
  expect(sent('/z')).toHaveLength(1)
})

test('사용자가 바뀐 뒤에는 화면이 세션을 다시 읽어야 변경 요청을 다시 보낸다', async () => {
  const { fetchImpl, sent } = rotatingSession([bootstrapBody, { ...anonymousBody, csrfToken: 'csrf_renewed' }],
    (token) => token === 'csrf_renewed' ? json(200, { ok: true }) : json(403, csrfInvalid))
  const client = createApiClient(fetchImpl)

  await expect(client.request('/x', okSchema, { method: 'PATCH', body: {} })).rejects.toMatchObject({ status: 401 })
  await expect(client.request('/x', okSchema, { method: 'PATCH', body: {} })).rejects.toMatchObject({ status: 401 })

  await client.bootstrap()
  await expect(client.request('/x', okSchema, { method: 'PATCH', body: {} })).resolves.toEqual({ ok: true })
  expect(sent('/x')).toHaveLength(2)
})

test('새 토큰도 거절되면 더 다시 보내지 않는다', async () => {
  const { fetchImpl, sent } = rotatingSession([bootstrapBody, renewed], () => json(403, csrfInvalid))
  const client = createApiClient(fetchImpl)

  await expect(client.request('/x', okSchema, { method: 'DELETE' })).rejects.toMatchObject({ code: 'CSRF_INVALID' })
  expect(sent('/x')).toHaveLength(2)
  expect(sent('/auth/bootstrap')).toHaveLength(2)
})

test('CSRF가 아닌 403은 세션을 다시 읽지 않는다', async () => {
  const { fetchImpl, sent } = rotatingSession([bootstrapBody],
    () => json(403, { ...csrfInvalid, error: { ...csrfInvalid.error, code: 'FORBIDDEN' } }))
  const client = createApiClient(fetchImpl)

  await expect(client.request('/x', okSchema, { method: 'PATCH', body: {} })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  expect(sent('/x')).toHaveLength(1)
  expect(sent('/auth/bootstrap')).toHaveLength(1)
})
