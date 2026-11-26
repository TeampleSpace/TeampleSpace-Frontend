# 자료, 원문, 팀 메모, 작업 계약

2단계 구현에서 사용하는 HTTP 계약이다
공통 오류, 헤더, 버전 규칙은 `README.md`를 따르고 형식은 `schemas/stage-2.schema.json`과 `schemas/api.schema.json`에 있다
경로마다 어디까지 구현했는지는 `README.md`의 구현 상태 표에 적는다

## 공통 규칙

- 모든 요청은 가입을 마친 활성 계정의 세션이 필요하다. 쓰기는 `X-CSRF-Token`과 설정한 프론트 Origin이 필요하다
- 자료, 원문, 팀 메모, 작업은 그 자원이 속한 프로젝트의 활성 팀원만 쓸 수 있다. 요청마다 서버가 다시 확인한다
- 참여한 적 없는 프로젝트의 자원과 없는 자원은 `NOT_FOUND`, 나갔거나 제거된 팀원은 `ACCESS_DENIED`다. 다른 프로젝트의 식별자를 넣어도 같은 규칙으로 거절한다
- 팀원이지만 권한이 없는 요청은 `FORBIDDEN`이다
- 삭제한 자료의 상세, 원문, 팀 메모 요청은 `MATERIAL_DELETED`다
- 입력 내용 오류는 `VALIDATION_FAILED`와 `fieldErrors`로 응답한다. 버전 충돌은 `VERSION_CONFLICT`와 `currentVersions`로 응답한다

## 자료

| 요청 | 본문 또는 쿼리 | 성공 응답 |
| --- | --- | --- |
| GET /v1/projects/{projectId}/materials | q, kind, status, cursor, limit 선택 | MaterialList |
| GET /v1/materials/{materialId} | 없음 | Material |
| PATCH /v1/materials/{materialId} | MaterialPatchRequest | Material |
| DELETE /v1/materials/{materialId} | MaterialDeleteRequest | MaterialDeleted |
| GET /v1/materials/{materialId}/source | revisionId 선택 | MaterialSource |
| POST /v1/materials/{materialId}/reprocess | 없음 | 201 MaterialCreated |
| POST /v1/materials/{materialId}/summary-jobs | MaterialSummaryJobRequest | 202 Job |

- 목록은 최근에 추가한 자료부터 나온다. q는 제목 검색어, kind는 file, link, memo, status는 processing, ready, failed다
- `counts`는 검색어에 맞는 자료의 유형별 개수다. 유형과 상태 필터는 반영하지 않는다
- 자료는 작성자 `createdBy`, 출처 `source`, 현재 개정 `currentRevision`을 가진다. 분석이 실패해도 작성자와 출처는 유지된다
- `canDelete`는 요청한 사용자가 소유자이거나 자료 작성자인지를 서버가 판단한 값이다
- 이름과 설명 변경은 개정을 만들지 않고 `version`만 올린다. 이름과 설명은 활성 팀원 누구나 바꿀 수 있다
- 마크다운 자료의 `markdown`을 바꾸면 새 개정이 생기고 `sourceVersion`이 1 오른다. 파일과 링크 자료에 `markdown`을 보내면 `VALIDATION_FAILED`다
- 삭제는 소유자 또는 자료 작성자만 할 수 있다. 그 밖의 팀원은 `FORBIDDEN`이다
- 삭제한 자료는 목록에서 사라지고 개정과 본문은 남는다. 진행 중인 분석과 현재 개정의 요약 작업은 함께 취소한다. 문서의 출처 연결은 지우지 않고 `sourceDeleted`로 표시한다
- 삭제 응답을 받지 못해 다시 보냈을 때 `MATERIAL_DELETED`가 오면 이미 삭제된 것으로 본다
- 자료를 입력으로 고정하는 생성 작업은 이후 단계에서 만든다. 그때 진행 중인 생성 작업이 쓰는 자료의 삭제 충돌 응답을 추가한다

### 자료 상태

