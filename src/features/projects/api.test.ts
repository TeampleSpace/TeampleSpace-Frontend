import { expect, test, vi } from 'vitest'
import { createApiClient } from '../../shared/api/client.ts'
import { createProjectsApi } from './api.ts'

const project = { id: 'project-1', name: '팀 과제', topic: null, presentationConstraints: null,
  ownerId: 'owner-1', version: 3, memberCount: 2, createdAt: '2026-11-18T00:00:00Z', updatedAt: '2026-11-18T00:00:00Z' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
const bootstrap = () => json(200, { status: 'authenticated', csrfToken: 'session-token', expiresAt: '2026-11-19T00:00:00Z' })

test('프로젝트 생성의 불확실한 응답을 같은 본문과 키로 다시 확인한다', async () => {
  let first = true
  const fetcher = vi.fn(async (input: RequestInfo | URL, _init: RequestInit = {}) => {
    if (String(input).endsWith('/auth/bootstrap')) return bootstrap()
    if (first) { first = false; throw new TypeError('연결 끊김') }
    return json(201, project)
  })
  const api = createProjectsApi(createApiClient(fetcher))
  const input = { name: '팀 과제', topic: '한글 발표' }
  await expect(api.create(input, 'same-key')).rejects.toMatchObject({ kind: 'network' })
  await expect(api.create(input, 'same-key')).resolves.toMatchObject({ id: 'project-1' })
  const requests = fetcher.mock.calls.filter(([url]) => String(url).endsWith('/projects'))
  expect(requests).toHaveLength(2)
  for (const [, init] of requests) {
    expect(init!.headers).toMatchObject({ 'X-CSRF-Token': 'session-token', 'Idempotency-Key': 'same-key' })
    expect(JSON.parse(String(init!.body))).toEqual(input)
  }
})

test('팀원 제거는 멤버십 버전과 명령 식별자를 보내고 접근 거절을 유지한다', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL, _init: RequestInit = {}) => {
    if (String(input).endsWith('/auth/bootstrap')) return bootstrap()
    return json(403, { error: { code: 'ACCESS_DENIED', message: '접근할 수 없습니다', retryable: false }, requestId: 'request-1' })
  })
  const api = createProjectsApi(createApiClient(fetcher))
  await expect(api.removeMember('project-1', 'member-1', 4, 'mutation-1', 'key-1')).rejects.toMatchObject({ status: 403, code: 'ACCESS_DENIED' })
  const request = fetcher.mock.calls.find(([url]) => String(url).endsWith('/members/member-1'))!
  expect(request[1]!.method).toBe('DELETE')
  expect(JSON.parse(String(request[1]!.body))).toEqual({ expectedMembershipVersion: 4, clientMutationId: 'mutation-1' })
  expect(request[1]!.headers).toMatchObject({ 'Idempotency-Key': 'key-1', 'X-CSRF-Token': 'session-token' })
})

test('초대 조회와 참여 요청은 분리되고 설정 저장은 기준 버전을 전달한다', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    if (url.endsWith('/auth/bootstrap')) return bootstrap()
    if (url.includes('/invitations/')) return json(200, { projectName: '팀 과제', inviterName: '소유자', expiresAt: '2026-11-19T00:00:00Z', alreadyMember: false })
    return init.method === 'PATCH' ? json(200, { ...project, name: '새 이름', version: 4 }) : json(200, project)
  })
  const api = createProjectsApi(createApiClient(fetcher))
  await api.invitation('safe-token')
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/accept'))).toBe(false)
  await api.update('project-1', 3, { name: '새 이름' })
  const request = fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH')!
  expect(JSON.parse(String(request[1]!.body))).toEqual({ name: '새 이름', expectedVersion: 3 })
})
