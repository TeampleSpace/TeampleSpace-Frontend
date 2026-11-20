# 발표 템플릿과 디자인 설정

| 메서드와 경로 | 성공 응답 | 권한 |
| --- | --- | --- |
| `GET /v1/templates` | 200 `TemplateCatalog` | 가입을 완료한 사용자 |
| `GET /v1/projects/{projectId}/design-settings` | 200 `DesignSettings` | 활성 팀원 |
| `PUT /v1/projects/{projectId}/design-settings` | 200 `DesignSettings` | 활성 팀원 |

[디자인 스키마](schemas/stage-3-design.schema.json)와 [공통 응답](schemas/api.schema.json)의 예제를 사용한다.

- 템플릿 목록은 공개한 개정의 식별자, 개정 번호, 이름, 미리보기 색상과 설명, 글꼴과 레이아웃을 반환한다. 새 개정의 식별자는 다르며 이미 저장한 디자인은 기존 개정을 유지한다.
- 아직 저장하지 않은 프로젝트는 버전 1의 `unset` 설정을 읽는다. 이때 `updatedAt`은 프로젝트의 생성 시각이다.
- `template`은 `templateId`와 일치하는 `templateVersion`을 저장한다. `custom`은 이름, 허용된 글꼴, 6자리 HEX 대표 색상, 선택 입력인 디자인 지침을 저장한다. 반환 색상은 대문자이고 생략한 지침은 빈 문자열이다. 다른 모드의 값은 null이다.
- 저장에는 `expectedVersion`과 `Idempotency-Key`가 필요하다. 활성 권한 확인 후 멱등 결과를 우선 조회한다. 새 요청의 버전이 다르면 409와 `currentVersions.designVersion`을 반환한다.
- 한 번의 저장으로 버전을 한 번 올리고 `design.updated` 이벤트를 기록한다. 잘못된 상태나 템플릿은 저장하지 않는다.
