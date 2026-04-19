# Paperclip Tailscale Docker Runbook

Run Paperclip in Docker while exposing the app only on the host's Tailscale interface.

## Goals

- keep OpenClaw untouched on its existing Tailscale Serve route
- expose Paperclip only on the host's Tailscale IP
- make deployment repeatable for both `prod` and `test`
- keep app and database data persistent across Docker restarts and host reboots

## Isolation model

- OpenClaw stays on Tailscale Serve, currently proxied from `/` to `127.0.0.1:18771`
- Paperclip does not use Tailscale Serve on this host
- Paperclip binds directly to the host Tailscale IPv4 only
- Postgres binds to localhost only

This avoids clobbering the existing OpenClaw route and keeps Paperclip tailnet-only.

## Deployment files

- `docker/docker-compose.tailscale-stack.yml`
- `scripts/deploy-paperclip-docker-env.sh`
- `scripts/run-paperclip-tailscale-docker.sh` (compat wrapper for `prod`)

## Environments

`prod`
- app URL: `http://<tailscale-ip>:3100`
- db host port: `127.0.0.1:5432`
- compose project: `paperclip-prod`
- config: `~/.config/paperclip/prod/runtime.env`
- data: `~/.local/share/paperclip/prod/`

`test`
- app URL: `http://<tailscale-ip>:3101`
- db host port: `127.0.0.1:5433`
- compose project: `paperclip-test`
- config: `~/.config/paperclip/test/runtime.env`
- data: `~/.local/share/paperclip/test/`

## Persistence

Persistence comes from two layers:

1. Docker service is enabled on the host
2. Compose services use `restart: unless-stopped`

That means active envs restart after Docker daemon restarts or host reboot.

## Commands

Bring up prod:

```bash
./scripts/deploy-paperclip-docker-env.sh prod up
```

Bring up test:

```bash
./scripts/deploy-paperclip-docker-env.sh test up
```

Restart prod after branch changes:

```bash
./scripts/deploy-paperclip-docker-env.sh prod restart
```

Restart test after branch changes:

```bash
./scripts/deploy-paperclip-docker-env.sh test restart
```

Check status:

```bash
./scripts/deploy-paperclip-docker-env.sh prod ps
./scripts/deploy-paperclip-docker-env.sh test ps
```

Tail logs:

```bash
./scripts/deploy-paperclip-docker-env.sh prod logs
./scripts/deploy-paperclip-docker-env.sh test logs
```

Stop an env:

```bash
./scripts/deploy-paperclip-docker-env.sh prod down
./scripts/deploy-paperclip-docker-env.sh test down
```

Bootstrap first admin invite after onboarding exists:

```bash
./scripts/deploy-paperclip-docker-env.sh prod bootstrap-ceo
```

## What the deploy script manages

For each env it:

- derives the current Tailscale IPv4 address
- writes runtime env to `~/.config/paperclip/<env>/runtime.env`
- preserves `BETTER_AUTH_SECRET` across redeploys
- uses a stable compose project name per env
- stores Paperclip and Postgres data under `~/.local/share/paperclip/<env>/`
- sets `BETTER_AUTH_BASE_URL` from `PAPERCLIP_PUBLIC_URL` through compose so auth redirects stay correct over Tailscale

## Verify

```bash
ss -ltnp | egrep '(:3100|:3101|:5432|:5433)'
curl -I http://$(tailscale ip -4 | head -n1):3100
```

Expected for prod:

- `3100` listens only on the Tailscale IP
- `5432` listens only on `127.0.0.1`

Expected for test when enabled:

- `3101` listens only on the Tailscale IP
- `5433` listens only on `127.0.0.1`