| 상태 | 뜻 | 다음 상태 |
| --- | --- | --- |
| processing | 등록했고 분석 작업이 대기 중이거나 실행 중 | ready, failed |
| ready | 현재 개정이 있어 원문을 볼 수 있음 | 삭제 |
| failed | 분석이 실패했거나 취소됨 | 다시 시도하면 processing, 삭제 |

- 마크다운 자료는 등록과 동시에 ready다
- 원문 조회는 ready일 때만 된다. 그 밖의 상태는 `MATERIAL_STATE_CONFLICT`다
- 분석 다시 시도는 failed일 때만 된다. 그 밖의 상태는 `MATERIAL_STATE_CONFLICT`다. 파일을 다시 올리지 않고 보관한 원본으로 새 작업을 만든다

### 원문

- 파일 자료는 `file.url`로 원본 PDF를 받는다. 주소는 5분 동안 유효하고 발급할 때마다 권한을 다시 확인한다
- 주소가 만료되면 원문 조회를 다시 요청해 새 주소를 받는다. 주소는 저장하지 않는다
- 서버가 파일을 직접 내려 줄 때는 원문 주소 요청에서도 세션과 프로젝트 참여 여부를 확인한다. 만료됐거나 잘못된 주소는 `FILE_URL_EXPIRED`다
- `file.pageCount`가 실제 쪽수다. 이전과 다음 이동은 이 값으로 정한다
- 마크다운 자료는 `markdown`, 링크 자료는 `link`의 주소, 제목, 추출 본문을 돌려준다
- `revisionId`를 주면 그 자료의 해당 개정을, 없으면 현재 개정을 돌려준다

### AI 분석 정리

- `featureFlags.materialSummary`가 true일 때 활성 팀원이 직접 요청할 수 있다. 기본값은 비활성이며 이때 새 요청은 `SERVICE_UNAVAILABLE`이다
- `Idempotency-Key`와 `expectedRevisionId`가 필요하다. 같은 키와 본문을 재전송하면 먼저 등록한 작업을 돌려준다. 같은 개정의 새 요청이 이미 처리 중이면 `REQUEST_IN_PROGRESS`다
- 원문 개정이 바뀌었거나 자료가 준비되지 않았거나 현재 개정에 분석 정리가 있으면 `MATERIAL_STATE_CONFLICT`다. 이전 요약 문장만 있고 `analysis`가 null인 개정은 다시 요청할 수 있다. 추출한 본문이 비어 있으면 `VALIDATION_FAILED`다
- `type`과 `targetType`은 `material_summary`, `targetId`는 현재 원문 개정 식별자다. 자료 상세의 `summaryJob`에서 현재 개정의 최신 분석 작업을 확인한다. 경로와 작업 유형 이름은 기존 요약 이름을 유지한다. 작업 상세와 취소에는 기존 작업 API를 사용한다
- 제공자에게 요청한 자료의 제목과 정리한 본문 최대 20000자를 보내고 저장 옵션을 끈다. 원문 분석 작업과 원문 보기는 이 제공자를 호출하지 않는다
- 결과를 반영할 때 요청자의 접근 권한과 현재 개정을 다시 확인한다. 성공하면 그 개정의 `currentRevision.analysis`에 개요, 주요 논점과 근거, 발표 포인트를 채우고 `currentRevision.summary`에는 개요를 함께 넣는다. 결과 참조에 `materialId`와 `revisionId`를 돌려준다. 원문, 발췌, 자료 버전은 그대로 유지한다
- 분석 결과의 `keyPoints`는 `claim`과 `evidence`를 가진다. 원문에서 근거를 찾지 못한 논점의 `evidence`는 빈 문자열이다
- 분석을 실패하거나 취소해도 자료는 ready 상태로 남는다. 메모 본문이 바뀌면 새 개정은 기존 개정의 분석 결과를 사용하지 않는다

### AI 자료 조사

| 요청 | 본문 | 성공 응답 |
| --- | --- | --- |
| POST /v1/projects/{projectId}/research-jobs | MaterialResearchJobRequest | 202 Job |

