# Local runtime management from the console — `moltnet-agent serve`

> Design record for the "manage local daemons from the browser console" track.
> Settled in the 2026-09-01 design session. Companion sub-briefs:
> filed issues: [#2061](https://github.com/getlarge/themoltnet/issues/2061) [#2062](https://github.com/getlarge/themoltnet/issues/2062) [#2063](https://github.com/getlarge/themoltnet/issues/2063) [#2064](https://github.com/getlarge/themoltnet/issues/2064) and the
> [macOS signing & packaging plan](../macos-signing-and-packaging-plan.md).

## Goal

Start and stop local agent daemons — with the right identity, team, runtime
profile, and LLM provider auth — entirely from the MoltNet console, with one
installer and zero hand-authored config. Primary consumer: the "learn agentic
flows" course; secondary: any operator running daemons on a workstation.

## Non-goals (v1)

- No #1859 machinery: no outbound relay, no session host, no remote steering.
  The console page works only on the machine running `serve` (loopback).
- No #1412 dependency (budgets ship independently).
- No Windows.
- No REST-API changes. Run specs are **local-only**; remote visibility comes
  from what runs already emit (runtime slots, attempt heartbeats, task
  messages).
- No LLM gateway. Providers are the user's own (API key or subscription OAuth).

## Architecture

One **per-user supervisor singleton** on a fixed loopback port:

```
npx @themoltnet/agent-daemon serve      # dev; installer registers it as a LaunchAgent
```

"A daemon" is a **run** the supervisor owns: `{agent, team, profile,
taskTypes, mode: poll|drain}`. Each run is a spawned `poll`/`drain` **child
process** using the existing CLI path unchanged (env-var agent-key auth,
profile resolution, slots, telemetry). Stop = SIGTERM → the daemon's existing
shutdown handling releases leases cleanly. Multiple runs, one port; no
port-per-daemon discovery problem. Two runs may share an agent identity
(daemon-slot identity disambiguates claimants).

### HTTP surface (loopback only)

| Route | Purpose |
| --- | --- |
| `GET /status` | version, platform, config **presence booleans** (never values), run list |
| `PUT /config` | store/patch agent + provider config (references, not secrets where possible) |
| `POST /identity` | generate Ed25519 seed locally → keyring/file store → SDK `register()`; or validate an existing `.moltnet/<agent>/moltnet.json` **path** against `whoami` and index it |
| `POST /providers/:id/login` | broker a Pi subscription OAuth flow (see below) |
| `GET /providers` / `GET /providers/:id/models` | provider status + discovered model list |
| `POST /runs` / `DELETE /runs/:id` | spawn / stop a run |
| `GET /runs/:id/logs` | SSE tail of child stdout |

### Security profile

Extracted into a shared `loopback-companion` lib (from
`apps/moltnet-signer/src/server.ts`, which the signer is refactored to
consume):

- bind `127.0.0.1` only; `Host` header check;
- exact-origin CORS allowlist + Fetch-Metadata (`Sec-Fetch-Site`) rejection;
- JSON-only routes with a custom header → every cross-origin call preflights;
- `credentials: 'omit'`; no cookies ever;
- **one-click first-pair approval per origin** (signer `approval-page.ts`
  pattern; no typed codes). The issued pairing token authorizes subsequent
  non-GET calls — it exists for shared-machine cross-user protection and to
  bind "this console session is the operator", not for browser-vs-browser
  isolation (origin checks already cover that).

## Config store (embryo of #1834 — handle with care)

```
~/.config/moltnet/
  serve.json            # port, paired origins + pairing-token hashes
  agents/<name>.json    # public identity metadata + secret REFERENCES; moltnet.json-compatible fields
  providers.json        # Pi provider registry (below)
  pi/auth.json          # shared Pi OAuth/API-key credential file (pi lockfiles it)
  secrets/…             # FileSecretProvider root (0600), until keyring upgrade
  runs/<id>/            # run spec, generated PI_CODING_AGENT_DIR (models.json, settings.json symlink→../pi/auth.json), logs
```

**Anti-debt disciplines** (so #1834 absorbs this store instead of replacing
it):

1. `agents/<name>.json` reuses `moltnet.json`'s schema — no new invented shape.
2. Secret keys only via the canonical helpers in `libs/sdk/src/secrets.ts`
   (`identity/<fp>/seed`, `agent-key/<id>`, …) — never string-built.
3. The index is derived/rebuildable, never authoritative for identity:
   activation always re-verifies against the API (`whoami`) — the server-side
   check #1834's 2026-08-30 update mandates.

### Secrets: file store now, keyring on signed bundle

Default backend v1: SDK `FileSecretProvider` with
`MOLTNET_SECRET_ROOT=~/.config/moltnet/secrets` (0600). Rationale: keytar under
`npx` binds macOS Keychain ACLs to the **system node** signature — any node
script inherits the grant, and prompts say "node". Once the signed bundle
ships (see the packaging plan), `serve` migrates entries to
`os-keyring:` refs — same canonical keys, different provider prefix — and the
Keychain ACL binds to the MoltNet-signed binary. Go CLI interop is preserved
either way (same service `themolt.net`, same account naming; see
`apps/moltnet-cli/internal/oskeyring` + `testdata/keyring-interop`).

### Where the Ollama (or any Pi provider) API key lives — precisely

`providers.json` holds the **reference and metadata, never the value**:

```json
{
  "ollama": {
    "api": "openai-completions",
    "baseUrl": "https://ollama.com/v1",
    "envName": "OLLAMA_API_KEY",
    "apiKeyRef": "file:pi-provider/ollama"
  }
}
```

- **What**: the value sits at `~/.config/moltnet/secrets/pi-provider/ollama`
  (0600; later `os-keyring:pi-provider/ollama`).
- **When resolved**: (a) provider "test connection", (b) model discovery
  calls, (c) `POST /runs` spawn.
- **Where the value goes**: `serve` process memory → the **child process env**
  as `OLLAMA_API_KEY=<value>`. Never written to `providers.json`, never to
  `models.json` (which carries only `"apiKey": "$OLLAMA_API_KEY"`), never to
  logs (reuse the daemon's secret-redaction on the run env). Subscription
  OAuth providers are the exception: pi owns their persistence in
  `pi/auth.json` (0600) because pi must rotate refresh tokens itself.

## Identity flows

- **New agent**: console sends name + team → `serve` generates the seed,
  stores it under `identity/<fp>/seed`, calls SDK `register()`
  (`libs/sdk/src/register.ts`), stores the agent key under
  `agent-key/<id>`, writes `agents/<name>.json` with refs. Seed never leaves
  the machine or touches the browser. Children get
  `MOLTNET_PRIVATE_KEY_REF` / `MOLTNET_AGENT_KEY_REF`.
- **Existing agent**: console sends a **path** to `.moltnet/<agent>/moltnet.json`
  (already reference-based) → `serve` verifies via `whoami`, indexes it. No
  secret is moved or pasted. No filesystem scanning.

## Pi model + auth config (fully generated, no pi CLI)

- `models.json`/`settings.json` per run via `writePiConfig`
  (`libs/agent-eval/src/pi-config.ts`) generalized to multi-provider.
- **Subscription OAuth brokered by `serve`** using
  `@earendil-works/pi-ai/oauth` (verified 0.79.4): `loginAnthropic({onAuth})`
  hands `serve` the authorize URL (console opens the tab; pi's flow runs its
  own `localhost:53692` callback server), `loginOpenAICodex`
  (`localhost:1455` + paste fallback), `loginGitHubCopilot` (device code —
  console just displays it). Persistence via
  `AuthStorage.create(authPath).login(providerId, callbacks)` /
  `.set(provider, credential)` into `pi/auth.json`. Refresh is free at run
  time (children read the same file; pi rotates with its lockfile).
- ToS note: subscription OAuth tokens are provider-gray-zone exactly as they
  are for pi itself; we inherit pi's position, documented, not silently.

## Model discovery → runtime-models catalog

`serve` enumerates models from the provider itself (Ollama `GET /api/tags`,
cloud equivalents) — users pick from a fetched list, never type model IDs.
The same discovery module has two more consumers:

- console "add to **team** catalog" → `POST /runtime-models` (exists,
  team-scoped);
- a scheduled `tools/` admin job syncing **global** catalog rows (global rows
  are API-read-only by design, so this must be an internal job).

## Why no CLI changes are needed (verified)

The runtime-side `moltnet` CLI never reads agent credentials:

- Guest signing: the guest projection runs
  `moltnet capability serve agent-signing --adapter ssh-agent --socket
  /run/moltnet/signer.sock` **as a credential-free protocol adapter** —
  `apps/moltnet-cli/capability.go` states adapters "carry no MoltNet semantics
  and no credentials"; broker-backed mode (`MOLTNET_SIGNER_URL` set, always
  true in the guest) keeps the seed on the host and forwards sign requests to
  the host capability origin.
- Host exec: `resolveHostExecBaseEnv` strips **every** `MOLTNET_*` name plus a
  refused-list before any host command runs.

Authority flows from the daemon inward via brokered capabilities. `serve`'s
store is read by the daemon only. Teaching the human-facing CLI to discover
`~/.config/moltnet/agents/` is #1834's scope, later.

## Packaging

See [macOS signing & packaging plan](../macos-signing-and-packaging-plan.md).
Summary: `curl -fsSL https://get.themolt.net | sh` first (notarized tarball →
`~/.local/share/moltnet/`, LaunchAgent for `serve`), signed `.pkg` second;
Apple enrollment started 2026-09-01; `yao-pkg/pkg` spike for a single-binary
`serve` (one signed executable = one Keychain requester), fallback = re-signed
bundled Node in a `runtime/` folder. Manual-install list eliminated: Node,
`qemu-img`, krun runner/libkrun all ship in the payload; `serve` self-heals
missing components (same pattern `sandbox-gondolin/snapshot.ts` uses for `gh`
and the CLI).

## Delivery slices

1. `serve` command + store + run lifecycle (no providers yet; API-key env
   passthrough only) + shared `loopback-companion` lib.
2. Console page (shared `useLocalCompanion` hook + runtime page): pair,
   identity flows, run start/stop/logs.
3. Provider registry: API-key providers + model discovery + generated
   models.json; team-catalog push.
4. Subscription OAuth brokering (Anthropic, OpenAI Codex, Copilot).
5. Installer + signing pipeline; keyring migration switch.
6. `tools/` global catalog sync job.
