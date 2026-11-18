# 공통 계약

프론트엔드와 백엔드가 함께 쓰는 요청, 응답, 문서 형식이다.
형식을 맞추기 위한 초안이며 실제 API는 각 기능을 개발하는 단계에서 구현한다.

## 구성

| 경로 | 내용 |
| --- | --- |
| `schemas/document.schema.json` | 발표 문서, 슬라이드, 요소, 출처 연결 형식. schemaVersion 1 |
| `schemas/api.schema.json` | 오류, 요소 수정 요청과 응답, 이벤트, 작업, 기능 지원 정보, 세션 초기 정보, 동기화 스냅샷 |
| `error-codes.json` | 오류 코드와 HTTP 상태 |
| `examples/` | 형식별 예제 |
| `examples/invalid/` | 스키마가 거절해야 하는 예제 |
| `examples/manifest.json` | 예제와 스키마의 짝, 통과 여부 기대값 |
| `examples/assets/` | 예제 문서가 참조하는 이미지. 파일 이름이 fileObjectId다 |

`examples/presentation.json`이 편집기 실험과 파일 출력 실험이 함께 쓰는 문서 예제다.
한글, 긴 문장, 줄바꿈, 도형, 이미지, 회전, 출처 연결이 들어 있다.

## 프론트에서 쓰는 방법

`contracts` 폴더를 그대로 복사해 사용한다. 복사한 커밋을 기록해 두고 계약이 바뀌면 다시 복사한다.

검증은 ajv 8의 2020 판으로 확인했다.

```ts
import Ajv2020 from "ajv/dist/2020";
import documentSchema from "./contracts/schemas/document.schema.json";
import apiSchema from "./contracts/schemas/api.schema.json";

const ajv = new Ajv2020({ schemas: [documentSchema, apiSchema] });

const validatePresentation = ajv.getSchema("document.schema.json");
const validateError = ajv.getSchema("api.schema.json#/$defs/ErrorResponse");
```

`manifest.json`의 각 항목을 돌며 `schema`로 검증한 결과가 `valid`와 같은지 확인하면 백엔드 테스트와 같은 검사가 된다.
예제 파일은 화면 테스트 데이터로 그대로 쓸 수 있다.

## 공통 규칙

- 공개 경로는 `/v1`로 시작한다
- 식별자는 소문자 UUID 문자열, 시간은 UTC ISO 8601, 좌표는 캔버스 단위다
- 버전은 1부터 시작하는 정수이고 JavaScript 안전 정수 범위 안에 있다
- 이벤트 순번은 십진 문자열로 주고받으며 클라이언트는 해석하지 않는다

### 버전 범위

서로 다른 범위의 버전은 비교하지 않는다.

| 이름 | 범위 | 증가 조건 |
| --- | --- | --- |
| `userVersion` | 프로필, 계정 연결 상태 | 프로필, 로그인 수단 변경 |
| `projectVersion` | 이름, 주제, 소유권, 삭제 상태 | 해당 정보 변경 |
| `membershipVersion` | 한 사용자와 프로젝트의 관계 | 참여, 퇴장, 소유권 변경 |
| `materialVersion` | 자료 정보와 처리 상태 | 제목, 설명, 현재 원문, 분석 상태 변경 |
| `outlineVersion` | 발표 구성 전체 | 항목, 순서, 근거 변경 |
| `designVersion` | 디자인 설정 | 디자인 저장 |
| `generation` | 전체 생성 세대 | 전체 생성 결과 게시 |
| `presentationVersion` | 문서 내용 전체 | 요소, 슬라이드, 순서 변경. 승인과 댓글은 제외 |
| `orderVersion` | 슬라이드 목록과 순서 | 추가, 삭제, 순서 변경 |
| `slideVersion` | 슬라이드 내용 | 그 안의 요소 변경 포함 |
| `elementVersion` | 요소 하나 | 요소 수정, 삭제 |

### 헤더

| 헤더 | 용도 |
| --- | --- |
| `Idempotency-Key` | 문서를 바꾸는 모든 요청에 필수. 재시도할 때 같은 값을 다시 보낸다 |
| `Retry-After` | 429, 다시 시도할 수 있는 503, `REQUEST_IN_PROGRESS` 응답에 초 단위로 온다 |
| `Last-Event-ID` | 이벤트 구독을 다시 연결할 때 마지막으로 받은 eventId를 보낸다 |
| `X-Request-Id` | 모든 응답에 서버가 만든 요청 식별자가 온다. 오류 본문의 `requestId`와 같은 값이다 |