- `featureFlags.materialResearch`가 true일 때 활성 팀원이 요청할 수 있다. 기본값은 비활성이며 이때 새 요청은 `SERVICE_UNAVAILABLE`이다
- `Idempotency-Key`가 필요하다. 같은 키와 본문을 재전송하면 먼저 등록한 작업을 돌려준다. 주제는 앞뒤 공백을 뺀 1자 이상 200자 이하이고 그 밖에는 `VALIDATION_FAILED`다
- 사용자마다 한 시간에 20번까지 요청할 수 있다. 넘으면 `RATE_LIMITED`와 `Retry-After`다
- `type`은 `material_research`, `targetType`은 `project`, `targetId`는 프로젝트 식별자다. 작업 상세와 취소에는 기존 작업 API를 사용한다
- 제공자에게 주제만 보내고 웹 검색 도구를 켠다. 저장 옵션은 끈다. 프로젝트 자료는 보내지 않는다
- 성공하면 `resultRef`에 `MaterialResearchResult`가 담긴다. 출처는 검색 도구가 실제로 연 주소와 인용 주소에 있는 것만 남기고, 하나도 없으면 `JOB_RESEARCH_INVALID_RESULT`로 끝난다
- 조사 결과는 자료로 저장하지 않는다. 팀원이 확인한 뒤 메모 자료 추가 경로로 저장한다. 실행과 반영 전에 요청자의 접근 권한을 다시 확인한다

## PDF 추가

| 단계 | 요청 | 본문 | 성공 응답 |
| --- | --- | --- | --- |
| 업로드 준비 | POST /v1/projects/{projectId}/uploads | UploadRequest | 201 UploadTicket |
| 파일 전송 | PUT uploadUrl | 파일 바이트 | 204 |
| 자료 등록 | POST /v1/projects/{projectId}/materials/file | FileMaterialRequest | 201 MaterialCreated |
| 분석 | GET /v1/jobs/{jobId} | 없음 | Job |

- 업로드 준비는 형식과 크기를 기능 지원 정보의 `uploadTypes`로 검사한다. 맞지 않으면 `UPLOAD_TYPE_NOT_ALLOWED`, `UPLOAD_TOO_LARGE`다
- 전송 주소는 10분 동안 유효하다. 전송 요청에는 `uploadHeaders`만 싣고 CSRF 헤더는 싣지 않는다
- 등록 전에는 같은 전송 주소로 파일을 다시 보낼 수 있다. 등록한 뒤의 전송은 거절한다
- 자료 등록은 준비한 사용자와 프로젝트가 같은지 확인하고 실제 크기, 체크섬, PDF 형식을 검사한다. 통과한 파일만 바뀌지 않는 원본으로 보관한다
- 검사를 통과하지 못하면 `UPLOAD_REJECTED`이고 그 업로드는 다시 쓸 수 없다. 전송이 끝나지 않았으면 `UPLOAD_INCOMPLETE`, 준비가 만료됐으면 `UPLOAD_EXPIRED`, 이미 등록했으면 `UPLOAD_ALREADY_USED`다
- 자료 등록은 `Idempotency-Key`가 필수다. 응답을 받지 못했으면 같은 키와 본문으로 다시 보낸다. 자료와 작업은 한 번만 만들어진다
- 업로드 준비와 파일 전송의 실패는 업로드 실패, 등록 뒤 작업의 실패는 분석 실패다. 분석 실패는 `POST /v1/materials/{materialId}/reprocess`로 다시 시도한다

## 링크와 마크다운 자료

| 요청 | 본문 | 성공 응답 |
| --- | --- | --- |
| POST /v1/projects/{projectId}/materials/link | LinkMaterialRequest | 201 MaterialCreated |
| POST /v1/projects/{projectId}/materials/memo | MemoMaterialRequest | 201 MaterialCreated |

