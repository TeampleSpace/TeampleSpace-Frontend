import errorCodes from '../../contracts/error-codes.json'
import { REQUEST_ID_HEADER } from '../shared/api/contract.ts'
import type { Job, Material, MaterialKind, MaterialNote } from '../entities/material/model.ts'

// 자료, 업로드, 원문, 팀 메모, 작업 계약을 메모리에서 흉내 내는 가짜 서버다
// 개발 화면과 테스트에서만 쓰며 실제 서버 연동을 대신하지 않는다
// 응답이 계약 스키마를 통과하는지는 contracts.test.ts에서 확인한다

type Revision = {
  id: string; sourceVersion: number; pageCount: number | null; markdown: string | null
  text: string; createdBy: string; createdAt: string
}
type Stored = {
  id: string; kind: MaterialKind; title: string; description: string | null; status: Material['status']; version: number
  createdBy: string; createdAt: string; updatedAt: string; deleted: boolean
  fileId: string | null; fileName: string | null; sizeBytes: number | null; url: string | null
  revisions: Revision[]; jobIds: string[]; note: MaterialNote
}
type Upload = {
  id: string; userId: string; fileName: string; mimeType: string; sizeBytes: number; checksum: string
  state: 'prepared' | 'consumed' | 'rejected'; expiresAt: number; bytes: Uint8Array | null
}
type StoredJob = Job & { requesterId: string; finishAt: number }

export type MaterialsMock = ReturnType<typeof createMaterialsMock>

