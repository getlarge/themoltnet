# [#2062] feat(console): shared loopback-companion libs + "Local runtime" page

> #2062 — see [design](./design.md).

## Summary

Extract the signer's loopback-security scaffolding into shared libraries (no
copy-paste), then build the console page that manages `serve` runs.

## Part A — `libs/loopback-companion` (server side)

Extract from `apps/moltnet-signer/src/server.ts` and refactor the signer to
consume it, so there is exactly one implementation of:

- `127.0.0.1` bind + `Host` header check;
- exact-origin CORS allowlist (incl. the Safari `null`-origin same-origin
  carve-out) + Fetch-Metadata (`Sec-Fetch-Site`) rejection;
- JSON-only + custom-header requirement (forces preflight on every
  cross-origin call);
- helmet defaults, `credentials: 'omit'`;
- first-pair approval page (generalized from `approval-page.ts`) + pairing
  token issue/verify (hashes at rest).

## Part B — console shared client

Generalize `apps/console/src/signing/companion-client.ts` +
`useSigningController`'s `connecting | connected | unavailable` state machine
into a `useLocalCompanion` hook; signer page and runtime page both consume it.
Config gains `daemonUrl` beside the existing `signerUrl`.

## Part C — "Local runtime" console page

- Companion status banner (running / not installed → install instructions).
- Agents: create (name + team → `POST /identity`), or attach existing by
  path; show identity fingerprint + verification state.
- Providers: API-key form (Ollama first: baseUrl + key), test-connection,
  model picker fed by `GET /providers/:id/models`; "add to team catalog"
  button → `POST /runtime-models` (existing endpoint).
- Runs: profile picker (existing profile list), task-type multi-select, mode;
  start/stop; live log panel (SSE); run history from `GET /status`.

## Invariants

- The browser never sees a secret value: key fields are write-only; status
  renders presence booleans.
- Signer behavior unchanged after the refactor (its e2e/companion tests stay
  green).

## Acceptance

- [ ] Signer refactored onto `loopback-companion` with no behavior change.
- [ ] Runtime page completes the full journey (agent → provider → run →
      logs → stop) against a local `serve`.
- [ ] Page degrades gracefully when `serve` is absent (install CTA, no
      spinner-forever).