- 두 요청 모두 `Idempotency-Key`가 필수다. 분석 다시 시도도 같다
- 링크는 http와 https 주소만 받는다. 계정 정보가 든 주소, 내부망과 로컬 주소는 `INVALID_URL`이다
- 수집할 때 이름 풀이 결과와 이동할 때마다의 주소를 다시 검사한다. 이때 막힌 주소는 작업의 `LINK_BLOCKED`로 전달한다
- 수집은 응답 15초, 본문 2MB, 이동 3번, 80과 443 포트로 제한한다
- 링크 제목을 비우면 주소의 호스트를 임시 제목으로 쓰고 수집에 성공하면 문서 제목으로 바꾼다. 그 사이 사용자가 이름을 바꿨으면 바꾸지 않는다
- 수집에 실패해도 자료의 주소와 설명은 `source.url`과 `description`에 남는다
- 마크다운 자료는 작업 없이 첫 개정을 만든다. 응답의 `job`은 null이다
- 제목은 255자, 설명은 2000자, 마크다운 본문은 100000자, 주소는 2048자까지다

## 팀 메모

| 요청 | 본문 | 성공 응답 |
| --- | --- | --- |
| GET /v1/materials/{materialId}/note | 없음 | MaterialNote |
| PUT /v1/materials/{materialId}/note | MaterialNotePutRequest | MaterialNoteSaveResponse |

- 팀 메모는 자료마다 하나이며 원문인 마크다운 자료와 다른 자원이다. 팀 메모를 저장해도 자료의 `version`과 개정은 바뀌지 않는다
- 아직 쓰지 않은 메모는 `version` 0과 빈 본문이다. 처음 저장할 때 `expectedVersion`은 0이다
- `expectedVersion`이 현재 버전과 다르면 `VERSION_CONFLICT`와 `currentVersions.noteVersion`을 돌려준다. 서버는 덮어쓰지 않는다
- 저장 응답을 받지 못했으면 메모를 다시 읽어 내 입력과 같은지 비교한다. 같으면 저장된 것으로 본다
- 본문은 20000자까지다

## 댓글

| 요청 | 본문 또는 쿼리 | 성공 응답 |
| --- | --- | --- |
| GET /v1/materials/{materialId}/comments | cursor, limit 선택 | MaterialCommentList |
| POST /v1/materials/{materialId}/comments | MaterialCommentRequest | 201 MaterialComment |
| DELETE /v1/materials/{materialId}/comments/{commentId} | 없음 | MaterialCommentDeleted |

- 팀원이 자료에 짧은 글을 남긴다. 화면의 팀 메모를 댓글 방식으로 바꾸며 쓴다. 기존 팀 메모 API와 본문은 그대로 남는다
- 목록은 오래된 댓글부터 나온다. limit은 기본 50, 최대 100이다. cursor는 앞 페이지 마지막 댓글의 식별자이고, 형식이 틀리거나 이 자료의 댓글이 아니면 `INVALID_CURSOR`다
- 작성은 `Idempotency-Key`가 필수다. 본문은 앞뒤 공백을 걷어 1자에서 2000자다
- 작성자만 지울 수 있고 다른 사람은 `FORBIDDEN`, 없는 댓글은 `NOT_FOUND`다. 이미 지운 댓글을 다시 지우면 같은 결과를 돌려준다
- 권한과 삭제한 자료의 오류는 자료 규칙과 같다

## 작업

| 요청 | 본문 또는 쿼리 | 성공 응답 |
| --- | --- | --- |
| GET /v1/jobs/{jobId} | 없음 | Job |
| POST /v1/jobs/{jobId}/cancel | 없음 | Job |
| GET /v1/projects/{projectId}/jobs | type, status, targetType, targetId, cursor, limit 선택 | JobList |

- 자료 분석 작업의 `type`은 `material_analysis`, `targetType`은 `material`, `targetId`는 자료 식별자다
- `inputVersions.materialVersion`은 작업을 만들 때의 자료 버전이다. 성공하면 `resultRef`에 `materialId`와 `revisionId`가 온다
- 실패하면 `error`에 `code`, `message`, `retryable`이 온다. 코드는 `error-codes.json`에서 HTTP 상태가 없는 항목이다
- 목록의 `status`는 쉼표로 여러 값을 줄 수 있다. 최근에 만든 작업부터 나온다
- 취소는 작업을 요청한 사람과 프로젝트 소유자만 할 수 있다. 그 밖의 팀원은 `FORBIDDEN`이다
- 화면을 닫는 것은 취소가 아니다. 취소는 이 요청으로만 한다

