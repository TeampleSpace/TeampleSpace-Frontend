# 계약 변경 기록

계약이 바뀐 내용을 최근 것부터 적는다. 프론트엔드는 다시 복사할 때 자기가 복사했던 지점 이후의 항목을 본다.
각 항목의 제목 아래에 그 변경이 머지된 main의 커밋을 적는다. 복사할 때 그 커밋을 프론트엔드의 계약 기록에 적는다.

지금의 기준 커밋은 `1784978`이다. 스키마, 예제, 오류 목록이 마지막으로 바뀐 커밋이다.

## 2026-11-26 프로젝트 탭 접속 현황 추가

- 보는 탭 경로 `PUT /v1/projects/{projectId}/viewing`과 `ViewingRequest`, `ProjectTab`, `ViewersUpdated` 형식을 추가. 창마다 다른 `viewId`를 실으면 떠남은 마지막으로 알린 창의 것만 반영하고, 창마다 늘리는 `seq`를 실으면 늦게 도착한 이전 알림은 버린다
- 이벤트 구독은 나를 뺀 팀원의 탭 목록이 바뀔 때 `viewers.updated`를 SSE `id` 없이 보낸다. 이벤트 순번과 재연결 커서에는 영향이 없다

## 2026-11-26 발표 생성 문구 규칙 보완

- 발표 생성 고정 입력의 `promptVersion`을 `presentation-v5`로 바꿨다. 이전 값으로 등록된 작업은 실행할 때 `JOB_INPUT_STALE`로 끝난다
- 생성한 글에서 이모지와 장식 기호를 지우고 공백을 정리한 뒤 길이를 검사한다

## 2026-11-26 기존 구성에 새 자료 반영

- `OutlineJobRequest`와 `OutlineJobInput`에 선택 값 `mode`(`replace`, `extend`)를 추가했다. 값이 없으면 지금처럼 구성 전체를 바꾼다
- `extend`는 기존 항목을 그대로 두고 새 항목과 근거만 더한다. 저장된 구성이 없으면 422다

## 2026-11-26 자료 AI 요약을 분석 정리로 확장

- 자료 상세의 `currentRevision`에 `analysis`를 추가했다. 개요 `overview`, 주요 논점과 근거 `keyPoints`, 발표 포인트 `presentationPoints`를 담고 분석 전에는 null이다
- `summary`에는 분석의 개요를 함께 넣는다. 이전에 만든 요약만 있고 `analysis`가 null인 개정은 분석을 다시 요청할 수 있다
- 요약 작업의 고정 입력 `promptVersion`을 `material-analysis-v1`로 바꿨다. 이전 값으로 등록된 작업은 실행할 때 `JOB_INPUT_STALE`로 끝난다

## 2026-11-26 발표 생성 결과 검증 실패의 재시도

- `JOB_PRESENTATION_INVALID_RESULT`의 `retryable`을 true로 바꿨다. 결과가 맞지 않으면 남은 시도 횟수 안에서 다시 생성하고, 시도를 다 쓴 뒤에도 사용자가 다시 요청할 수 있다
- 핵심 문장과 수치가 길이를 넘으면 작업을 실패시키지 않고 빈 값으로 둔다

## 2026-11-26 구성 항목마다 여러 장의 본문 생성

- 발표 생성 고정 입력의 `promptVersion`을 `presentation-v4`로 바꿨다. 이전 값으로 등록된 작업은 실행할 때 `JOB_INPUT_STALE`로 끝난다
- 생성한 발표의 본문 슬라이드 수가 구성 항목 수보다 많을 수 있다. 한 항목의 본문이 여러 장이면 같은 항목 번호와 출처를 쓰고, 목차는 구성 항목 수만큼 나온다

## 2026-11-25 템플릿 미리보기 슬라이드 조회 추가

- `GET /v1/templates/{templateId}/preview` 경로와 `TemplatePreview`, `TemplatePreviewSlide`, `TemplatePreviewElement` 형식을 추가
- 예시 발표를 발표 생성과 같은 배치와 테마 규칙으로 그린다. 요소에는 식별자와 버전이 없다