export function createMaterialsMock(options: {
  projectId?: string
  ownerId?: string
  members?: Record<string, string>
  now?: () => number
  // 분석 작업이 끝나기까지 걸리는 시간
  analysisMs?: number
  maxBytes?: number
  // 원문 주소가 유효한 시간
  fileUrlMs?: number
} = {}) {
  const projectId = options.projectId ?? '0193a000-0000-7000-8000-000000000001'
  const ownerId = options.ownerId ?? '0193a000-0000-7000-8000-0000000000d1'
  const names: Record<string, string> = options.members ?? { [ownerId]: '팀원 1', '0193a000-0000-7000-8000-0000000000d2': '팀원 2' }
  const now = options.now ?? Date.now
  const maxBytes = options.maxBytes ?? 20 * 1024 * 1024
  const fileUrlMs = options.fileUrlMs ?? 5 * 60 * 1000
  const materials = new Map<string, Stored>()
  const uploads = new Map<string, Upload>()
  const files = new Map<string, Uint8Array>()
  const jobs = new Map<string, StoredJob>()
  const results = new Map<string, { body: string; status: number; response: unknown }>()
  // 나갔거나 제거된 팀원
  const removed = new Set<string>()
  let requestSeq = 0
  let eventSeq = 0

  // 실패 상황을 일부러 만드는 스위치
  const faults = {
    delayMs: 0,
    // 다음 분석 작업을 이 오류 코드로 끝낸다
    failAnalysisCode: '',
    // 분석 작업을 끝내지 않고 붙잡아 둔다
    holdAnalysis: false,
    // 이 경로와 메서드의 다음 요청을 반영한 뒤 응답만 잃는다
    dropNextResponse: '',
    // 이 경로와 메서드의 다음 요청을 이 오류 코드로 거절한다
    failNext: null as { match: string; code: string } | null,
  }
  const calls: { method: string; path: string; key: string | null; body: unknown; headers: Record<string, string> }[] = []

  const iso = (ms = now()) => new Date(ms).toISOString().replace(/\.(\d{3})Z$/, '.$1000Z')
  const nextRequestId = () => `req_mock_${(requestSeq += 1)}`
  function json(status: number, body: unknown) {
    const inBody = (body as { requestId?: unknown } | null)?.requestId
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', [REQUEST_ID_HEADER]: typeof inBody === 'string' ? inBody : nextRequestId() },
    })
  }
  // 오류의 상태와 재시도 여부는 계약의 오류 코드 목록에서 읽는다
  function fail(code: string, extra: object = {}) {
    const entry = errorCodes.codes.find((candidate) => candidate.code === code)
    if (!entry || entry.httpStatus === null) throw new Error(`mock: 계약에 없는 오류 코드 ${code}`)
    return json(entry.httpStatus, {
      error: { code, message: entry.meaning, retryable: entry.retryable, ...extra }, requestId: nextRequestId(),
    })
  }
  const person = (userId: string) => ({ userId, name: names[userId] ?? '탈퇴한 사용자' })

  // 시간이 지난 작업을 끝내고 자료에 결과를 반영한다
  function settle() {
    for (const job of jobs.values()) {
      if (!['queued', 'running'].includes(job.status)) continue
      if (faults.holdAnalysis || now() < job.finishAt) { job.status = 'running'; job.attempt = 1; continue }
      const material = materials.get(job.targetId ?? '')
      const failCode = faults.failAnalysisCode
      job.finishedAt = iso(); job.updatedAt = iso(); job.attempt = 1
      if (!material || material.deleted) {
        job.status = 'failed'; job.error = { code: 'JOB_TARGET_GONE', message: '대상이 삭제됐어요.', retryable: false }
      } else if (failCode) {
        faults.failAnalysisCode = ''
        const entry = errorCodes.codes.find((candidate) => candidate.code === failCode)
        job.status = 'failed'; job.error = { code: failCode, message: entry?.meaning ?? failCode, retryable: entry?.retryable ?? false }
        material.status = 'failed'; material.version += 1; material.updatedAt = iso()
      } else {
        const revision: Revision = {
          id: crypto.randomUUID(), sourceVersion: material.revisions.length + 1,
          pageCount: material.kind === 'file' ? 3 : null, markdown: null,
          text: material.kind === 'file' ? '첫 쪽에서 추출한 본문입니다.' : '수집한 문서에서 추출한 본문입니다.',
          createdBy: material.createdBy, createdAt: iso(),
        }
        material.revisions.push(revision)
        material.status = 'ready'; material.version += 1; material.updatedAt = iso()
        if (material.kind === 'link' && material.title === new URL(material.url!).host) material.title = '수집한 문서 제목'
        job.status = 'succeeded'; job.progress = 100; job.resultRef = { materialId: material.id, revisionId: revision.id }
      }
    }
  }

  function summary(item: Stored) {
    return {
      id: item.id, projectId, kind: item.kind, title: item.title, status: item.status, version: item.version,
      pageCount: item.revisions.at(-1)?.pageCount ?? null, createdBy: person(item.createdBy),
      createdAt: item.createdAt, updatedAt: item.updatedAt,
    }
  }
  function publicJob(job: StoredJob | undefined): Job | null {
    if (!job) return null
    const { requesterId: _requester, finishAt: _finish, ...rest } = job
    return rest
  }
  function detail(item: Stored, actorId: string): Material {
    const current = item.revisions.at(-1)
    const excerpt = current && (current.markdown ?? current.text).trim()
    return {
      ...summary(item), description: item.description,
      source: {
        fileName: item.fileName, mimeType: item.kind === 'file' ? 'application/pdf' : null,
        sizeBytes: item.sizeBytes, url: item.url,
      },
      currentRevision: current ? {
        id: current.id, sourceVersion: current.sourceVersion, pageCount: current.pageCount, summary: null,
        excerpt: excerpt ? { text: excerpt.slice(0, 300), page: item.kind === 'file' ? 1 : null } : null,
        createdBy: person(current.createdBy), createdAt: current.createdAt,
      } : null,
      job: publicJob(jobs.get(item.jobIds.at(-1) ?? '')),
      canDelete: actorId === ownerId || actorId === item.createdBy,
    }
  }
  function newJob(item: Stored, actorId: string): Job {
    const job: StoredJob = {
      id: crypto.randomUUID(), projectId, type: 'material_analysis', status: 'queued', progress: 0, targetType: 'material',
      targetId: item.id, attempt: 0, inputVersions: { materialVersion: item.version }, resultRef: null, error: null,
      cancelRequestedAt: null, createdAt: iso(), updatedAt: iso(), finishedAt: null,
      requesterId: actorId, finishAt: now() + (options.analysisMs ?? 0),
    }
    jobs.set(job.id, job); item.jobIds.push(job.id)
    return publicJob(job)!
  }
  function create(actorId: string, kind: MaterialKind, title: string, fields: Partial<Stored> = {}) {
    const id = crypto.randomUUID()
    const item: Stored = {
      id, kind, title, description: null, status: 'processing', version: 1, createdBy: actorId, createdAt: iso(), updatedAt: iso(),
      deleted: false, fileId: null, fileName: null, sizeBytes: null, url: null, revisions: [], jobIds: [],
      note: { materialId: id, markdown: '', version: 0, updatedBy: null, updatedByName: null, updatedAt: null },
      ...fields,
    }
    materials.set(id, item)
    return item
  }
  function addRevision(item: Stored, actorId: string, markdown: string) {
    item.revisions.push({
      id: crypto.randomUUID(), sourceVersion: item.revisions.length + 1, pageCount: null, markdown, text: markdown,
      createdBy: actorId, createdAt: iso(),
    })
  }
  const text = (value: unknown, max: number, required = false) =>
    typeof value === 'string' ? value.trim().length <= max && (!required || value.trim().length > 0) : value === undefined && !required
  const invalid = (field: string) => fail('VALIDATION_FAILED', { fieldErrors: [{ field, code: 'INVALID', message: '입력을 확인해 주세요.' }] })

  async function route(actorId: string, method: string, url: URL, init: RequestInit, key: string | null): Promise<Response> {
    const path = url.pathname
    if (path === '/v1/auth/bootstrap') {
      return json(200, {
        status: 'authenticated', csrfToken: 'mock-csrf', expiresAt: iso(now() + 3600000),
        user: { id: actorId, displayName: person(actorId).name, onboardingStatus: 'completed', version: 1 },
      })
    }
    settle()
    const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) as Record<string, unknown> : {}
    // 저장소 주소는 서명한 주소만으로 받는다
    const put = method === 'PUT' && path.match(/^\/v1\/storage\/uploads\/(.+)$/)
    if (put) {
      const upload = uploads.get(put[1])
      if (!upload || upload.expiresAt <= now()) return fail('FILE_URL_EXPIRED')
      if (upload.state !== 'prepared') return fail('UPLOAD_ALREADY_USED')
      // 브라우저의 파일 객체와 테스트 환경의 파일 객체를 모두 받는다
      const sent = init.body as BodyInit & { arrayBuffer?: () => Promise<ArrayBuffer> }
      upload.bytes = new Uint8Array(await (sent.arrayBuffer ? sent.arrayBuffer() : new Response(sent).arrayBuffer()))
      return json(204, null)
    }
    const fileGet = method === 'GET' && path.match(/^\/v1\/storage\/files\/([^.]+)\.(\d+)$/)
    if (fileGet) {
      const bytes = files.get(fileGet[1])
      if (!bytes || Number(fileGet[2]) <= now() || removed.has(actorId)) return fail('FILE_URL_EXPIRED')
      return new Response(bytes.slice().buffer, { status: 200, headers: { 'Content-Type': 'application/pdf', [REQUEST_ID_HEADER]: nextRequestId() } })
    }
    // 참여한 적 없으면 없는 자원, 나갔거나 제거됐으면 접근 거절이다
    if (removed.has(actorId)) return fail('ACCESS_DENIED')
    if (!(actorId in names)) return fail('NOT_FOUND')

    const inProject = path.match(/^\/v1\/projects\/([^/]+)\/(materials|uploads|jobs)(?:\/(file|link|memo))?$/)
    if (inProject) {
      if (inProject[1] !== projectId) return fail('NOT_FOUND')
      if (method === 'GET' && inProject[2] === 'materials') return list(url)
      if (method === 'GET' && inProject[2] === 'jobs') return json(200, { items: [...jobs.values()].reverse().map(publicJob), nextCursor: null })
      if (method === 'POST' && inProject[2] === 'uploads') return prepare(actorId, body)
      if (method === 'POST' && inProject[3]) return idempotent(actorId, method, path, key, body, () => register(actorId, inProject[3], body))
    }
    const jobPath = path.match(/^\/v1\/jobs\/([^/]+)(\/cancel)?$/)
    if (jobPath) {
      const job = jobs.get(jobPath[1])
      if (!job) return fail('NOT_FOUND')
      if (jobPath[2] && method === 'POST') {
        if (actorId !== ownerId && actorId !== job.requesterId) return fail('FORBIDDEN')
        if (['queued', 'running'].includes(job.status)) {
          job.status = 'canceled'; job.cancelRequestedAt = iso(); job.finishedAt = iso(); job.updatedAt = iso()
          const material = materials.get(job.targetId ?? '')
          if (material && !material.deleted) { material.status = 'failed'; material.version += 1; material.updatedAt = iso() }
        }
      }
      return json(200, publicJob(job))
    }
    const match = path.match(/^\/v1\/materials\/([^/]+)(?:\/(source|reprocess|note))?$/)
    const item = match && materials.get(match[1])
    if (!match || !item) return fail('NOT_FOUND')
    if (item.deleted) return fail('MATERIAL_DELETED')
    const [, , sub] = match
    if (!sub && method === 'GET') return json(200, detail(item, actorId))
    if (!sub && method === 'PATCH') return patch(item, actorId, body)
    if (!sub && method === 'DELETE') return remove(item, actorId, body)
    if (sub === 'reprocess' && method === 'POST') {
      return idempotent(actorId, method, path, key, body, () => {
        if (item.status !== 'failed') return fail('MATERIAL_STATE_CONFLICT')
        item.status = 'processing'; item.version += 1; item.updatedAt = iso()
        const job = newJob(item, actorId)
        return json(201, { material: detail(item, actorId), job })
      })
    }
    if (sub === 'source' && method === 'GET') return source(item, url.searchParams.get('revisionId'))
    if (sub === 'note' && method === 'GET') return json(200, item.note)
    if (sub === 'note' && method === 'PUT') {
      if (typeof body.markdown !== 'string' || body.markdown.length > 20000) return invalid('markdown')
      if (body.expectedVersion !== item.note.version) return fail('VERSION_CONFLICT', { currentVersions: { noteVersion: item.note.version } })
      item.note = {
        materialId: item.id, markdown: body.markdown, version: item.note.version + 1,
        updatedBy: actorId, updatedByName: person(actorId).name, updatedAt: iso(),
      }
      return json(200, { materialId: item.id, version: item.note.version, eventId: String((eventSeq += 1)) })
    }
    return fail('NOT_FOUND')
  }

  function list(url: URL) {
    const q = (url.searchParams.get('q') ?? '').trim()
    const kind = url.searchParams.get('kind')
    const status = url.searchParams.get('status')
    const limit = Number(url.searchParams.get('limit') ?? 30)
    const offset = Number(url.searchParams.get('cursor') ?? 0)
    const matched = [...materials.values()].filter((item) => !item.deleted && (!q || item.title.includes(q))).reverse()
    const filtered = matched.filter((item) => (!kind || item.kind === kind) && (!status || item.status === status))
    const count = (value: MaterialKind) => matched.filter((item) => item.kind === value).length
    return json(200, {
      items: filtered.slice(offset, offset + limit).map(summary),
      nextCursor: offset + limit < filtered.length ? String(offset + limit) : null,
      counts: { all: matched.length, file: count('file'), link: count('link'), memo: count('memo') },
    })
  }

  // 같은 키와 본문이면 처음 응답을 그대로 돌려준다
  function idempotent(actorId: string, method: string, path: string, key: string | null, body: unknown, work: () => Response | Promise<Response>) {
    if (!key) return fail('IDEMPOTENCY_KEY_REQUIRED')
    const slot = `${actorId} ${method} ${path} ${key}`
    const stored = results.get(slot)
    const serialized = JSON.stringify(body)
    if (stored) return stored.body === serialized ? json(stored.status, stored.response) : fail('IDEMPOTENCY_KEY_REUSED')
    return Promise.resolve(work()).then(async (response) => {
      results.set(slot, { body: serialized, status: response.status, response: await response.clone().json() })
      return response
    })
  }

  function prepare(actorId: string, body: Record<string, unknown>) {
    if (body.kind !== 'material_pdf' || !text(body.fileName, 255, true)) return invalid('fileName')
    if (body.mimeType !== 'application/pdf') return fail('UPLOAD_TYPE_NOT_ALLOWED')
    if (typeof body.sizeBytes !== 'number' || body.sizeBytes < 1) return invalid('sizeBytes')
    if (body.sizeBytes > maxBytes) return fail('UPLOAD_TOO_LARGE')
    if (typeof body.checksumSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(body.checksumSha256)) return invalid('checksumSha256')
    const upload: Upload = {
      id: crypto.randomUUID(), userId: actorId, fileName: (body.fileName as string).trim(), mimeType: body.mimeType,
      sizeBytes: body.sizeBytes, checksum: body.checksumSha256, state: 'prepared', expiresAt: now() + 10 * 60 * 1000, bytes: null,
    }
    uploads.set(upload.id, upload)
    return json(201, {
      uploadId: upload.id, uploadUrl: `/v1/storage/uploads/${upload.id}`, uploadMethod: 'PUT',
      uploadHeaders: { 'Content-Type': 'application/pdf' }, expiresAt: iso(upload.expiresAt),
    })
  }

  async function register(actorId: string, kind: string, body: Record<string, unknown>) {
    if (!text(body.title, 255, kind === 'memo')) return invalid('title')
    if (!text(body.description, 2000)) return invalid('description')
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null
    if (kind === 'memo') {
      if (typeof body.markdown !== 'string' || body.markdown.length > 100000) return invalid('markdown')
      const item = create(actorId, 'memo', title, { status: 'ready' })
      addRevision(item, actorId, body.markdown)
      return json(201, { material: detail(item, actorId), job: null })
    }
    if (kind === 'link') {
      let url: URL
      try { url = new URL(String(body.url)) } catch { return fail('INVALID_URL', { fieldErrors: [{ field: 'url', code: 'INVALID_URL', message: '주소를 확인해 주세요.' }] }) }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || ['localhost', '127.0.0.1'].includes(url.hostname)) {
        return fail('INVALID_URL', { fieldErrors: [{ field: 'url', code: 'INVALID_URL', message: '주소를 확인해 주세요.' }] })
      }
      const item = create(actorId, 'link', title || url.host, { description, url: url.toString() })
      const job = newJob(item, actorId)
      return json(201, { material: detail(item, actorId), job })
    }
    const upload = uploads.get(String(body.uploadId))
    if (!upload || upload.userId !== actorId) return fail('NOT_FOUND')
    if (upload.state === 'consumed') return fail('UPLOAD_ALREADY_USED')
    if (upload.state === 'rejected') return fail('UPLOAD_REJECTED', { fieldErrors: [{ field: 'file', code: 'NOT_PDF', message: '파일을 다시 선택해 주세요.' }] })
    if (upload.expiresAt <= now()) return fail('UPLOAD_EXPIRED')
    if (!upload.bytes) return fail('UPLOAD_INCOMPLETE')
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', upload.bytes.slice()))
    const actual = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    const reason = upload.bytes.length !== upload.sizeBytes ? 'SIZE_MISMATCH' : actual !== upload.checksum ? 'CHECKSUM_MISMATCH'
      : new TextDecoder().decode(upload.bytes.slice(0, 5)) !== '%PDF-' ? 'NOT_PDF' : ''
    if (reason) {
      upload.state = 'rejected'
      return fail('UPLOAD_REJECTED', { fieldErrors: [{ field: 'file', code: reason, message: '파일을 다시 선택해 주세요.' }] })
    }
    upload.state = 'consumed'
    const fileId = crypto.randomUUID()
    files.set(fileId, upload.bytes)
    const item = create(actorId, 'file', title || upload.fileName, { description, fileId, fileName: upload.fileName, sizeBytes: upload.sizeBytes })
    const job = newJob(item, actorId)
    return json(201, { material: detail(item, actorId), job })
  }

  function patch(item: Stored, actorId: string, body: Record<string, unknown>) {
    if (!text(body.title, 255) || body.title === '' || (typeof body.title === 'string' && !body.title.trim())) return invalid('title')
    if (!text(body.description, 2000)) return invalid('description')
    if (body.markdown !== undefined && (item.kind !== 'memo' || typeof body.markdown !== 'string' || body.markdown.length > 100000)) return invalid('markdown')
    if (body.title === undefined && body.description === undefined && body.markdown === undefined) return invalid('title')
    if (body.expectedVersion !== item.version) return fail('VERSION_CONFLICT', { currentVersions: { materialVersion: item.version } })
    if (typeof body.title === 'string') item.title = body.title.trim()
    if (typeof body.description === 'string') item.description = body.description.trim() || null
    if (typeof body.markdown === 'string') addRevision(item, actorId, body.markdown)
    item.version += 1; item.updatedAt = iso()
    return json(200, detail(item, actorId))
  }

  function remove(item: Stored, actorId: string, body: Record<string, unknown>) {
    if (actorId !== ownerId && actorId !== item.createdBy) return fail('FORBIDDEN')
    if (body.expectedVersion !== item.version) return fail('VERSION_CONFLICT', { currentVersions: { materialVersion: item.version } })
    item.deleted = true; item.version += 1
    for (const id of item.jobIds) {
      const job = jobs.get(id)
      if (job && ['queued', 'running'].includes(job.status)) { job.status = 'canceled'; job.finishedAt = iso() }
    }
    return json(200, {
      tombstone: { resourceType: 'material', id: item.id, version: item.version, deletedAt: iso() },
      eventId: String((eventSeq += 1)),
    })
  }

  function source(item: Stored, revisionId: string | null) {
    const revision = revisionId ? item.revisions.find((candidate) => candidate.id === revisionId) : item.revisions.at(-1)
    if (revisionId && !revision) return fail('NOT_FOUND')
    if (item.status !== 'ready' || !revision) return fail('MATERIAL_STATE_CONFLICT')
    const expires = now() + fileUrlMs
    return json(200, {
      materialId: item.id, revisionId: revision.id, sourceVersion: revision.sourceVersion, kind: item.kind, title: item.title,
      file: item.kind === 'file' ? {
        url: `/v1/storage/files/${item.fileId}.${expires}`, expiresAt: iso(expires), mimeType: 'application/pdf',
        fileName: item.fileName!, sizeBytes: item.sizeBytes!, pageCount: revision.pageCount ?? 1,
      } : null,
      markdown: item.kind === 'memo' ? revision.markdown : null,
      link: item.kind === 'link' ? { url: item.url!, title: item.title, text: revision.text } : null,
    })
  }

  // 사용자 한 명의 브라우저 세션이 쓰는 fetch를 만든다
  function fetchAs(actorId: string): typeof fetch {
    return async (input, init = {}) => {
      const url = new URL(String(input), 'http://mock.local')
      const method = init.method ?? 'GET'
      const headers = Object.fromEntries(new Headers(init.headers).entries())
      const key = headers['idempotency-key'] ?? null
      const slot = `${method} ${url.pathname}`
      calls.push({
        method, path: url.pathname + url.search, key, headers,
        body: typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined,
      })
      if (faults.delayMs) await new Promise((resolve) => setTimeout(resolve, faults.delayMs))
      if (init.signal?.aborted) throw init.signal.reason
      if (faults.failNext && slot.includes(faults.failNext.match)) {
        const { code } = faults.failNext
        faults.failNext = null
        return fail(code)
      }
      const response = await route(actorId, method, url, init, key)
      if (faults.dropNextResponse && slot.includes(faults.dropNextResponse)) {
        faults.dropNextResponse = ''
        throw new TypeError('mock: 응답 유실')
      }
      return response
    }
  }

  return {
    fetchAs, faults, calls, projectId, ownerId, names,
    // 준비된 자료를 바로 넣는다
    seed(kind: MaterialKind, title: string, fields: { createdBy?: string; status?: Material['status']; markdown?: string; text?: string; pageCount?: number; url?: string; description?: string } = {}) {
      const actor = fields.createdBy ?? ownerId
      const item = create(actor, kind, title, {
        status: fields.status ?? 'ready', url: fields.url ?? (kind === 'link' ? 'https://example.com/reuse-cup' : null),
        description: fields.description ?? null,
        fileName: kind === 'file' ? title : null, sizeBytes: kind === 'file' ? 482113 : null,
      })
      // 파일과 링크 자료는 항상 분석 작업을 가진다
      const job = kind === 'memo' ? undefined : jobs.get(newJob(item, actor).id)
      if (item.status === 'ready') {
        const revision: Revision = {
          id: crypto.randomUUID(), sourceVersion: 1, pageCount: kind === 'file' ? fields.pageCount ?? 6 : null,
          markdown: kind === 'memo' ? fields.markdown ?? '메모 본문' : null, text: fields.text ?? fields.markdown ?? '원문에서 뽑은 발췌입니다.',
          createdBy: actor, createdAt: iso(),
        }
        item.revisions.push(revision)
        if (job) Object.assign(job, { status: 'succeeded', progress: 100, attempt: 1, finishedAt: iso(), resultRef: { materialId: item.id, revisionId: revision.id } })
      } else if (job && item.status === 'failed') {
        Object.assign(job, { status: 'failed', attempt: 1, finishedAt: iso(), error: { code: 'ANALYSIS_FAILED', message: '분석 중 문제가 생겼어요.', retryable: true } })
      }
      return item.id
    },
    // 파일 자료의 원문 바이트를 넣는다
    attachFile(materialId: string, bytes: Uint8Array) {
      const item = materials.get(materialId)!
      item.fileId = crypto.randomUUID(); item.sizeBytes = bytes.length
      files.set(item.fileId, bytes)
    },
    saveNoteAs(materialId: string, actorId: string, markdown: string) {
      const item = materials.get(materialId)!
      item.note = { materialId, markdown, version: item.note.version + 1, updatedBy: actorId, updatedByName: person(actorId).name, updatedAt: iso() }
    },
    renameAs(materialId: string, title: string) {
      const item = materials.get(materialId)!
      item.title = title; item.version += 1
    },
    // 다른 팀원이 메모 본문을 먼저 고친 상태를 만든다
    editAs(materialId: string, markdown: string) {
      const item = materials.get(materialId)!
      addRevision(item, '0193a000-0000-7000-8000-0000000000d2', markdown); item.version += 1
    },
    removeMember(userId: string) { removed.add(userId) },
    get: (materialId: string) => materials.get(materialId),
    count: () => [...materials.values()].filter((item) => !item.deleted).length,
    jobs: () => [...jobs.values()],
  }
}