### 작업 상태

| 상태 | 뜻 | 다음 상태 |
| --- | --- | --- |
| queued | 실행을 기다림 | running, canceled |
| running | 실행자가 임대를 잡고 처리 중 | succeeded, failed, canceled, 내부 재시도 때 queued |
| succeeded, failed, canceled | 끝남 | 바뀌지 않음 |

- 대기 중인 작업을 취소하면 바로 canceled가 된다
- 실행 중인 작업을 취소하면 `cancelRequestedAt`이 기록되고 실행자가 확인한 뒤 canceled가 된다. 그동안 상태는 running이다
- 취소와 완료가 겹치면 먼저 확정된 쪽이 남는다. 취소가 확정된 작업의 결과는 반영하지 않는다
- 끝난 작업을 취소하면 오류 없이 지금 상태를 돌려준다
- 실행자가 멈춰 임대가 만료되면 같은 작업이 queued로 돌아가고 `attempt`가 오른다. 기본 3번까지 시도하고 넘으면 `JOB_ATTEMPTS_EXHAUSTED`로 실패한다
- 임대를 잃은 실행자의 늦은 결과는 반영하지 않는다
- 사용자가 다시 시도하면 새 작업이 만들어진다

## 이벤트

이벤트 기록은 지금 단계부터 남기고 구독 HTTP 연결은 편집 단계에서 연다. 그 전에는 화면이 작업과 자료를 다시 조회해 상태를 확인한다

| 종류 | 기록하는 때 | payload |
| --- | --- | --- |
| material.updated | 등록, 이름과 본문 변경, 분석 상태 변경 | materialId, materialVersion, status |
| material.deleted | 삭제 | materialId, materialVersion |
| material.note.updated | 팀 메모 저장 | materialId, noteVersion |
| material.comment.created | 댓글 작성 | materialId, commentId |
| material.comment.deleted | 댓글 삭제 | materialId, commentId |
| job.updated | 작업 등록, 취소 요청, 종료 | jobId, type, status, targetType, targetId |

## 구현에서 정한 것

설계서에 없어 구현하며 정한 항목이다

| 항목 | 기준 | 이유 |
| --- | --- | --- |
| 자료의 등록 원본 | 자료가 올린 파일과 입력한 주소를 직접 가진다 | 개정은 분석이 성공해야 생기므로 분석 전과 실패 뒤에도 출처를 보여 주고 다시 시도하려면 자료에 있어야 한다 |
| 개정의 요약과 발췌 | 개정에 요약과 발췌를 저장한다 | 자료 상세가 분석 결과를 다시 조회할 때 쓴다 |
| 실행 중으로 바뀌는 이벤트 | 기록하지 않는다 | 선점은 작업 행만 잠그는 짧은 트랜잭션이라 프로젝트 이벤트 순번을 함께 올리지 않는다. 실행 중 여부는 작업 조회로 확인한다 |
| 원문 주소의 권한 확인 | 서버가 파일을 직접 내려 주는 동안은 요청마다 세션과 참여 여부를 확인한다 | 팀원 제거 뒤 남은 주소로 받을 수 없게 한다. 외부 저장소로 바꾸면 주소 만료 시간까지는 쓸 수 있다 |

## 외부 설정과 남은 결정

| 항목 | 지금 상태 |
| --- | --- |
| 파일 저장소 | 제공자가 정해지지 않아 서버의 지정 폴더에 보관하고 서버가 서명한 주소로 주고받는다. 저장 위치는 환경변수로 바꾼다 |
| 요약 모델 | `MATERIAL_SUMMARY_AI_ENABLED`, `MATERIAL_SUMMARY_AI_MODEL`, `OPENAI_API_KEY`를 구성한다. 요약 요청이 완료되기 전에는 `summary`가 null이다 |
| PDF 크기 제한 | 20MB는 검증용 기본값이다. 환경변수로 바꾸고 기능 지원 정보로 알린다 |
| 파일 검사 | 크기, 체크섬, PDF 형식만 검사한다. 악성 파일 검사와 파서 격리 실행은 운영 구성을 정할 때 추가한다 |
