import { expect, test, vi } from 'vitest'
import { z } from 'zod'
import bootstrapBody from '../../../contracts/examples/auth-bootstrap-authenticated.json'
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
