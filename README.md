# TeampleSpace Frontend

TeampleSpace의 웹 프론트엔드 저장소다. React, TypeScript, Vite, React Router를 사용한다.

## 준비

- Node 24 이상. 버전은 `.nvmrc`에 고정되어 있다
- 패키지 관리자는 npm을 사용한다

nvm을 쓰는 경우 저장소 폴더에서 다음을 먼저 실행한다.

```bash
nvm use
```

Node 22.12 미만에서 설치하면 번들러의 네이티브 모듈이 빠져 빌드가 실패한다. 이 경우 Node 버전을 맞춘 뒤 `node_modules`를 지우고 다시 설치한다.

## 설치와 실행

```bash
npm ci
```

```bash
npm run dev
```

개발 서버는 `http://localhost:5173`에서 열린다.

## 명령

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 실행 |
| `npm run build` | 타입 검사 후 `dist`에 빌드 |
| `npm run lint` | oxlint 검사 |
| `npm test` | Vitest 단위 테스트 |
| `npm run contracts:check` | 계약 복사본이 백엔드 `main`에 커밋된 계약과 같은지 확인 |
| `npm run preview` | 빌드 결과 미리보기 |
| `npm run dev -- --mode mock` | 서버 없이 자료 화면을 메모리 모킹으로 확인하는 개발 전용 모드. 실제 서버 연동을 대신하지 않는다 |

## 환경변수

필요한 값은 `.env.local`을 직접 만들어 설정한다. 이 파일은 저장소에 올리지 않는다.

```dotenv
API_PROXY_TARGET=http://localhost:8080
```

| 이름 | 설명 |
| --- | --- |
| `API_PROXY_TARGET` | 개발 서버가 `/v1` 요청을 전달할 API 서버 주소. 비워 두면 프록시를 사용하지 않는다 |

API 경로는 `/v1`로 시작한다. 프론트엔드와 API를 같은 사이트 경로로 제공하는 구성을 기준으로 하므로 개발 중에는 프록시로 같은 출처처럼 요청한다. 인증 키 같은 비밀값은 프론트엔드 환경변수에 넣지 않는다.

## CI

PR과 `main` 푸시에서 GitHub Actions가 설치, 린트, 테스트, 빌드를 실행한다. 설정은 `.github/workflows/ci.yml`에 있다.

## 폴더 구조

소스는 `src` 아래에 계층별 폴더로 나눈다. 위 계층이 아래 계층을 가져다 쓴다.

| 폴더 | 두는 것 |
| --- | --- |
| `app` | 라우터, 전체 레이아웃, 앱 공통 상태 |
| `pages` | 기능에 속하지 않는 화면과 개발용 화면 |
| `features` | 기능별 코드. 로그인, 프로젝트, 자료, 발표 구성, 디자인 등 |
| `entities` | 여러 기능이 함께 쓰는 문서 형식 |
| `shared` | 기능과 무관한 공통 코드. API 클라이언트, 공통 UI와 화면 레이아웃, 공통 훅, 스타일 |
| `mocks` | 서버 없이 확인할 때 쓰는 모킹 서버 |

- `shared`와 `entities`는 `features`, `pages`, `app`을 가져다 쓰지 않는다
- `features`는 `pages`와 `app`을 가져다 쓰지 않는다. 화면이 전체 레이아웃에 알릴 값은 `shared/lib`의 훅으로, 화면 공통 레이아웃 클래스는 `shared/ui/PageLayout.module.css`로 쓴다
- 여러 계층을 묶어 확인하는 테스트는 `app`에 둔다

기능 폴더 안은 화면 코드와 그 밖의 코드를 나눈다.

| 위치 | 두는 것 |
| --- | --- |
| `features/기능/ui` | 컴포넌트, CSS 모듈, 컴포넌트 테스트 |
| `features/기능` 최상위 | 서버 호출 `api.ts`, 타입과 검증 `model.ts`, 화면과 무관한 도우미와 그 테스트 |

## 디자인 기준

공통 스타일과 기본 UI는 피그마 Product Design 파일의 제품 화면을 기준으로 한다. 확인한 화면, 반영한 값, 설계서나 컴포넌트 정의와 화면이 서로 다른 부분은 `../Docs/fe/design-notes.md`에 정리한다.

## 개발용 화면

개발 서버에서만 열리고 운영 빌드에는 포함되지 않는다.

| 주소 | 내용 |
| --- | --- |
| `/dev/ui` | 공통 UI의 상태 확인 |
| `/dev/editor` | 공유 문서 예제로 한글 입력, 선택, 확대, 저장 흐름을 확인하는 편집 실험. 모킹 서버로 동작한다 |
| `/dev/reference` | 백엔드의 PPTX, PDF 출력과 비교할 기준 화면. 같은 예제 문서를 문서 좌표 그대로 그린다 |

편집 실험의 확인 기록은 `../Docs/fe/editor-experiment.md`, 파일 출력 비교 기준과 결과는 `../Docs/fe/output-comparison.md`에 있다.

## 서버 계약

요청, 응답, 문서 형식은 백엔드 저장소의 공통 계약을 그대로 쓴다. `contracts` 폴더는 백엔드 저장소 `contracts` 폴더의 복사본이므로 직접 고치지 않는다.

테스트는 복사본을 기준으로 돌기 때문에 복사본이 오래되어도 통과한다. 복사본이 최신인지는 `npm run contracts:check`로 확인한다. 백엔드 저장소를 옆 폴더 `../Backend`에 받아 두면 그 저장소의 `main`에 커밋된 계약과 비교하고, CI에서도 같은 검사를 따로 돌린다. 다르다고 나오면 폴더를 통째로 다시 복사하고 `npm test`로 어긋난 곳을 확인한다.

API 클라이언트는 `src/shared/api`, 문서 형식은 `src/entities/presentation`에 있다. 서버가 준비되기 전에는 `src/mocks/server.ts`의 모킹 서버로 확인한다. 복사한 커밋, 아직 합의되지 않은 항목, 확인 기록은 `../Docs/fe/contract-notes.md`에 정리한다.

## 진행 상태

기반 작업의 구현, 자동 검증, 사람의 확인 대기 상태는 `../Docs/fe/foundation-status.md`에 정리한다.

## 협업 규칙

이슈, 브랜치, 커밋, PR 작성 규칙은 상위 TeampleSpace 프로젝트 루트의 `AGENTS.md`를 따른다. 기능 브랜치는 `feat/#이슈번호` 형식이고 PR 대상은 `main`이다.
