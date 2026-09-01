# [#2061] feat(agent-daemon): `serve` — loopback supervisor for console-managed runs

> #2061 — see [design](./design.md) for the full record.

## Summary

Add a `serve` subcommand to `@themoltnet/agent-daemon`: a per-user loopback
HTTP supervisor that stores agent/provider config as secret **references**,
spawns existing `poll`/`drain` invocations as child processes ("runs"), and
brokers Pi provider auth — so the console can start/stop local daemons with
zero hand-authored config.

## Scope

- `src/cli/serve.ts` + libs: config store under `~/.config/moltnet/`
  (`serve.json`, `agents/<name>.json` — `moltnet.json`-schema-compatible,
  `providers.json`, `pi/auth.json`, `secrets/` file-provider root,
  `runs/<id>/`).
- Routes: `GET /status`, `PUT /config`, `POST /identity`,
  `POST /providers/:id/login`, `GET /providers`,
  `GET /providers/:id/models`, `POST /runs`, `DELETE /runs/:id`,
  `GET /runs/:id/logs` (SSE).
- Run = child process running the **unchanged** `poll`/`drain` path with env
  assembled from stored refs (`MOLTNET_AGENT_KEY_REF`,
  `MOLTNET_PRIVATE_KEY_REF`, `MOLTNET_SECRET_ROOT`, resolved Pi provider key
  into `envName`, `PI_CODING_AGENT_DIR=runs/<id>/pi`). Stop = SIGTERM.
- Identity: new-agent flow (seed → file store under `identity/<fp>/seed` →
  SDK `register()` → `agent-key/<id>`) and existing-agent flow (path to
  `.moltnet/<agent>/moltnet.json`, verified via `whoami`, indexed — never
  copied).
- Pi config generation per run via a generalized `writePiConfig`
  (multi-provider; `auth.json` shared via symlink, models.json generated).
- Security: consumes the shared `loopback-companion` lib (issue 2); one-click
  first-pair approval per origin; pairing token on non-GET routes.

## Out of scope

Subscription OAuth flows (slice 4), installer (issue 3), catalog sync
(issue 4), any REST-API change, Windows.

## Invariants

- No secret value ever in `serve.json` / `agents/*.json` / `providers.json` /
  `models.json` / logs / `GET` responses (presence booleans only).
- Secret keys only via `libs/sdk/src/secrets.ts` canonical helpers.
- Identity is never trusted from local metadata alone — `whoami` verification
  on activation (per #1834's server-side-verification finding).
- `serve` refuses to start twice for the same user (lockfile).

## Acceptance

- [ ] Fresh machine, `serve` running: console can create an agent, start a
      `poll` run against a profile, watch logs, stop it — no terminal after
      launch.
- [ ] Existing `.moltnet/<agent>` reused by path; wrong-identity config
      rejected with the `whoami` mismatch surfaced.
- [ ] Child env contains resolved provider key; on-disk artifacts contain only
      refs/`$ENV_NAME`.
- [ ] Cross-origin request from a non-allowlisted origin: preflight-rejected;
      non-GET without pairing token: 401.
- [ ] SIGTERM on stop releases the lease (attempt does not expire as
      `lease_expired`).
- [ ] Second `serve` instance exits with a clear error.
