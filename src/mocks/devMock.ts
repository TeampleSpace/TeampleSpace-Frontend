import capabilities from '../../contracts/examples/capabilities.json'
import { createMaterialsMock } from './materials.ts'

// 서버 없이 자료 화면을 확인하는 개발 전용 모드다. npm run dev -- --mode mock으로 켠다
// 응답은 메모리의 가짜 서버가 만들며 실제 서버 연동을 대신하지 않는다
const mock = createMaterialsMock({ analysisMs: 4000 })
const userId = mock.ownerId
const teammate = Object.keys(mock.names).find((id) => id !== userId)!
const now = new Date().toISOString()
const project = {
  id: mock.projectId, name: '캠퍼스 친환경 전환', topic: '다회용컵 사용 늘리기', presentationConstraints: null,
  ownerId: userId, version: 1, memberCount: 2, createdAt: now, updatedAt: now,
}
const user = {
  id: userId, name: mock.names[userId], email: 'owner@example.test', canEmailReauth: false, consentVersions: {},
  ownedProjectCount: 1, onboardingStatus: 'completed', identities: [], version: 1,
}

mock.seed('file', '캠퍼스 환경 실태 보고서.pdf', { pageCount: 12, text: '교내 일회용 컵 사용량은 점심 시간대에 가장 많았다.' })
mock.seed('link', '다회용컵 회수 동선 사례', { createdBy: teammate, text: '여러 대학이 반납함을 이동 동선에 맞춰 늘렸다.', description: '동선 설계에 참고' })
const memo = mock.seed('memo', '다회용컵 사용 인터뷰', {
  createdBy: teammate,
  markdown: '## 인터뷰에서 확인한 점\n\n- 반납함 위치를 찾기 어렵다.\n- **도서관 앞**에 반납함이 필요하다.\n\n> 수업이 끝난 뒤 바로 반납하고 싶어요.',
})
mock.saveNoteAs(memo, teammate, '반납함 위치를 제안할 때 학생회관과 도서관 사이의 동선을 함께 확인해 봅시다.')
mock.seed('link', '대학의 일회용품 감축 사례', { createdBy: teammate, status: 'failed' })

const json = (body: unknown) => new Response(JSON.stringify(body), {
  headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req_dev_mock' },
})
const inner = mock.fetchAs(userId)
const real = window.fetch.bind(window)
window.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.origin)
  if (!url.pathname.startsWith('/v1/')) return real(input, init)
  if (url.pathname === '/v1/capabilities') return Promise.resolve(json(capabilities))
  if (url.pathname === '/v1/me') return Promise.resolve(json(user))
  if (url.pathname === '/v1/projects') return Promise.resolve(json({ items: [project], nextCursor: null }))
  if (url.pathname === `/v1/projects/${project.id}`) return Promise.resolve(json(project))
  return inner(input, init)
}
// 브라우저 콘솔에서 실패 상황을 만들 때 쓴다
Object.assign(window, { teampleMock: mock })