## 2026-11-24 발표 디자인 여덟 가지의 본문 배치

- 발표 생성 고정 입력의 `promptVersion`을 `presentation-v3`로 바꿨다. 이전 값으로 등록된 작업은 실행할 때 `JOB_INPUT_STALE`로 끝난다
- 텍스트 요소의 `fontFamily`에 `Gmarket Sans TTF`가 올 수 있다. 화면은 이 이름으로 등록한 글꼴로 그린다

## 2026-11-24 생성 발표 자료의 배치 개선

- 발표 생성 고정 입력의 `promptVersion`을 `presentation-v2`로 바꿨다. 이전 값으로 등록된 작업은 실행할 때 `JOB_INPUT_STALE`로 끝난다
- 생성한 슬라이드에 목차와 본문 배치별 `layoutId`(`agenda`, `cards`, `list`, `process`, `compare`, `statement`)가 생겼다. 제목 텍스트에는 줄바꿈 문자가 들어갈 수 있다

## 2026-11-24 문장 요청으로 슬라이드 글을 고치는 AI 수정 추가

- 수정 작업 등록 `POST /v1/slides/{slideId}/ai-revision-jobs`와 적용 `POST /v1/ai-proposals/{proposalId}/apply` 경로, `SlideRevisionRequest`, `SlideRevisionResult`, `SlideRevisionApplied` 형식을 추가
- 작업 종류는 `slide_revision`, 대상은 `slide`다. 제안은 작업의 `resultRef`에 담기고 제안 식별자는 작업 식별자다
- 적용은 대상마다 요소 수정과 같은 `element.updated` 이벤트와 변경 이력을 남긴다
- `featureFlags.aiRevision`이 발표 생성 제공자 설정을 따른다
- 작업 실패 코드 `JOB_REVISION_PROVIDER_UNAVAILABLE`, `JOB_REVISION_INVALID_RESULT`, `JOB_REVISION_NO_CHANGE`, `JOB_REVISION_ACCESS_REVOKED`를 추가

## 2026-11-23 편집 화면 커서 위치 공유 추가

- 커서 위치 경로 `POST /v1/projects/{projectId}/presence`와 `PresenceUpdateRequest`, `PresenceUpdated` 형식을 추가
- 이벤트 구독은 나를 뺀 팀원의 커서 목록이 바뀔 때 `presence.updated`를 SSE `id` 없이 보낸다. 이벤트 순번과 재연결 커서에는 영향이 없다

## 2026-11-23 AI 작업과 디자인 변경 승인 요청 추가

- 승인 요청 만들기, 목록, 승인, 거절, 취소 경로와 `ChangeRequest`, `ChangeRequestList`, `ChangeRequestCreate` 형식, 오류 코드 `REQUEST_NOT_PENDING`을 추가
- 요청과 처리 결과를 `request.created`, `request.updated` 이벤트로 보낸다

## 2026-11-23 자료 댓글 추가

- 자료 댓글 목록, 작성, 삭제 경로와 `MaterialComment`, `MaterialCommentList`, `MaterialCommentRequest`, `MaterialCommentDeleted` 형식을 추가
- 댓글 작성과 삭제는 `material.comment.created`, `material.comment.deleted` 이벤트를 보낸다. 받은 화면은 댓글 목록을 다시 읽는다

## 2026-11-23 팀원을 내보내면 초대 링크 무효화

- 소유자가 팀원을 내보내면 활성 초대 링크를 무효로 한다. 다음 초대 조회는 새 링크를 돌려주고, 내보낸 사람은 새 링크로 다시 참여할 수 있다. 스키마와 예제는 바뀌지 않았다

## 2026-11-22 첫 발표 자료 생성 작업 추가

- 발표 자료 생성 작업 등록과 고정 입력, 결과 참조 형식, `featureFlags.presentationGeneration`을 추가
- 작업 실패 코드 `JOB_PRESENTATION_PROVIDER_UNAVAILABLE`, `JOB_PRESENTATION_INVALID_RESULT`, `JOB_PRESENTATION_ACCESS_REVOKED`를 추가
- 성공하면 `presentation.replaced` 이벤트를 보낸다. 받은 화면은 동기화 스냅샷을 다시 읽는다
- 직접 입력에서 고른 프로젝트 글꼴은 텍스트 `fontFamily`에 `ProjectFont-{fontAssetId}`로 적는다

