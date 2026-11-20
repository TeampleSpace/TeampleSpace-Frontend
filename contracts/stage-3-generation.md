# 발표 구성 생성과 입력 고정

`POST /v1/projects/{projectId}/outline-jobs`는 활성 팀원의 [생성 요청](examples/outline-job-request.json)을 받아 작업을 등록하고 202와 공통 `Job`을 반환한다. 작업 조회, 목록, 취소는 기존 작업 API를 사용한다. `type`은 `outline_generation`, `targetType`은 `outline`, `targetId`는 프로젝트 ID다.

- 구성의 현재 버전을 `expectedVersion`으로 보낸다. 같은 프로젝트의 준비된 자료 ID를 1개 이상 20개 이하로 지정할 수 있다. 선택 지시는 최대 1000자다.
- 권한 확인 후 `Idempotency-Key`를 검사한다. 동일 요청은 기존 202와 작업 ID를 반환한다. 새 요청은 현재 구성 버전을 비교하며 이미 진행 중인 구성 작업이 있으면 409를 반환한다.
- [고정 입력](examples/outline-job-input.json)에 구성 버전, 자료와 원문 개정, 모델과 프롬프트 버전을 저장한다. 제공자에게 선택한 자료의 제목과 2000자 이하 텍스트, 선택 지시를 보낸다. 미선택 자료, 계정 및 내부 식별자는 보내지 않는다.
- 일시적인 제공자 오류는 작업 정책에 따라 같은 작업에서 내부 재시도한다. 잘못된 결과는 저장하지 않는다. 새로 요청하려면 현재 구성과 자료를 확인하고 새 키를 사용한다.
- 발행 직전 구성 버전, 자료의 사용 가능 상태와 고정 개정, 요청자의 접근 권한을 다시 검사한다. 다른 사람이 저장했거나 자료가 변경되면 `JOB_INPUT_STALE`로 종료한다. 취소된 작업은 기존 구성을 보존한다.
- 성공 시 [결과 참조](examples/outline-job-result.json)의 새 버전을 반환한다. 구성 전체는 기존 조회 API에서 읽는다.
- `GET /v1/capabilities`의 `featureFlags.outlineGeneration`이 false인 환경의 신규 요청은 503을 반환한다.

## 후속 PPT 생성 입력

[최초 PPT 요청](examples/presentation-generation-request.json)은 저장된 구성과 디자인 버전, 선택한 자료 ID를 전달한다. [스냅샷](examples/presentation-generation-snapshot.json)은 그 요청에서 확정한 구성 본문과 디자인, 자료 개정을 담는다. 이 단계에서 입력 계약을 제공하고 실제 PPT 작업 및 출력은 후속 단계에서 구현한다.

요청을 등록할 때 같은 프로젝트 잠금 안에서 두 버전, 빈 구성 여부, 선택한 디자인과 자료 상태를 확인한다. 구성에 연결된 모든 근거는 선택한 자료에 포함하고 개정 ID가 일치해야 한다. 일치하지 않으면 이전 원문을 최신 원문으로 자동 대체하지 않고 사용자가 확인한 뒤 다시 요청하게 한다. 발행 전에는 스냅샷의 버전과 권한을 다시 비교한다.
