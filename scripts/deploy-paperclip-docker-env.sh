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
PAPERCLIP_PUBLIC_URL="http://${TAILSCALE_IP}:${APP_PORT}"

mkdir -p "$CONFIG_DIR" "$PAPERCLIP_DATA_DIR" "$POSTGRES_DATA_DIR"
chmod 700 "$CONFIG_DIR"

# Normalize ownership for bind-mounted persistent data so container users can read/write
# Paperclip app runs as uid/gid 1000 by default. Postgres alpine uses uid/gid 70.
docker run --rm \
  -v "$PAPERCLIP_DATA_DIR:/paperclip" \
  -v "$POSTGRES_DATA_DIR:/postgres" \
  alpine sh -c 'chown -R 1000:1000 /paperclip && chown -R 70:70 /postgres'

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

: "${BETTER_AUTH_SECRET:=}"
if [[ -z "$BETTER_AUTH_SECRET" ]]; then
  BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
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
    compose exec -T server pnpm paperclipai auth bootstrap-ceo
    ;;
esac