## 2026-11-21 슬라이드와 요소의 추가, 삭제, 순서 변경 추가

- `SlideCreateRequest`, `SlideDeleteRequest`, `SlideOrderRequest`, `ElementCreateRequest`, `ElementDeleteRequest`와 예제를 추가
- `DocumentChange`에 바뀐 뒤의 전체 슬라이드 순서 `slideIds`를 추가. 순서만 바꾼 응답과 이벤트는 `resource`와 `tombstone` 없이 `slideIds`만 싣는다. `resource`와 `tombstone`을 함께 싣는 것은 여전히 받지 않는다
- 요소 추가는 `element.updated`로 전달하고 새 슬라이드와 새 요소의 식별자는 클라이언트가 만든다

## 2026-11-20 편집 경로의 HTTP 공개

- 요소 수정, 동기화 스냅샷, 이벤트 구독을 HTTP 경로로 열었다. 스키마와 예제는 바뀌지 않았다
- 동기화 스냅샷은 `scope=editor`만 받고 그 밖의 값은 `VALIDATION_FAILED`로 거절한다
- 이벤트 구독은 `Last-Event-ID`가 없으면 연결한 뒤의 이벤트만 보낸다
- 세 경로 모두 참여한 적 없는 사용자는 `NOT_FOUND`, 나갔거나 제거된 팀원은 `ACCESS_DENIED`다
- 요소 수정은 요소 종류에 맞지 않는 내용과 스타일을 `VALIDATION_FAILED`로 거절한다. 이미지의 `fileObjectId`는 아직 바꿀 수 없다

## 2026-11-20 자료의 AI 요약 요청 추가

- 원문 개정별 요약 요청과 작업 조회, `featureFlags.materialSummary`를 추가
- 자료 상세의 요약 작업은 `summaryJob`에 표시하며 기존 `job`은 PDF와 링크 원문 분석을 계속 나타낸다

## 2026-11-20 발표 구성 생성 작업과 입력 고정

- 구성 생성 작업 등록과 고정 입력, 후속 PPT 생성 입력 형식을 추가

## 2026-11-20 발표 템플릿과 디자인 설정 추가

- 템플릿 공개 개정과 디자인 조회 및 버전 비교 저장 형식을 추가

## 2026-11-20 발표 항목 근거 교체 추가

- 한 항목의 근거 집합만 교체하는 요청과 원문 개정 조회 계약을 추가

## 2026-11-20 발표 구성 조회 및 저장 추가

- `stage-3.schema.json`에 발표 구성 조회와 전체 교체 저장의 형식 및 예제를 추가
- 공통 `currentVersions.outlineVersion`과 자료 개정 참조 형식을 재사용
- [발표 구성 계약](stage-3.md)에 버전, 항목 순서, 근거 고정, 권한과 멱등 재시도 기준을 수록

## 2026-11-19 자료와 작업 처리 계약 추가

자료 기능 구현에 앞서 정리한 계약이다. 경로별 구현 상태는 `README.md`의 표를 본다.
프론트엔드가 검토 중인 계약을 가져오면 실제로 복사한 기능 브랜치 커밋을 기록한다.

스키마

- `stage-2.schema.json` 추가. 자료 목록과 상세, 개정, 출처, 업로드 준비, 자료 등록과 수정, 삭제, 원문 형식이다
- 원문 형식은 유형에 맞는 항목만 값을 갖도록 검사한다. 파일 자료는 `file`, 마크다운 자료는 `markdown`, 링크 자료는 `link`다
- 자료 형식은 ready일 때 현재 개정을 필수로 검사한다. 파일 자료는 파일 출처와 작업, 링크 자료는 주소와 작업을 갖고 마크다운 자료는 작업이 없다
- 등록 응답의 최상위 `job`도 자료 유형에 맞게 검사한다. 마크다운 자료는 null, 파일과 링크 자료는 작업 객체다
- 마크다운 자료는 목록과 상세에서 항상 ready다. 쪽수는 파일 자료의 현재 개정이 있을 때만 있고 출처 항목은 유형에 맞는 것만 값이 있다
- `MaterialNote`에 필수 항목 `updatedByName` 추가. 본문은 20000자까지다
- `CurrentVersions`에 `noteVersion` 추가

