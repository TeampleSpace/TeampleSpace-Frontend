# 계약 연결 기반 기록

프론트엔드가 서버 계약을 어떻게 옮겼는지, 아직 합의되지 않은 항목이 무엇인지, 무엇을 어떤 방법으로 확인했는지 남기는 문서다.

## 기준

2026-11-18에 노션의 1차 출시 기준과 개발 순서, 프론트엔드 설계서, 백엔드 설계서를 읽고 작성했다. 이후 변경이 있으면 노션의 1차 출시 기준을 우선한다.

## 계약을 그대로 옮긴 것

- API 경로는 `/v1`로 시작한다
- 공통 오류 응답은 `error.code`, `error.message`, `error.retryable`, `error.fieldErrors`, `error.currentVersions`, `requestId`를 가진다
- 요청 제한 응답과 재시도 가능한 일시 실패 응답의 `Retry-After`는 초 단위 값이다
- 문서를 바꾸는 요청은 `Idempotency-Key` 헤더가 필수다. `clientMutationId`는 화면과 이벤트를 잇는 값이며 멱등 키를 대신하지 않는다
- 요소 수정 요청 본문은 `generation`, `baseVersion`, `editGroupId`, `clientMutationId`, `finalizeGroup`, `patch`를 가진다
- 수정 응답은 `clientMutationId`, `resource`, `elementVersion`, `slideVersion`, `presentationVersion`, `orderVersion`, `generation`, `changeId`, `eventId`를 가진다
- 오류 코드는 `VERSION_CONFLICT`, `IDEMPOTENCY_KEY_REUSED`, `REQUEST_IN_PROGRESS`, `EDIT_GROUP_CLOSED`를 사용한다. 프론트엔드에서 새 오류 코드를 만들지 않았다
- 실시간 이벤트의 공통 필드와 공유 문서의 필드 이름은 설계서를 따른다

## 백엔드 결정이 필요한 항목

아래는 문서에 형식이 없어 임시값으로 둔 항목이다. 코드에는 미확정이라고 표시했다. 백엔드에서 확정하면 그 값으로 바꾼다.

| 항목 | 현재 임시값 | 위치 |
| --- | --- | --- |
| CSRF 토큰을 싣는 요청 헤더 이름 | `X-CSRF-Token` | `src/shared/api/contract.ts` |
| 세션 컨텍스트 응답에서 인증 여부를 담는 필드 | `state` | `src/shared/api/contract.ts` |
| 입력 오류 한 건의 형식 | `field`, `message` | `src/shared/api/contract.ts` |
| 전역 지원값의 각 값 형식과 지원 글꼴 목록 | 문자열 목록으로 가정 | `src/shared/api/contract.ts` |
| 캔버스 크기와 단위 | 1280, 720, `px` | `src/entities/presentation/example.json` |
| `slides`와 `elements`의 형태 | 식별자를 키로 쓰는 객체, 순서는 `slideIds`와 `elementIds` | `src/entities/presentation/schema.ts` |
| 텍스트 스타일 허용 목록 | `fontFamily`, `fontSize`, `fontWeight`, `color`, `align`, `lineHeight` | `src/entities/presentation/schema.ts` |
| 도형 종류와 속성 | `rect`, `ellipse`와 `fill`, `stroke`, `strokeWidth` | `src/entities/presentation/schema.ts` |
| 이미지 자르기 형식과 읽기 응답의 임시 주소 필드 | `crop`은 `x`, `y`, `width`, `height`, 임시 주소는 `assetUrl` | `src/entities/presentation/schema.ts` |
| 요소 수정 요청의 `patch` 형식 | `content.text`와 `geometry` 일부 | `src/entities/presentation/schema.ts` |
| 편집 화면 스냅샷 응답의 필드 이름 | `scope`, `presentation`, `eventCursor` | `src/entities/presentation/schema.ts` |
| 이벤트 스트림의 줄 형식 | `id`, `event`, `data` 줄 사용 | `src/mocks/server.ts` |
| 이벤트 식별자와 이벤트 커서가 같은 형식인지 | 같은 순번 문자열로 가정 | `src/mocks/server.ts` |
| 내용 없이 묶음만 닫는 요청의 버전 검사와 응답 | 요소 버전을 검사하지 않고 현재 요소를 그대로 반환 | `src/mocks/server.ts` |
| 이미 닫힌 묶음에 종료만 요청했을 때의 응답 | `EDIT_GROUP_CLOSED` | `src/mocks/server.ts` |
| 이벤트를 놓쳤는지 판단하는 기준 | 이벤트의 `presentationVersion`이 직전보다 2 이상 크면 놓친 것으로 보고 스냅샷을 다시 읽음. 모든 이벤트가 이 값을 싣는지 확인 필요 | `src/features/editor/session.ts` |
| 다시 연결할 때의 순서 | 보낼 입력이 없으면 마지막 이벤트 뒤부터 재생만 받고, 보낼 입력이 있으면 스냅샷을 먼저 읽어 비교한 뒤 보냄. 항상 스냅샷부터 읽어야 하는지 확인 필요 | `src/features/editor/session.ts` |
| 이력 묶음을 닫는 주체 | 클라이언트가 2초 무입력, 30초 경과, 편집 종료 때 종료 요청을 보냄. 서버도 같은 기준으로 닫으므로 시계 차이로 `EDIT_GROUP_CLOSED`를 받으면 새 묶음으로 다시 보냄 | `src/features/editor/session.ts` |
| 버전 충돌 때 서버 최신 내용을 얻는 방법 | 충돌 응답에는 현재 버전만 있어 이벤트로 받은 내용이나 스냅샷 재조회로 얻음 | `src/features/editor/session.ts` |

