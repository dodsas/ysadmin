#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-ysadmin}"
APP_DIR="${APP_DIR:-/home/dodsas/work/${APP_NAME}}"
IMAGE="localhost/${APP_NAME}:latest"
CONTAINER="${APP_NAME}"
HOST_PORT="${HOST_PORT:-3000}"
CONTAINER_PORT="${CONTAINER_PORT:-3000}"
VOLUME_NAME="${APP_NAME}-data"
PING_INTERVAL_MS="${PING_INTERVAL_MS:-600000}"

log() { printf '[deploy] %s\n' "$*"; }

if [ ! -d "$APP_DIR" ]; then
  log "APP_DIR이 존재하지 않습니다: $APP_DIR"
  exit 1
fi

cd "$APP_DIR"

log "이미지 빌드: $IMAGE"
podman build -t "$IMAGE" .

if ! podman volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
  log "볼륨 생성: $VOLUME_NAME"
  podman volume create "$VOLUME_NAME" >/dev/null
fi

if podman container exists "$CONTAINER"; then
  log "기존 컨테이너 중지/제거: $CONTAINER"
  podman stop "$CONTAINER" >/dev/null 2>&1 || true
  podman rm "$CONTAINER" >/dev/null 2>&1 || true
fi

log "컨테이너 기동"
podman run -d \
  --name "$CONTAINER" \
  --restart=always \
  -p "${HOST_PORT}:${CONTAINER_PORT}" \
  -v "${VOLUME_NAME}:/app/data:Z" \
  -e "PORT=${CONTAINER_PORT}" \
  -e "PING_INTERVAL_MS=${PING_INTERVAL_MS}" \
  "$IMAGE" >/dev/null

log "헬스체크 (최대 30초 대기)"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${HOST_PORT}/api/health" >/dev/null 2>&1; then
    log "✓ 헬스체크 통과 — http://$(hostname):${HOST_PORT}"
    podman image prune -f >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 1
done

log "✗ 헬스체크 실패. 로그:"
podman logs --tail 50 "$CONTAINER" || true
exit 1
