# Paperclip ↔ OpenClaw bridge-directory plan

## Goal

Run Paperclip in Docker without making it depend on or mutate general OpenClaw workspace contents.

## Target model

Keep three storage zones separate:

1. **Paperclip-owned**
   - Container-local or Paperclip host-mounted paths only
   - Issue workspaces, run logs, managed checkouts, internal state

2. **OpenClaw-owned**
   - OpenClaw workspace only
   - Sessions, local state, agent scratch/work products

3. **Shared bridge**
   - Small explicit directory mounted into both runtimes
   - Only protocol artifacts live here
   - Example host path: `/home/openclaw/.local/share/paperclip-openclaw-bridge`

## Recommended bridge layout

```text
/home/openclaw/.local/share/paperclip-openclaw-bridge/
  claimed-keys/
    <companyId>/
      <agentId>.json
  runs/
    <runId>/
      wake-context.json
      result.json
      status.json
  handoff/
    <runId>.json
```

Notes:
- Keep file names deterministic.
- Avoid putting arbitrary session/workspace files here.
- Treat everything in this directory as a protocol artifact, not private runtime state.

## Mount strategy

### Paperclip container
- Mount Paperclip data dirs as today.
- Add bridge mount, for example:
  - host: `/home/openclaw/.local/share/paperclip-openclaw-bridge`
  - container: `/paperclip/bridge`

### OpenClaw host/runtime
- Read the same host path directly, or mount it as:
  - `~/.local/share/paperclip-openclaw-bridge`

## Config changes

Add an explicit bridge path setting instead of assuming `~/.openclaw/workspace/...`.

Suggested env/config names:
- `PAPERCLIP_OPENCLAW_BRIDGE_DIR`
- `PAPERCLIP_CLAIMED_API_KEY_PATH` (optional override)

Resolution rule:
1. Use explicit claimed-key path if set.
2. Else derive from bridge dir.
3. Only fall back to legacy `~/.openclaw/workspace/paperclip-claimed-api-key.json` for compatibility.

## Code changes

### Paperclip adapter
File:
- `packages/adapters/openclaw-gateway/src/server/execute.ts`

Change:
- Stop defaulting claimed-key output to `~/.openclaw/workspace/paperclip-claimed-api-key.json`.
- Resolve output from bridge config.
- Keep mode readable by both runtimes.

Suggested default behavior:
- claimed key path = `${PAPERCLIP_OPENCLAW_BRIDGE_DIR}/claimed-keys/${companyId}/${agentId}.json`

### Wake payload/instructions
- Tell OpenClaw the bridge path explicitly.
- Avoid implying Paperclip can inspect or reuse OpenClaw workspace internals.

### OpenClaw side
- Read claimed-key artifacts from the bridge path.
- If needed, support a single env var for discovery instead of hardcoded workspace-relative assumptions.

## Permission model

Preferred:
- Shared group or ACL on bridge directory
- Narrow write permissions only on the bridge subtree

Avoid:
- Broad write access to OpenClaw workspace from Paperclip
- Broad write access to Paperclip internal data from OpenClaw

Practical minimum:
- directory writable by both runtimes
- protocol files readable by both runtimes
- everything else private to its owner

## Backward-compatible rollout

1. Add bridge-dir config support.
2. Teach Paperclip adapter to write to bridge dir first.
3. Teach OpenClaw to read from bridge dir.
4. Keep legacy workspace-path fallback temporarily.
5. Validate end-to-end.
6. Remove legacy fallback after stable rollout.

## Validation checklist

- Paperclip can write claimed key into bridge dir.
- OpenClaw can read claimed key from bridge dir.
- `/api/agents/me` authenticates with the claimed JWT.
- Paperclip can complete issue checkout/comment/update.
- No Paperclip writes occur under general OpenClaw workspace.
- No OpenClaw writes occur under Paperclip private state unless explicitly intended.

## Why this is better

- Less cross-runtime coupling
- Fewer UID/GID surprises
- Clear ownership boundaries
- Easier Docker portability
- Easier future replacement of either side without hidden filesystem assumptions
