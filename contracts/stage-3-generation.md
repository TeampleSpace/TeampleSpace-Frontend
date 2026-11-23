# 발표 구성 생성과 입력 고정

`POST /v1/projects/{projectId}/outline-jobs`는 활성 팀원의 [생성 요청](examples/outline-job-request.json)을 받아 작업을 등록하고 202와 공통 `Job`을 반환한다. 작업 조회, 목록, 취소는 기존 작업 API를 사용한다. `type`은 `outline_generation`, `targetType`은 `outline`, `targetId`는 프로젝트 ID다.

- 구성의 현재 버전을 `expectedVersion`으로 보낸다. 같은 프로젝트의 준비된 자료 ID를 1개 이상 20개 이하로 지정할 수 있다. 선택 지시는 최대 1000자다.
- 권한 확인 후 `Idempotency-Key`를 검사한다. 동일 요청은 기존 202와 작업 ID를 반환한다. 새 요청은 현재 구성 버전을 비교하며 이미 진행 중인 구성 작업이 있으면 409를 반환한다.
- [고정 입력](examples/outline-job-input.json)에 구성 버전, 자료와 원문 개정, 모델과 프롬프트 버전을 저장한다. 제공자에게 선택한 자료의 제목과 2000자 이하 텍스트, 선택 지시를 보낸다. 미선택 자료, 계정 및 내부 식별자는 보내지 않는다.
- 일시적인 제공자 오류는 작업 정책에 따라 같은 작업에서 내부 재시도한다. 잘못된 결과는 저장하지 않는다. 새로 요청하려면 현재 구성과 자료를 확인하고 새 키를 사용한다.
- 발행 직전 구성 버전, 자료의 사용 가능 상태와 고정 개정, 요청자의 접근 권한을 다시 검사한다. 다른 사람이 저장했거나 자료가 변경되면 `JOB_INPUT_STALE`로 종료한다. 취소된 작업은 기존 구성을 보존한다.
- 성공 시 [결과 참조](examples/outline-job-result.json)의 새 버전을 반환한다. 구성 전체는 기존 조회 API에서 읽는다.
- `GET /v1/capabilities`의 `featureFlags.outlineGeneration`이 false인 환경의 신규 요청은 503을 반환한다.

## 첫 발표 자료 생성

`POST /v1/projects/{projectId}/presentation-jobs`는 활성 팀원의 [생성 요청](examples/presentation-generation-request.json)을 받아 작업을 등록하고 202와 공통 `Job`을 반환한다. `type`은 `presentation_generation`, `targetType`은 `presentation`, `targetId`는 프로젝트 ID다. 작업 조회, 목록, 취소는 기존 작업 API를 사용한다.

