#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${HOME}/.config/paperclip"
ENV_FILE="${RUNTIME_DIR}/tailscale-runtime.env"
COMPOSE_FILE="${ROOT_DIR}/docker/docker-compose.tailscale.yml"

mkdir -p "$RUNTIME_DIR"

TAILSCALE_IP="$(tailscale ip -4 | head -n1)"
if [[ -z "$TAILSCALE_IP" ]]; then
  echo "Failed to determine Tailscale IPv4 address" >&2
  exit 1
fi

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

: "${BETTER_AUTH_SECRET:=}"
if [[ -z "$BETTER_AUTH_SECRET" ]]; then
  BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
fi

PAPERCLIP_PUBLIC_URL="http://${TAILSCALE_IP}:3100"

cat > "$ENV_FILE" <<EOF
TAILSCALE_IP=${TAILSCALE_IP}
PAPERCLIP_PUBLIC_URL=${PAPERCLIP_PUBLIC_URL}
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
EOF

chmod 600 "$ENV_FILE"

cd "$ROOT_DIR"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build

echo "Paperclip should now be reachable at ${PAPERCLIP_PUBLIC_URL}"
