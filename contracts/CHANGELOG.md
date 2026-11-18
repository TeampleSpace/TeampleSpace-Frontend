# 계약 변경 기록

계약이 바뀐 내용을 최근 것부터 적는다. 프론트엔드는 다시 복사할 때 자기가 복사했던 지점 이후의 항목을 본다.
각 항목의 제목 아래에 그 변경이 머지된 main의 커밋을 적는다. 복사할 때 그 커밋을 프론트엔드의 계약 기록에 적는다.

지금의 기준 커밋은 `1784978`이다. 스키마, 예제, 오류 목록이 마지막으로 바뀐 커밋이다.

## 2026-11-18 공통 계약 기준 정리

main의 `1784978`이다.

스키마

- 문서 버전을 올리는 이벤트는 `presentationVersion`과 `generation`이 필수다. 요소 수정과 삭제, 슬라이드 추가와 삭제, 순서 변경, 전체 교체 이벤트가 해당한다
- 변경 묶음 이벤트는 `resourceId`가 필수이고 `payload`가 `ChangeGroupPayload` 형식이다
- `ChangeGroupPayload` 정의 추가

예제

- 추가: `error-bad-request.json`, `error-internal-error.json`
- 거절 예제 추가: `invalid/event-element-updated-without-version.json`, `invalid/event-change-created-without-state.json`

문서

- 합의가 필요한 항목이라는 한 목록을 기준으로 정한 기술 선택, 사용자 결정이 필요한 항목, 이후 단계에서 정할 항목으로 나눴다
- 요청 헤더 `X-CSRF-Token`을 기준으로 적었다
- 이벤트 식별자는 같은지만 비교하고, 빠진 변경은 `presentationVersion`이 2 이상 건너뛰는 것으로 알아챈다고 적었다
- 다시 연결할 때의 순서를 상황별로 적었다
- 편집 묶음을 누가 닫는지 경우별로 적었다. 시간 기준은 서버가 판단한다
- 버전 충돌 때 최신 내용은 이벤트나 동기화 스냅샷에서 얻는다고 적었다
- 형식을 정한 경로마다 구현 상태와 HTTP 경로를 여는 단계를 적었다

프론트엔드가 확인할 것

- `X-CSRF-Token`을 미확정 표시에서 기준으로 바꾼다
- 이벤트 형식에 필수 항목이 늘었다. 프론트엔드의 이벤트 형식과 모킹 서버가 문서 변경 이벤트에 `presentationVersion`과 `generation`을, 변경 묶음 이벤트에 `resourceId`를 싣는지 확인한다
- 시간 때문에 보내는 닫는 요청은 없어도 된다. 보낼 때 `EDIT_GROUP_CLOSED`가 오면 이미 닫힌 것으로 본다
- 계약 기록의 아직 합의되지 않은 항목 표를 이 문서의 세 구분에 맞춰 정리한다
- 한글 줄바꿈은 정해지지 않았다. 편집 화면은 글자 단위, PDF와 PowerPoint는 낱말 단위다

## 2026-11-18 요청 오류 공통 응답 처리

main의 `8589613`이다.

- 오류 코드 추가: `BAD_REQUEST` 400, `METHOD_NOT_ALLOWED` 405, `NOT_ACCEPTABLE` 406, `UNSUPPORTED_MEDIA_TYPE` 415
- 프레임워크가 거절한 요청도 `ErrorResponse` 형식으로 온다. HTTP 상태는 원래대로다
- `error-codes.json`의 `decided` 항목을 `basis`로 바꿨다. 값은 설계 또는 기술 선택이다

프론트엔드가 확인할 것

- 오류 본문을 읽지 못해 전송 오류로 처리하던 400, 405, 415 응답이 이제 공통 오류로 읽힌다
- `error-codes.json`의 `decided`를 읽는 코드가 있으면 `basis`로 바꾼다

## 2026-11-18 요청 식별자와 공통 오류 응답

main의 `fde772b`다.

- 응답 헤더 `X-Request-Id` 추가. 오류 본문의 `requestId`와 같은 값이다
- 오류 코드 추가: `INTERNAL_ERROR` 500

## 2026-11-18 PPTX와 PDF 출력 실험

main의 `99b547b`다.

- 문서에 한글 줄바꿈 항목을 더했다. 스키마와 예제는 바뀌지 않았다

## 2026-11-18 변경 이력 묶음과 이벤트 복구 검증

프론트엔드가 처음 복사한 지점이다. main의 `fb919ee`다.
