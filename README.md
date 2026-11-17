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
| `npm run preview` | 빌드 결과 미리보기 |

## 환경변수

`.env.example`을 `.env.local`로 복사해서 사용한다. `.env.local`은 저장소에 올리지 않는다.

```bash
cp .env.example .env.local
```

| 이름 | 설명 |
| --- | --- |
| `API_PROXY_TARGET` | 개발 서버가 `/v1` 요청을 전달할 API 서버 주소. 비워 두면 프록시를 사용하지 않는다 |

API 경로는 `/v1`로 시작한다. 프론트엔드와 API를 같은 사이트 경로로 제공하는 구성을 기준으로 하므로 개발 중에는 프록시로 같은 출처처럼 요청한다. 인증 키 같은 비밀값은 프론트엔드 환경변수에 넣지 않는다.

## CI

PR과 `main` 푸시에서 GitHub Actions가 설치, 린트, 테스트, 빌드를 실행한다. 설정은 `.github/workflows/ci.yml`에 있다.

## 개발용 화면

개발 서버에서만 열리고 운영 빌드에는 포함되지 않는다.

| 주소 | 내용 |
| --- | --- |
| `/dev/ui` | 공통 UI의 상태 확인 |
| `/dev/editor` | 공유 문서 예제로 한글 입력, 선택, 확대, 저장 흐름을 확인하는 편집 실험. 모킹 서버로 동작한다 |

편집 실험의 확인 기록은 `docs/editor-experiment.md`에 있다.

## 서버 계약

API 클라이언트는 `src/shared/api`, 공유 문서 형식과 예제는 `src/entities/presentation`에 있다. 서버가 준비되기 전에는 `src/mocks/server.ts`의 모킹 서버로 확인한다. 아직 합의되지 않은 계약 항목과 확인 기록은 `docs/contract-notes.md`에 정리한다.

## 협업 규칙

이슈, 브랜치, 커밋, PR 작성 규칙은 팀의 협업 규칙 문서를 따른다. 기능 브랜치는 `feat/#이슈번호` 형식이고 PR 대상은 `main`이다.
