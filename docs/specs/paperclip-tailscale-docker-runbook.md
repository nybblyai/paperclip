# Paperclip Tailscale Docker Runbook

Run Paperclip in Docker while exposing the app only on the host's Tailscale interface.

## Why this mode

- Paperclip binds only to the host's Tailscale IPv4 address on port `3100`
- Postgres binds only to `127.0.0.1:5432`
- No public `0.0.0.0` listener is used for the app
- This avoids conflicting with any existing `tailscale serve` root already used by other services

## Compose file

Use:

- `docker/docker-compose.tailscale.yml`

Required environment:

- `TAILSCALE_IP`
- `PAPERCLIP_PUBLIC_URL`
- `BETTER_AUTH_SECRET`

A helper script is included:

- `scripts/run-paperclip-tailscale-docker.sh`

It derives the current Tailscale IPv4 address, writes a runtime env file to `~/.config/paperclip/tailscale-runtime.env`, preserves the auth secret across restarts, and starts the stack.

## Example

```bash
./scripts/run-paperclip-tailscale-docker.sh
```

Manual alternative:

```bash
export TAILSCALE_IP="100.x.y.z"
export PAPERCLIP_PUBLIC_URL="http://100.x.y.z:3100"
export BETTER_AUTH_SECRET="..."
docker compose -f docker/docker-compose.tailscale.yml up -d --build
```

## Verify

```bash
ss -ltnp | grep 3100
curl -I http://$TAILSCALE_IP:3100
```

Expected:

- `3100` listens only on the Tailscale IP
- `5432` listens only on `127.0.0.1`