## 문서 형식

편집기, 최초 생성 결과, 파일 출력이 같은 형식을 쓴다.

- 발표 문서는 `slideIds`로 순서를, `slides`로 내용을 가진다. 슬라이드도 `elementIds`와 `elements`를 가진다
- 요소 종류는 `text`, `shape`, `image`이고 종류에 따라 `content`와 `style`이 정해진다
- 이미지는 `fileObjectId`로만 참조한다. 임의 외부 URL은 넣을 수 없다
- `assetUrl`은 읽기 응답에만 붙는 임시 주소이고 저장하지 않는다
- 출처 연결은 자료, 개정, 개정 번호를 고정한다. 자료가 지워지면 `sourceDeleted`로 표시한다

스키마로 표현하지 못하는 조건은 서버가 따로 검사한다.

- `slideIds`와 `slides`, `elementIds`와 `elements`의 식별자와 순서가 같다
- 슬라이드의 `presentationId`, `generation`이 문서와 같고 요소의 `slideId`가 슬라이드와 같다
- 좌표와 크기는 소수 넷째 자리까지 저장한다

## 요소 수정과 재시도

요청은 `ElementPatchRequest`, 성공 응답은 `MutationResponse`다.

서버는 아래 순서로 처리한다.

1. 인증과 프로젝트 참여 여부를 확인한다
2. 같은 멱등키의 기존 결과를 버전 검사보다 먼저 찾는다. 같은 키와 같은 본문이면 처음과 같은 상태 코드와 응답을 돌려준다
3. 같은 키인데 본문이 다르면 `IDEMPOTENCY_KEY_REUSED`, 같은 키를 처리하는 중이면 `REQUEST_IN_PROGRESS`와 `Retry-After`를 돌려준다
4. 새 요청일 때만 `generation`과 `baseVersion`을 검사하고 문서 변경, 이벤트, 멱등 결과를 한 트랜잭션으로 저장한다

클라이언트 규칙은 다음과 같다.

- 응답을 받지 못했으면 멱등키, `clientMutationId`, 본문 전체를 그대로 다시 보낸다
- 다음 편집부터 새 멱등키와 새 `clientMutationId`를 만든다
- `clientMutationId`는 응답과 이벤트를 자기 요청과 잇는 값이다. 멱등키를 대신하지 않는다
- `VERSION_CONFLICT`는 자동으로 다시 보내 덮어쓰지 않는다. `currentVersions`로 최신 상태를 확인한다
- 멱등 결과 보관 기간이 지나면 다시 보내지 않고 동기화 스냅샷을 읽어 비교한다

### 편집 묶음

저장할 때마다 검토 이력이 생기지 않도록 연속 저장을 `editGroupId`로 묶는다.

- 같은 작성자, 편집 세션, 세대, 요소의 연속 수정이 하나의 변경이 된다
- 2초 동안 입력이 없거나, 다른 요소나 슬라이드로 옮기거나, 입력란을 벗어나거나, 발표나 내보내기 전에 저장을 밀어내거나, 다른 작성자가 같은 요소를 고치거나, 30초가 지나면 묶음이 닫힌다. 시간은 서버가 요청을 받은 시각 기준이다
- `finalizeGroup`이 true인 요청은 `patch` 없이 묶음만 닫을 수 있다. 이때 내용 버전은 오르지 않고 멱등키와 `clientMutationId`는 새로 만든다
- 닫힌 묶음의 `editGroupId`를 다시 쓰면 `EDIT_GROUP_CLOSED`로 거절한다
- 열린 묶음은 승인할 수 없다

## 오류

모든 오류는 `ErrorResponse` 형식이다. 코드와 상태는 `error-codes.json`에 있다.
충돌이면 `currentVersions`, 입력 오류면 `fieldErrors`가 함께 온다.

## 이벤트

- 구독은 동기화 스냅샷의 `eventCursor` 다음부터 시작한다
- SSE의 `id`는 `eventId`, `event`는 `type`, `data`는 `Event` 형식의 JSON이다
- 같은 `eventId`를 다시 받으면 버린다
- 요소 변경 이벤트의 `payload`는 요소 수정 응답과 같은 항목을 쓴다. 응답과 이벤트 중 어느 쪽이 먼저 와도 같은 `clientMutationId`와 버전으로 한 번만 반영한다
- 커서가 보관 범위를 벗어났거나 올바르지 않으면 `snapshot_required` 신호가 오고 동기화 스냅샷을 다시 읽는다
- `presence.updated`는 일시적인 접속 표시이며 다시 받을 수 있다고 보장하지 않는다

