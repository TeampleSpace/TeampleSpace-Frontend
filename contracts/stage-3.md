# 발표 구성

| 메서드와 경로 | 성공 응답 | 접근 권한 |
| --- | --- | --- |
| `GET /v1/projects/{projectId}/outline` | 200 `Outline` | 활성 프로젝트 팀원 |
| `PUT /v1/projects/{projectId}/outline` | 200 `Outline` | 활성 프로젝트 팀원 |

형식은 [스키마](schemas/stage-3.schema.json), [빈 구성](examples/outline-empty.json), [저장 요청](examples/outline-put-request.json), [저장 결과](examples/outline.json)를 참고한다.

- 아직 저장한 구성이 없는 기존 및 신규 프로젝트는 버전 1과 빈 배열을 반환한다. 빈 구성 조회는 쓰기를 하지 않는다.
- 저장의 `expectedVersion`은 최근에 확인한 구성의 `version`이다. 성공하면 항목, 순서, 근거를 모두 교체하고 버전을 한 번 올린다. 빈 배열은 모든 항목을 지운다.
- 배열 순서가 항목 순서다. 서버는 0부터 시작하는 연속 위치를 반환한다. 기존 항목은 조회한 `id`를 보내며 신규 항목은 생략한다. 생략한 기존 항목은 삭제한다.
- 한 구성에 최대 100개 항목, 항목마다 255자 제목과 10000자 요약, 최대 20개 근거를 저장한다. 요약을 생략하면 빈 문자열을 반환한다.
- `sourceIds`는 같은 프로젝트의 준비 완료 자료 ID 배열이다. 저장 시 변하지 않는 현재 개정으로 고정하고 `sourceRefs`에 자료 ID, 개정 ID, 출처 버전을 배열 순서대로 반환한다. 이후 자료를 수정해도 기존 근거는 바뀌지 않으며 삭제된 자료의 기존 근거에는 `sourceDeleted`가 표시된다.
- 잘못된 항목 또는 근거 하나라도 있으면 `422 VALIDATION_FAILED`를 반환하며 아무 항목도 저장하지 않는다.
- 참여 이력이 없는 사용자는 404, 퇴장하거나 제거된 팀원은 403이다. 권한을 잃으면 이전에 성공한 저장 키의 응답도 재생하지 않는다.
- 저장에는 세션, CSRF 토큰 및 `Idempotency-Key`가 필요하다. 권한 확인 후 같은 키의 결과를 버전 비교보다 먼저 조회한다. 같은 본문의 재시도는 처음 결과를 반환하고 다른 본문은 `409 IDEMPOTENCY_KEY_REUSED`다.
- 버전 불일치의 새 요청은 [VERSION_CONFLICT](examples/error-outline-version-conflict.json)로 현재 `currentVersions.outlineVersion`을 반환한다. 덮어쓰지 않으며 충돌 이후에는 먼저 조회하고 새로운 키로 저장한다.

저장 성공 시 `outline.updated`에 새 `outlineVersion`을 기록한다. 같은 키의 재시도는 버전이나 이벤트를 추가하지 않는다.

## 항목 근거 교체

`PUT /v1/outline-items/{itemId}/sources`는 [근거 저장 요청](examples/outline-sources-put-request.json)의 버전과 선택한 자료 ID를 받고 새 전체 구성을 200으로 반환한다. 빈 배열이면 해당 항목의 근거를 모두 해제한다. 다른 항목과 그 근거, 기존 순서는 유지하며 구성 버전을 한 번 올린다. 원문은 조회 결과의 자료 ID와 개정 ID를 사용해 기존 자료 원문 API에서 연다.

권한 확인, 멱등키와 버전 충돌 기준은 전체 저장과 같다. 권한이 유지되는 동안 성공한 키는 해당 항목이 이후 삭제되어도 기존 응답을 재생할 수 있다.
