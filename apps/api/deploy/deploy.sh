#!/usr/bin/env bash
# Forced command для SSH-ключа CI (authorized_keys: command="/opt/qorgan/deploy.sh",restrict).
# Ключ CI не даёт shell: разрешено только «deploy <backend|web> <git-sha>».
# GHCR-токен приходит в stdin (одноразовый GITHUB_TOKEN из job) и не сохраняется на диске.
set -euo pipefail

cd /opt/qorgan
read -r -a ARGS <<< "${SSH_ORIGINAL_COMMAND:-}"
COMPONENT="${ARGS[0]:-}"
SHA="${ARGS[1]:-}"
ACTOR="${ARGS[2]:-qorgan-ci}"

if [[ ! "$COMPONENT" =~ ^(backend|web)$ || ! "$SHA" =~ ^[0-9a-f]{7,40}$ || ! "$ACTOR" =~ ^[A-Za-z0-9-]{1,39}$ ]]; then
  echo "usage: deploy <backend|web> <git-sha> [github-actor]" >&2
  exit 2
fi

# Отдельный конфиг docker на время деплоя: токен не остаётся в ~/.docker/config.json.
export DOCKER_CONFIG
DOCKER_CONFIG="$(mktemp -d)"
trap 'rm -rf "$DOCKER_CONFIG"' EXIT
docker login ghcr.io -u "$ACTOR" --password-stdin >/dev/null

exec 9>/opt/qorgan/.deploy.lock
flock 9

case "$COMPONENT" in
  backend)
    sed -i "s/^BACKEND_TAG=.*/BACKEND_TAG=$SHA/" tags.env
    SERVICES=(api worker)
    ;;
  web)
    sed -i "s/^WEB_TAG=.*/WEB_TAG=$SHA/" tags.env
    SERVICES=(web)
    ;;
esac

COMPOSE=(docker compose --env-file .env --env-file tags.env -f docker-compose.yml)
"${COMPOSE[@]}" pull --quiet "${SERVICES[@]}"
# Только свои сервисы (+ зависимости через depends_on): деплой фронта не трогает бэкенд и наоборот.
"${COMPOSE[@]}" up -d --wait --wait-timeout 300 "${SERVICES[@]}"
docker image prune -f >/dev/null
"${COMPOSE[@]}" ps --format 'table {{.Service}}\t{{.Status}}'
echo "deployed $COMPONENT@$SHA"
