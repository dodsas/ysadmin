#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-ysadmin}"
APP_DIR="${APP_DIR:-/home/dodsas/work/${APP_NAME}}"
HOST_PORT="${HOST_PORT:-6666}"
PING_INTERVAL_MS="${PING_INTERVAL_MS:-600000}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.yml}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
IMAGE_RETAIN="${IMAGE_RETAIN:-3}"
IMAGE_NAME="localhost/${APP_NAME}"

log() { printf '[deploy] %s\n' "$*"; }

if [ ! -d "$APP_DIR" ]; then
  log "APP_DIR이 존재하지 않습니다: $APP_DIR"
  exit 1
fi

cd "$APP_DIR"

if ! command -v podman-compose >/dev/null 2>&1; then
  log "podman-compose 명령을 찾을 수 없습니다."
  log "설치: sudo dnf install -y podman-compose  (또는 pip install --user podman-compose)"
  exit 1
fi

export HOST_PORT PING_INTERVAL_MS IMAGE_TAG

log "이미지 태그: ${IMAGE_NAME}:${IMAGE_TAG}"

log "podman-compose: 빌드"
podman-compose -f "$COMPOSE_FILE" build

# latest 태그도 함께 부여 (compose default 호환)
if [ "$IMAGE_TAG" != "latest" ]; then
  podman tag "${IMAGE_NAME}:${IMAGE_TAG}" "${IMAGE_NAME}:latest"
fi

log "podman-compose: 기존 컨테이너 중지/제거"
podman-compose -f "$COMPOSE_FILE" down --remove-orphans || true

log "podman-compose: 기동"
podman-compose -f "$COMPOSE_FILE" up -d

log "헬스체크 (최대 30초 대기)"
HEALTH_OK=0
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${HOST_PORT}/api/health" >/dev/null 2>&1; then
    HEALTH_OK=1
    break
  fi
  sleep 1
done

if [ "$HEALTH_OK" -ne 1 ]; then
  log "✗ 헬스체크 실패. 로그:"
  podman-compose -f "$COMPOSE_FILE" logs --tail 50 || true
  exit 1
fi

log "✓ 헬스체크 통과 — http://$(hostname):${HOST_PORT}"

# ysadmin 이미지만 정리 — 다른 서비스(dokuwiki, jenkins 등)에 영향 주지 않음
log "이미지 정리 (최근 ${IMAGE_RETAIN}개 유지)"
# 1) dangling (untagged) 중 ysadmin만
podman images --filter "dangling=true" --filter "reference=${IMAGE_NAME}" --format "{{.ID}}" \
  | xargs -r podman rmi 2>/dev/null || true

# 2) 태그된 ysadmin 이미지 중 오래된 것 제거 (latest 제외)
podman images "${IMAGE_NAME}" --format "{{.Tag}}\t{{.ID}}\t{{.CreatedAt}}" \
  | grep -v -E "^latest\b" \
  | sort -k3 -r \
  | awk -v keep="$IMAGE_RETAIN" 'NR > keep {print $2}' \
  | xargs -r podman rmi 2>/dev/null || true

log "완료."