## 작업 상태

`queued`, `running`, `succeeded`, `failed`, `canceled` 다섯 가지다.
끝난 상태는 바뀌지 않는다. 내부 재시도는 같은 작업의 `attempt`가 오르고 사용자가 다시 시도하면 새 작업이 만들어진다.

## 형식을 정한 경로

| 기능 | 경로 | 형식 |
| --- | --- | --- |
| 요소 수정 | `PATCH /v1/slides/{slideId}/elements/{elementId}` | `ElementPatchRequest`, `MutationResponse` |
| 이벤트 구독 | `GET /v1/projects/{projectId}/events` | `Event`, `SnapshotRequired` |
| 동기화 스냅샷 | `GET /v1/projects/{projectId}/sync-snapshot` | `SyncSnapshot` |
| 기능 지원 정보 | `GET /v1/capabilities` | `Capabilities` |
| 세션 초기 정보 | `GET /v1/auth/bootstrap` | `AuthBootstrap` |
| 디자인 설정 조회 | `GET /v1/projects/{projectId}/design-settings` | `DesignSettings` |
| 프로젝트 작업 목록 | `GET /v1/projects/{projectId}/jobs` | `JobList` |
| 작업 조회 | `GET /v1/jobs/{jobId}` | `Job` |
| 팀 메모 조회 | `GET /v1/materials/{materialId}/note` | `MaterialNote` |
| 팀 메모 저장 | `PUT /v1/materials/{materialId}/note` | `MaterialNotePutRequest`, `MaterialNoteSaveResponse` |

## 합의가 필요한 항목

설계서에 정해져 있지 않아 예제를 만들 수 있을 만큼만 제안으로 채운 부분이다. 합의 전에는 확정으로 보지 않는다.

- 캔버스 단위 `px`와 예제 크기 1280x720
- 텍스트 스타일을 요소 단위로만 둔 것. 글자 범위별 스타일은 넣지 않았다
- 슬라이드에서 쓸 수 있는 글꼴 목록. 예제는 Pretendard를 쓴다
- 도형 종류 `rect`, `ellipse`와 스타일 항목
- 이미지 자르기를 원본 대비 비율로 표현한 것, `assetUrl` 이름
- 수정 요청의 `patch`가 보낸 항목을 통째로 교체하는 방식
- 삭제 응답 `tombstone`의 항목 이름
- `eventId`를 프로젝트 이벤트 순번 문자열로 쓰는 것, `snapshot_required` 본문
- 변경 묶음 이벤트의 `payload` 항목
- 작업 종류 이름과 `inputVersions`, `attempt` 항목
- 기능 지원 정보의 항목 구조, 기능 표시 이름, 목록 크기 기본값 30과 상한 100
- 세션 초기 정보의 `status`, `user` 항목 이름
- 동기화 스냅샷 편집 범위의 항목 이름. 구성 범위와 작업 공간 범위의 내용은 아직 정하지 않았다
- `error-codes.json`에서 `decided`가 false인 코드와 상태, `fieldErrors` 항목 구조
- 묶음만 닫는 요청은 세대만 확인하고 `baseVersion`은 확인하지 않는 것
- 같은 편집 세션이 다른 요소를 저장하면 서버가 이전 묶음을 닫는 것. 편집 세션을 식별하는 방법은 인증 기능을 만들 때 정한다
- 묶음 식별자를 다른 작성자, 다른 편집 세션, 다른 요소가 쓰면 `VALIDATION_FAILED`로 거절하는 것
- 한글 줄바꿈을 낱말 단위로 할지 글자 단위로 할지. 출력 실험에서 보는 프로그램마다 달랐다
- 요청 식별자 응답 헤더 이름 `X-Request-Id`와 예상하지 못한 서버 오류의 코드 `INTERNAL_ERROR`
- 없는 경로 외에 스프링이 직접 거절하는 요청 오류의 코드. 지금은 공통 오류 형식으로 바꾸지 않는다
- 출처를 PPTX와 PDF에 표시하는 방식

값이 정해지지 않아 예제를 비워 둔 항목도 있다. 업로드 허용 형식과 크기, 지원 글꼴, 약관 문서, 내보내기 형식이 그렇다.

## 계약을 바꿀 때

스키마, 예제, `manifest.json`을 함께 고치고 `./gradlew test`로 확인한다.
문서 형식이 호환되지 않게 바뀌면 `schemaVersion`을 올린다.