## 모킹과 실제 연동의 구분

2026-11-18 기준 백엔드 저장소에는 `/v1` API가 없다. 그래서 실제 서버 연동은 한 건도 확인하지 못했다.

`src/mocks/server.ts`는 계약 문서의 저장, 멱등, 이력 묶음, 이벤트 규칙을 메모리에서 흉내 낸다. 이 모킹으로 통과한 시험은 프론트엔드 코드가 계약 문서의 해석과 일치한다는 뜻이다. 실제 서버의 동작을 보증하지 않는다.

## 확인 기록

| 실행일 | 환경 | 절차 | 결과 | 구분 |
| --- | --- | --- | --- | --- |
| 2026-11-18 | macOS, Node 24.20.0 | `npm test` | 테스트 파일 3개, 21건 통과 | 모킹 |
| 2026-11-18 | macOS, Node 24.20.0 | `npm test` | 편집 세션 시험을 더해 테스트 파일 6개, 46건 통과 | 모킹 |
| 2026-11-18 | 앱 내장 브라우저, 1440x900 | `/dev/editor`에서 직접 조작 | `docs/editor-experiment.md` 참고 | 모킹 |

모킹으로 확인한 내용은 다음과 같다.

- 오류 응답을 공통 구조로 읽고 현재 버전과 재시도 대기 시간을 꺼낸다
- 변경 요청에 CSRF 토큰과 멱등 키를 싣고 세션 조회는 한 번만 한다
- 계약과 다른 응답은 성공으로 처리하지 않는다
- 응답을 받지 못한 경우와 제한 시간 초과를 서버 오류와 구분한다
- 예제 문서가 문서 형식 검사를 통과한다
- 같은 키와 같은 본문의 재시도는 버전 검사보다 먼저 기존 결과를 받는다
- 응답을 잃은 뒤 같은 요청을 다시 보내면 한 번만 반영된다
- 같은 키로 다른 본문을 보내거나 처리 중인 키로 다시 보내면 거절된다
- 오래된 버전의 새 요청은 현재 버전과 함께 거절되고 저장되지 않는다
- 연속 저장은 검토 이력을 하나만 만들고 종료 요청, 2초 무입력, 다른 작성자의 수정으로 닫힌다
- 이벤트 연결은 커서 이후부터 재생하고 보관 범위를 벗어나면 다시 동기화하라고 알린다

실제 서버로 확인해야 하는 것은 위 항목 전부와 세션 쿠키 전달, CSRF 검증, 같은 사이트 프록시 구성이다.