오류 코드

- 추가: `MATERIAL_DELETED` 410, `MATERIAL_STATE_CONFLICT` 409, `UPLOAD_TYPE_NOT_ALLOWED` 415, `UPLOAD_TOO_LARGE` 413, `UPLOAD_EXPIRED` 410, `UPLOAD_INCOMPLETE` 409, `UPLOAD_REJECTED` 422, `UPLOAD_ALREADY_USED` 409, `INVALID_URL` 422, `FILE_URL_EXPIRED` 403
- 작업의 `error.code`로만 전달하는 코드 추가: `ANALYSIS_FAILED`, `MATERIAL_UNREADABLE`, `LINK_FETCH_FAILED`, `LINK_BLOCKED`, `LINK_UNSUPPORTED_CONTENT`, `LINK_TOO_LARGE`, `JOB_ATTEMPTS_EXHAUSTED`, `JOB_TARGET_GONE`

예제

- 자료, 목록, 업로드, 등록과 수정 요청, 삭제 응답, 원문, 자료 분석 작업, 새 오류 예제 추가
- 기능 지원 정보 예제의 `configVersion`을 `stage-2`로, `uploadTypes`를 PDF 20MB로 바꿨다

문서

- `stage-2.md` 추가. 경로, 권한, 자료와 작업의 상태 전이, 이벤트, 외부 설정이 없어 남은 항목을 적었다
- 작업 종류 이름을 `material_analysis`로 정했다

프론트엔드가 확인할 것

- 팀 메모 응답에 `updatedByName`이 늘었다. 형식 검사에 추가한다
- 자료 등록, 링크와 마크다운 자료 등록, 분석 다시 시도는 `Idempotency-Key`가 필수다
- 파일 전송 요청에는 `uploadHeaders`만 싣는다. CSRF 헤더를 싣지 않는다
- 원문 주소는 저장하지 않고 만료되면 원문 조회를 다시 요청한다
- 요약 모델이 연결되지 않아 `summary`는 null로 온다. null이면 요약 영역을 숨긴다
- 작업과 자료의 상태 변화는 이벤트 구독이 열리기 전까지 다시 조회해 확인한다

## 2026-11-18 인증과 프로젝트 계약 추가

인증과 프로젝트 기능 PR에서 검토 중인 계약이다. 아직 main에 머지되지 않았다.
프론트엔드가 검토 중인 계약을 가져오면 실제로 복사한 기능 브랜치 커밋을 기록한다.

- 인증, 사용자, 가입 동의와 계정 삭제 요청 및 응답 형식 추가
- 제공자별 로그인과 재인증 지원 상태, 검증된 계정 이메일 재인증 가능 여부 추가
- 프로젝트 생성과 목록, 설정과 삭제, 팀원 목록과 제거, 소유권 이전, 초대 발급과 수락 형식 추가
- 프로젝트와 팀원은 커서 기반 페이지를 반환하며 마지막 페이지의 nextCursor는 null
- 프로젝트 생성과 팀원 제거는 멱등키로 결과를 재사용
- 소유자만 관리 작업을 수행하고 제거된 팀원은 회전 전 초대를 다시 사용할 수 없음
- 초대는 7일 동안 유효하며 회전 또는 프로젝트 삭제 시 기존 링크 무효화
- 계약 예제와 오류 코드 목록 추가

## 2026-11-18 공통 계약 기준 정리

main의 `1784978`이다.

스키마

- 문서 버전을 올리는 이벤트는 `presentationVersion`과 `generation`이 필수다. 요소 수정과 삭제, 슬라이드 추가와 삭제, 순서 변경, 전체 교체 이벤트가 해당한다
- 변경 묶음 이벤트는 `resourceId`가 필수이고 `payload`가 `ChangeGroupPayload` 형식이다
- `ChangeGroupPayload` 정의 추가