- 저장된 구성과 디자인의 현재 버전, 선택한 자료 ID를 보낸다. 두 버전 중 하나라도 다르면 409와 두 현재 버전을 `currentVersions`에 담아 반환한다
- 이미 발표 자료가 있으면 `REGENERATION_NOT_ENABLED`(409)다. 다시 생성은 후속 범위다
- 구성 항목이 없거나 디자인을 정하지 않았으면 422다. 구성에 연결된 모든 근거는 선택한 자료에 포함되고 개정이 일치해야 한다. 일치하지 않으면 이전 원문을 최신 원문으로 자동 대체하지 않고 422로 거절해 사용자가 구성을 확인한 뒤 다시 요청하게 한다
- 권한 확인 후 `Idempotency-Key`를 검사한다. 같은 프로젝트에 진행 중인 생성 작업이 있으면 `REQUEST_IN_PROGRESS`다
- [고정 입력](examples/presentation-job-input.json)에 요청에서 확정한 [스냅샷](examples/presentation-generation-snapshot.json)과 모델, 프롬프트 개정을 저장한다. 제공자에게 구성 항목의 제목과 설명, 선택한 자료의 제목과 2000자 이하 텍스트, 직접 입력 디자인의 지침을 보낸다. 계정과 내부 식별자는 보내지 않는다
- 제공자는 발표 제목과 소개, 구성 항목마다 한 장의 제목과 문장 1개에서 5개, 마지막 정리 슬라이드의 글만 만든다. 서버가 디자인 설정의 배경색, 제목색, 글꼴로 1280 x 720 캔버스의 텍스트와 도형 요소를 배치한다. 슬라이드는 표지, 구성 항목 순서의 본문, 정리 순서이고 본문 아래에 연결된 자료 제목을 출처로 적는다
- 제목색이 배경과 3:1 대비가 안 되면 제목과 강조 도형은 본문색을 쓴다. 직접 입력에서 프로젝트 글꼴을 고르면 텍스트의 `fontFamily`는 `ProjectFont-{fontAssetId}`이고, 화면은 그 글꼴 파일을 이 이름으로 등록해 그린다
- 슬라이드 수가 구성 항목과 다르거나 글이 글상자에 넘치는 길이면 `JOB_PRESENTATION_INVALID_RESULT`로 끝내고 저장하지 않는다. 일시적인 제공자 오류만 같은 작업에서 내부 재시도한다
- 발행 직전 요청자의 접근 권한, 구성과 디자인 버전, 자료의 고정 개정, 발표 자료가 아직 없는지를 다시 검사한다. 바뀌었으면 `JOB_INPUT_STALE`, 권한이 회수됐으면 `JOB_PRESENTATION_ACCESS_REVOKED`로 끝내고 아무것도 저장하지 않는다
- 성공하면 발표 자료와 슬라이드, 요소를 한 트랜잭션에서 만들고 `presentation.replaced` 이벤트를 보낸다. 이벤트의 `presentationVersion`과 `generation`은 1이다. [결과 참조](examples/presentation-job-result.json)의 발표 ID로 동기화 스냅샷을 다시 읽는다
- `GET /v1/capabilities`의 `featureFlags.presentationGeneration`이 false인 환경의 신규 요청은 503을 반환한다

## 승인 요청

| 요청 | 본문 | 성공 응답 |
| --- | --- | --- |
| POST /v1/projects/{projectId}/requests | ChangeRequestCreate | 201 ChangeRequest |
| GET /v1/projects/{projectId}/requests | 없음 | ChangeRequestList |
| POST /v1/requests/{requestId}/approve | 없음 | ChangeRequest |
| POST /v1/requests/{requestId}/reject | 없음 | ChangeRequest |
| POST /v1/requests/{requestId}/cancel | 없음 | ChangeRequest |

- AI 구성 만들기(`outline_generation`), PPT 만들기(`presentation_generation`), 디자인 변경(`design_change`)을 바로 실행하지 않고 팀원에게 승인을 요청한다. `payload`는 각 작업의 기존 요청 본문이다
- 요청은 `Idempotency-Key`가 필수다. 같은 프로젝트에 같은 종류의 요청이 기다리고 있으면 `REQUEST_IN_PROGRESS`다
- 요청자가 아닌 활성 팀원 한 명이 승인하면 요청자의 이름으로 기존 작업 등록이나 디자인 저장을 실행한다. 이때 기존 검사를 그대로 다시 하고, 요청 뒤에 구성이나 디자인이 바뀌었거나 다른 검사에 걸리면 요청은 `failed`가 되며 `error`에 이유를 남긴다. 성공하면 `approved`이고 `result`에 작업 `jobId`나 `designVersion`을 담는다
- 요청자는 자기 요청을 승인하거나 거절할 수 없고 취소만 할 수 있다. 다른 팀원은 취소하지 못한다. 어기면 `FORBIDDEN`이다
- 이미 처리된 요청이나 다른 사람이 승인하는 중인 요청을 다시 처리하면 `REQUEST_NOT_PENDING`이다. 승인하던 서버가 멈춰 2분 넘게 끝나지 않은 요청은 다시 승인할 수 있고, 같은 요청으로 실행해 두 번 실행되지 않는다. 20시간 넘게 멈춘 요청은 이미 실행됐는지 알 수 없어 다시 승인하면 `failed`로 닫는다
- 기존 작업 등록과 디자인 저장 경로는 그대로 열려 있다. 팀원이 혼자인 프로젝트는 화면이 기존 경로로 바로 실행한다
- 요청을 만들면 `request.created`, 처리하면 `request.updated` 이벤트를 보낸다. payload는 requestId, type, state이고 받은 화면은 요청 목록을 다시 읽는다

