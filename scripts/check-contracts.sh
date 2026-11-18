#!/usr/bin/env bash
# 프론트엔드의 계약 복사본이 백엔드에 커밋된 계약과 같은지 확인한다
# 백엔드에서 작업 중인 미커밋 변경은 보지 않고 지정한 커밋의 계약만 비교한다
#   BACKEND_DIR  백엔드 저장소 위치. 기본값은 나란히 받은 ../Backend
#   BACKEND_REF  비교할 브랜치나 커밋. 기본값은 contracts-source.json의 고정 커밋
set -euo pipefail
cd "$(dirname "$0")/.."

backend="${BACKEND_DIR:-../Backend}"
if ! git -C "$backend" rev-parse --git-dir >/dev/null 2>&1; then
  echo "백엔드 저장소를 찾을 수 없습니다: $backend"
  exit 2
fi

ref="${BACKEND_REF:-}"
if [ -z "$ref" ]; then
  ref="$(node -p 'require("./contracts-source.json").commit')"
  if [[ ! "$ref" =~ ^[0-9a-f]{40}$ ]]; then
    echo "계약 기준은 전체 커밋 SHA여야 합니다"
    exit 2
  fi
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git -C "$backend" archive "$ref" contracts | tar -x -C "$work"

head="$(git -C "$backend" rev-parse --short "$ref")"
last="$(git -C "$backend" log -1 --format=%h "$ref" -- contracts)"
if diff -r "$work/contracts" contracts; then
  echo "계약 복사본이 백엔드 계약과 같습니다. 기준 $ref $head, 계약을 마지막으로 바꾼 커밋 $last"
else
  echo "계약 복사본이 백엔드 계약과 다릅니다. 기준 $ref $head, 계약을 마지막으로 바꾼 커밋 $last"
  echo "contracts 폴더를 통째로 다시 복사하고 docs/contract-notes.md의 복사한 커밋을 고친 뒤 npm test를 실행하세요"
  exit 1
fi