예제

- 추가: `error-bad-request.json`, `error-internal-error.json`
- 거절 예제 추가: `invalid/event-element-updated-without-version.json`, `invalid/event-change-created-without-state.json`

문서

- 합의가 필요한 항목이라는 한 목록을 기준으로 정한 기술 선택, 사용자 결정이 필요한 항목, 이후 단계에서 정할 항목으로 나눴다
- 요청 헤더 `X-CSRF-Token`을 기준으로 적었다
- 이벤트 식별자는 같은지만 비교하고, 빠진 변경은 `presentationVersion`이 2 이상 건너뛰는 것으로 알아챈다고 적었다
- 다시 연결할 때의 순서를 상황별로 적었다
- 편집 묶음을 누가 닫는지 경우별로 적었다. 시간 기준은 서버가 판단한다
- 버전 충돌 때 최신 내용은 이벤트나 동기화 스냅샷에서 얻는다고 적었다
- 형식을 정한 경로마다 구현 상태와 HTTP 경로를 여는 단계를 적었다

프론트엔드가 확인할 것

- `X-CSRF-Token`을 미확정 표시에서 기준으로 바꾼다
- 이벤트 형식에 필수 항목이 늘었다. 프론트엔드의 이벤트 형식과 모킹 서버가 문서 변경 이벤트에 `presentationVersion`과 `generation`을, 변경 묶음 이벤트에 `resourceId`를 싣는지 확인한다
- 시간 때문에 보내는 닫는 요청은 없어도 된다. 보낼 때 `EDIT_GROUP_CLOSED`가 오면 이미 닫힌 것으로 본다
- 계약 기록의 아직 합의되지 않은 항목 표를 이 문서의 세 구분에 맞춰 정리한다
- 한글 줄바꿈은 정해지지 않았다. 편집 화면은 글자 단위, PDF와 PowerPoint는 낱말 단위다

## 2026-11-18 요청 오류 공통 응답 처리

main의 `8589613`이다.

- 오류 코드 추가: `BAD_REQUEST` 400, `METHOD_NOT_ALLOWED` 405, `NOT_ACCEPTABLE` 406, `UNSUPPORTED_MEDIA_TYPE` 415
- 프레임워크가 거절한 요청도 `ErrorResponse` 형식으로 온다. HTTP 상태는 원래대로다
- `error-codes.json`의 `decided` 항목을 `basis`로 바꿨다. 값은 설계 또는 기술 선택이다

프론트엔드가 확인할 것

- 오류 본문을 읽지 못해 전송 오류로 처리하던 400, 405, 415 응답이 이제 공통 오류로 읽힌다
- `error-codes.json`의 `decided`를 읽는 코드가 있으면 `basis`로 바꾼다

## 2026-11-18 요청 식별자와 공통 오류 응답

main의 `fde772b`다.

- 응답 헤더 `X-Request-Id` 추가. 오류 본문의 `requestId`와 같은 값이다
- 오류 코드 추가: `INTERNAL_ERROR` 500

## 2026-11-18 PPTX와 PDF 출력 실험

main의 `99b547b`다.

- 문서에 한글 줄바꿈 항목을 더했다. 스키마와 예제는 바뀌지 않았다

## 2026-11-18 변경 이력 묶음과 이벤트 복구 검증

프론트엔드가 처음 복사한 지점이다. main의 `fb919ee`다.

## 인증과 계정 HTTP 경로 추가

- 세션 초기 정보와 기능 지원 정보를 실제 HTTP로 제공한다
- 기능 지원 정보의 필수 필드 authProviders에 제공자별 로그인과 재인증 지원 상태를 포함한다
- stage-1.schema.json에 사용자, 이메일 인증, 가입 동의, 재인증과 탈퇴 요청 응답을 추가했다
- bootstrap의 displayName과 사용자 상세의 name은 각각 기존 형식을 유지한다
- 세션 교체 뒤 bootstrap을 다시 읽어 CSRF 토큰을 갱신한다
- 운영 메일, 소셜 제공자, 약관 설정은 비어 있으면 해당 기능을 닫는다
