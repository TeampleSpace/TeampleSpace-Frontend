# 인증과 프로젝트 계약

1단계 구현에서 사용하는 HTTP 계약이다
기존 공통 오류, 세션 초기 정보, 기능 지원 정보 형식을 유지한다

## 인증과 계정

| 요청 | 본문 | 성공 응답 |
| --- | --- | --- |
| GET /v1/capabilities | 없음 | 기존 Capabilities와 authProviders |
| GET /v1/auth/bootstrap | 없음 | 기존 AuthBootstrap |
| POST /v1/auth/challenges | email, purpose: login 또는 reauth | 202 challengeId, expiresAt, retryAfter |
| POST /v1/auth/sessions | challengeId, code | 201 user, needsOnboarding |
| POST /v1/auth/reauthentications | challengeId, code | 201 reauthProof, expiresAt |
| GET /v1/me | 없음 | User |
| PATCH /v1/me | name, version, consentVersions 선택 | User |
| DELETE /v1/auth/session | 없음 | 204 |
| DELETE /v1/me | reauthProof, confirmationText: 탈퇴 | 202 deletionRequestId, status: completed |
| GET /v1/auth/oauth/{provider}/authorize | purpose와 returnTo 쿼리 | 302 제공자 주소 |
| GET /v1/auth/oauth/{provider}/callback | code 또는 error와 state 쿼리 | 303 내부 복귀 주소 |

- User는 id, name, email, consentVersions, ownedProjectCount, onboardingStatus, identities, version, canEmailReauth를 가진다
- onboardingStatus는 pending 또는 completed다
- consentVersions는 약관 type을 키로, 수락한 version을 값으로 갖는 객체다
- identities는 provider, maskedEmail, linkedAt을 가진다. 제공자 subject와 토큰은 공개하지 않는다
- bootstrap의 사용자 요약은 기존 displayName 필드를 유지한다
- authProviders는 provider, enabled, reauthEnabled를 가진 배열이며 email, kakao, naver, google을 포함한다
- 필수 약관은 terms와 privacy다. 유효한 문서 URL과 버전이 없으면 가입 완료를 거절한다
- 모든 쓰기는 bootstrap이 발급한 쿠키와 X-CSRF-Token이 필요하다. Origin은 서버에 설정한 프론트 주소와 일치해야 한다
- 로그인과 로그아웃으로 세션이 바뀐 뒤 bootstrap을 다시 읽는다
- 소셜 로그인 성공 후 신규 사용자는 /onboarding, 기존 사용자는 검증한 returnTo 또는 /로 이동한다
- 소셜 실패는 /auth/error?code=내부오류코드, 재인증 완료는 /account#reauthProof=일회증명으로 이동한다
- canEmailReauth가 true일 때만 현재 계정 이메일로 재인증을 요청한다. 네이버 이메일은 검증된 주소로 간주하지 않는다
- Google 소셜 재인증은 지원하지 않아 reauthEnabled가 false다. 검증된 계정 이메일이 있으면 이메일 코드로 재인증할 수 있다
- 실제 메일과 제공자 설정이 없으면 기능을 비활성으로 알리고 요청은 거절한다

## 프로젝트와 팀

| 요청 | 본문 또는 쿼리 | 성공 응답 |
| --- | --- | --- |
| GET /v1/projects | q, cursor, limit 선택 | items: Project 배열, nextCursor |
| POST /v1/projects | name, topic 선택, presentationConstraints 선택 | 201 Project |
| GET /v1/projects/{id} | 없음 | Project |
| PATCH /v1/projects/{id} | expectedVersion, name 선택, topic 선택, presentationConstraints 선택 | Project |
| DELETE /v1/projects/{id} | expectedVersion, confirmationName | 204 |
| GET /v1/projects/{id}/members | cursor, limit 선택 | items: Member 배열, nextCursor |
| DELETE /v1/projects/{id}/members/{userId} | expectedMembershipVersion, clientMutationId | clientMutationId, tombstone, membershipVersion, eventId |
| POST /v1/projects/{id}/invitations | rotate | url, expiresAt |
| GET /v1/invitations/{token} | 없음 | projectName, inviterName, expiresAt, alreadyMember |
| POST /v1/invitations/{token}/accept | 없음 | projectId, alreadyMember |
| POST /v1/projects/{id}/ownership | targetUserId, expectedVersion | Project |

- Project는 id, name, topic, presentationConstraints, ownerId, version, memberCount, createdAt, updatedAt을 가진다
- topic과 presentationConstraints는 비어 있으면 null이며 presentationConstraints는 문자열이다
- Member는 userId, name, role, membershipVersion, isOwner를 가진다. role은 owner 또는 member다
- nextCursor는 다음 페이지가 없으면 null이다
- 프로젝트 생성과 팀원 제거는 Idempotency-Key를 사용한다
- tombstone은 type: membership, id: 제거된 userId, deleted: true 객체다
- 프로젝트와 팀 요청은 가입 완료된 활성 계정만 사용할 수 있다
- 기본정보 변경, 삭제, 소유권 이전과 타 팀원 제거는 현재 소유자만 가능하다
- 소유자는 먼저 소유권을 이전하거나 프로젝트를 삭제해야 나가거나 탈퇴할 수 있다
- 초대 생성은 활성 팀원에게 허용한다. 소유자가 팀원을 내보내면 그때의 초대 링크를 무효로 하고, 다음 초대 조회에서 새 링크를 만든다. 내보낸 사람은 이 새 링크로 다시 참여할 수 있고 이전 링크는 `INVITE_INVALID`다
- 권한 없는 프로젝트의 내용은 반환하지 않는다. 참여한 적 없는 사용자는 NOT_FOUND, 제거되거나 나간 사용자는 ACCESS_DENIED다

## 외부 설정

인증 비밀키, 프론트 공개 주소, SMTP와 발신자, 소셜별 클라이언트 설정, 실제 약관 URL과 버전을 환경변수로 받는다
개발과 테스트는 별도 메일 수신 환경을 쓰고 인증 코드를 응답이나 로그로 반환하지 않는다
