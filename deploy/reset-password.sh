#!/usr/bin/env bash
# ysadmin 관리자 자격증명 강제 초기화 스크립트.
#
# 동작:
#   1) 컨테이너 내부 /app/data/auth.json, sessions.json 삭제
#   2) 컨테이너 재시작 (서버 내부 캐시 비우기 위함)
#   3) 이후 웹 UI 첫 접속 시 새 아이디/비밀번호 설정 화면이 표시됨
#
# 사용:
#   bash reset-password.sh [-y]
#     -y    확인 프롬프트 건너뜀
set -euo pipefail

APP_NAME="${APP_NAME:-ysadmin}"
APP_DIR="${APP_DIR:-/home/dodsas/work/${APP_NAME}}"

AUTO_YES=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) AUTO_YES=1 ;;
    -h|--help)
      sed -n '2,11p' "$0"
      exit 0
      ;;
    *)
      printf '[reset-password] 알 수 없는 옵션: %s\n' "$arg" >&2
      exit 2
      ;;
  esac
done

log() { printf '[reset-password] %s\n' "$*"; }

if [ -d "$APP_DIR" ]; then
  cd "$APP_DIR"
fi

if ! command -v podman >/dev/null 2>&1; then
  log "podman 명령을 찾을 수 없습니다."
  exit 1
fi

if ! podman container exists "$APP_NAME"; then
  log "컨테이너 '$APP_NAME' 이(가) 존재하지 않습니다. 먼저 배포/기동 후 다시 시도하세요."
  exit 1
fi

RUNNING="$(podman inspect -f '{{.State.Running}}' "$APP_NAME" 2>/dev/null || echo false)"
if [ "$RUNNING" != "true" ]; then
  log "컨테이너 '$APP_NAME' 가 실행 중이 아닙니다. 시작 후 다시 시도하세요."
  exit 1
fi

if [ "$AUTO_YES" -ne 1 ]; then
  printf '[reset-password] 정말 관리자 계정을 초기화하시겠습니까? (yes/no) '
  read -r reply
  case "$reply" in
    yes|YES|y|Y) ;;
    *) log "취소되었습니다."; exit 0 ;;
  esac
fi

log "자격증명/세션 파일 삭제..."
podman exec "$APP_NAME" sh -c 'rm -f /app/data/auth.json /app/data/sessions.json'

log "컨테이너 재시작..."
podman restart "$APP_NAME" >/dev/null

log "✓ 완료. 웹 UI 첫 접속에서 새 아이디/비밀번호를 설정하세요."
