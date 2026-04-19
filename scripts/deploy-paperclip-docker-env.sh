#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker/docker-compose.tailscale-stack.yml"
ENV_NAME="${1:-prod}"
ACTION="${2:-up}"

case "$ENV_NAME" in
  prod)
    APP_PORT="3100"
    DB_PORT="5432"
    ;;
  test)
    APP_PORT="3101"
    DB_PORT="5433"
    ;;
  *)
    echo "Usage: $0 [prod|test] [up|down|restart|logs|ps|bootstrap-ceo]" >&2
    exit 1
    ;;
esac

case "$ACTION" in
  up|down|restart|logs|ps|bootstrap-ceo) ;;
  *)
    echo "Usage: $0 [prod|test] [up|down|restart|logs|ps|bootstrap-ceo]" >&2
    exit 1
    ;;
esac

TAILSCALE_IP="$(tailscale ip -4 | head -n1)"
if [[ -z "$TAILSCALE_IP" ]]; then
  echo "Failed to determine Tailscale IPv4 address" >&2
  exit 1
fi

CONFIG_DIR="${HOME}/.config/paperclip/${ENV_NAME}"
STATE_DIR="${HOME}/.local/share/paperclip/${ENV_NAME}"
ENV_FILE="${CONFIG_DIR}/runtime.env"
COMPOSE_PROJECT="paperclip-${ENV_NAME}"
PAPERCLIP_DATA_DIR="${STATE_DIR}/paperclip"
POSTGRES_DATA_DIR="${STATE_DIR}/postgres"
PAPERCLIP_OPENCLAW_BRIDGE_HOST_DIR="${HOME}/.local/share/paperclip-openclaw-bridge"
SHARED_CODEX_DIR="${PAPERCLIP_DATA_DIR}/.shared-codex"
PAPERCLIP_PUBLIC_URL="http://${TAILSCALE_IP}:${APP_PORT}"

mkdir -p "$CONFIG_DIR" "$PAPERCLIP_DATA_DIR" "$POSTGRES_DATA_DIR" "$SHARED_CODEX_DIR" "$PAPERCLIP_OPENCLAW_BRIDGE_HOST_DIR"
chmod 700 "$CONFIG_DIR"

# Normalize ownership for bind-mounted persistent data so container users can read/write
# Paperclip app runs as uid/gid 1000 by default. Postgres alpine uses uid/gid 70.
docker run --rm \
  -v "$PAPERCLIP_DATA_DIR:/paperclip" \
  -v "$POSTGRES_DATA_DIR:/postgres" \
  -v "$PAPERCLIP_OPENCLAW_BRIDGE_HOST_DIR:/bridge" \
  alpine sh -c 'mkdir -p /paperclip/.shared-codex /bridge/claimed-keys && chown -R 1000:1000 /paperclip /bridge && chown -R 70:70 /postgres'

if [[ -d "${HOME}/.codex" ]]; then
  docker run --rm \
    -v "${HOME}/.codex:/source-codex:ro" \
    -v "$PAPERCLIP_DATA_DIR:/paperclip" \
    alpine sh -c '
      mkdir -p /paperclip/.shared-codex
      for name in auth.json config.toml instructions.md; do
        if [ -f "/source-codex/$name" ]; then
          cp "/source-codex/$name" "/paperclip/.shared-codex/$name"
          chown 1000:1000 "/paperclip/.shared-codex/$name"
          chmod 600 "/paperclip/.shared-codex/$name"
        fi
      done
    '
fi

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

: "${BETTER_AUTH_SECRET:=}"
if [[ -z "$BETTER_AUTH_SECRET" ]]; then
  BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
fi

: "${PAPERCLIP_AGENT_JWT_SECRET:=}"
if [[ -z "$PAPERCLIP_AGENT_JWT_SECRET" && -f "${HOME}/.paperclip/instances/default/.env" ]]; then
  PAPERCLIP_AGENT_JWT_SECRET="$(grep -E '^PAPERCLIP_AGENT_JWT_SECRET=' "${HOME}/.paperclip/instances/default/.env" | tail -n1 | cut -d= -f2-)"
fi

: "${OPENAI_API_KEY:=}"
if [[ -z "$OPENAI_API_KEY" && -f "${HOME}/.codex/auth.json" ]]; then
  OPENAI_API_KEY="$(python3 - <<'PY'
import json, pathlib
path = pathlib.Path.home() / '.codex' / 'auth.json'
try:
    data = json.loads(path.read_text())
    key = (data.get('OPENAI_API_KEY') or '').strip()
    print(key, end='')
except Exception:
    pass
PY
)"
fi

cat > "$ENV_FILE" <<EOF
ENV_NAME=${ENV_NAME}
COMPOSE_PROJECT=${COMPOSE_PROJECT}
TAILSCALE_IP=${TAILSCALE_IP}
APP_PORT=${APP_PORT}
DB_PORT=${DB_PORT}
PAPERCLIP_PUBLIC_URL=${PAPERCLIP_PUBLIC_URL}
PAPERCLIP_DATA_DIR=${PAPERCLIP_DATA_DIR}
POSTGRES_DATA_DIR=${POSTGRES_DATA_DIR}
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
PAPERCLIP_AGENT_JWT_SECRET=${PAPERCLIP_AGENT_JWT_SECRET}
OPENAI_API_KEY=${OPENAI_API_KEY}
PAPERCLIP_OPENCLAW_BRIDGE_HOST_DIR=${PAPERCLIP_OPENCLAW_BRIDGE_HOST_DIR}
EOF
chmod 600 "$ENV_FILE"

compose() {
  docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

case "$ACTION" in
  up)
    compose up -d --build
    echo "${ENV_NAME} should now be reachable at ${PAPERCLIP_PUBLIC_URL}"
    ;;
  down)
    compose down
    ;;
  restart)
    compose up -d --build --force-recreate
    echo "${ENV_NAME} restarted at ${PAPERCLIP_PUBLIC_URL}"
    ;;
  logs)
    compose logs -f --tail=150
    ;;
  ps)
    compose ps
    ;;
  bootstrap-ceo)
    compose exec -T --user 1000:1000 server pnpm paperclipai auth bootstrap-ceo
    ;;
esac
