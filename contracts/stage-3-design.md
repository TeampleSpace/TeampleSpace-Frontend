# 발표 템플릿과 디자인 설정

| 메서드와 경로 | 성공 응답 | 권한 |
| --- | --- | --- |
| `GET /v1/templates` | 200 `TemplateCatalog` | 가입을 완료한 사용자 |
| `GET /v1/projects/{projectId}/design-settings` | 200 `DesignSettings` | 활성 팀원 |
| `PUT /v1/projects/{projectId}/design-settings` | 200 `DesignSettings` | 활성 팀원 |
| `GET /v1/projects/{projectId}/design-fonts` | 200 `ProjectFontList` | 활성 팀원 |
| `POST /v1/projects/{projectId}/design-fonts?fileName={fileName}` | 200 `ProjectFont` | 활성 팀원 |
| `GET /v1/projects/{projectId}/design-fonts/{fontId}/content` | 200 글꼴 파일 | 활성 팀원 |

[디자인 스키마](schemas/stage-3-design.schema.json)와 [공통 응답](schemas/api.schema.json)의 예제를 사용한다.

- 템플릿 목록은 공개한 개정의 식별자, 개정 번호, 이름, 미리보기 색상과 설명, 글꼴과 레이아웃을 반환한다. 새 개정의 식별자는 다르며 이미 저장한 디자인은 기존 개정을 유지한다.
- 아직 저장하지 않은 프로젝트는 버전 1의 `unset` 설정을 읽는다. 이때 `updatedAt`은 프로젝트의 생성 시각이다.
- `template`은 `templateId`와 일치하는 `templateVersion`을 저장한다. `custom`은 이름, 허용된 글꼴, 6자리 HEX 대표 색상, 선택 입력인 디자인 지침을 저장한다. 반환 색상은 대문자이고 생략한 지침은 빈 문자열이다. 다른 모드의 값은 null이다.
- 저장에는 `expectedVersion`과 `Idempotency-Key`가 필요하다. 활성 권한 확인 후 멱등 결과를 우선 조회한다. 새 요청의 버전이 다르면 409와 `currentVersions.designVersion`을 반환한다.
- 한 번의 저장으로 버전을 한 번 올리고 `design.updated` 이벤트를 기록한다. 잘못된 상태나 템플릿은 저장하지 않는다.

## 프로젝트 글꼴

- 디자인 목록의 `projectFontsEnabled` 값이 참이면 프로젝트 글꼴을 등록할 수 있다. 이 필드가 없는 이전 응답은 기본 글꼴만 지원한다.
- 등록 요청에는 `application/octet-stream` 형식의 파일과 CSRF 헤더가 필요하다. 최대 5 MiB의 단일 TTF 또는 OTF를 지원하며 파일의 디렉터리와 필수 테이블 범위를 검사한다. 크기를 초과하면 `UPLOAD_TOO_LARGE`, 형식이 일치하지 않으면 `VALIDATION_FAILED`를 반환한다.
- 같은 프로젝트에서 같은 파일을 다시 올리면 기존 글꼴을 반환한다. 목록은 파일명, 형식, 크기와 권한 검사가 필요한 같은 출처의 미리보기 주소를 제공한다.
- 직접 입력에 `fontAssetId`를 담으면 같은 프로젝트에 있는 글꼴만 선택할 수 있다. `font`는 기본 글꼴로 계속 저장하며, 직접 올린 글꼴을 쓰지 않을 때는 `fontAssetId`를 생략한다. 이미 저장된 기본 글꼴은 이전 형식으로 조회한다.
