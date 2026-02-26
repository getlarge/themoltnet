---
date: '2026-02-26T00:00:00Z'
author: claude-sonnet-4-6
session: claude/legreffier-init-cli-287
type: handoff
importance: 0.9
tags: [legreffier-cli, onboarding, ink, ux, idempotency, github-app]
supersedes: 2026-02-24-04-legreffier-onboarding-workflow.md
signature: <pending>
---

# LeGreffier Init CLI — Full Happy Path + Polished UX

## Context

Issue #287: implement `legreffier init` — the CLI that walks a user through registering their AI agent on MoltNet: keypair generation, GitHub App creation, installation, and agent setup. This session continued from a previous session that had built the initial implementation and was doing E2E testing against a live Docker + Tailscale stack.

## Substance

### Bugs Fixed During E2E Testing

**Name availability check on resume**
On resume after a crash, `runIdentityPhase` was re-running the app-name uniqueness check even though the workflow was still alive. Root cause: the early idempotency guard required both `keys.public_key` AND `oauth2.client_id` in config, but a crash after key generation but before GitHub App creation left config with keys and empty `client_id`.

Fix: added `checkWorkflowLive(baseUrl, workflowId)` — polls the status endpoint, returns `false` on 404/error (expired or unknown workflow). On live workflow: skip name check and resume. On expired workflow: clear state and start fresh.

**Missing config on resume (`exportSSHKey` crash)**
State had `workflowId` + `publicKey` + `fingerprint` but no `privateKey`; config was never written because the crash happened before `runIdentityPhase` completed its write.

Fix: added `privateKey: string` (required) to `LegreffierInitState`; stored it in all `writeState` calls; on resume, write config from state data if `moltnet.json` is missing.

**`lookupBotUser` 404 before installation**
`<appSlug>[bot]` GitHub user only exists after the first app installation. But `runGitSetupPhase` called it before installation.

Fix: try `<appSlug>[bot]` first, fall back to plain `<appSlug>` (exists immediately after app creation).

**Installation URL not shown in SSH mode**
`open()` silently fails over SSH. Added `installationUrl` to UI state; dispatched before calling `open()`; displayed as a fallback URL with a 2-second delay (same pattern as manifest form URL).

### UX Redesign

After confirming the happy path worked, the user requested a polished, "wow-effect" UI:

**`CliHero` component** (`libs/design-system/src/cli/CliHero.tsx`)
ASCII quill feathers (amber gradient) + MOLTNET wordmark inside an animated teal halo ring. The ring pulses through 4 teal shades; a shimmer line cycles 3 patterns inside the halo. Animation is controlled by the `animated` prop (default `false`) to prevent flicker during setup phases where the Ink spinner is already running.

**`CliDisclaimer` component** (`libs/design-system/src/cli/CliDisclaimer.tsx`)
Gated screen shown before any work begins. Two bordered boxes:

1. GitHub App permissions — read access to metadata, no write access by default, user-controlled installation, revocable
2. MoltNet data storage — agent identity always stored; diary entries at three visibility levels:
   - `private` — owner only, not indexed
   - `moltnet` — network agents + indexed; diaries can also be shared with specific agents
   - `public` — anyone + indexed
   - Private entries can be encrypted but lose indexing power; local encryption + indexing is on the roadmap

**`CliSummaryBox` component** (`libs/design-system/src/cli/CliSummaryBox.tsx`)
Completion card with green border: Name, Fingerprint, GitHub App URL, API URL, MCP URL.

**`InitApp.tsx` changes**

- New `disclaimer` phase as the initial phase; accepted state drives the main flow via `useEffect([accepted])`
- Future phases visually distinct using `status='pending'` override on `CliStatusLine` (Ink only supports `dimColor` on `<Text>`, not `<Box>`)
- Delayed fallback URLs: 2-second `setTimeout` via `useRef` + `useState`
- Summary dispatched before `done` phase; process exits after 3s on done
- Hero is only animated on the disclaimer screen

### State Test Fix

`state.test.ts` fixtures were missing the new required `privateKey` field. Fixed all 4 affected test fixtures.

### Commits on Branch

```
97237b1 feat(legreffier-cli): polished UX — hero banner, disclaimer, summary, delayed fallback URLs
7744904 feat(legreffier-cli): robust resume, name availability, installation URL display
0809c38 feat(rest-api): rate limiting, identityId in status, githubCode on awaiting_installation
45c85d9 Revert "fix(rest-api): embed manifest via JS string literal to avoid HTML escaping issues"
ba673b2 fix(rest-api): embed manifest via JS string literal to avoid HTML escaping issues
019066e fix(rest-api): fix CSP blocking GitHub manifest form + require explicit click
... (14 earlier commits building the full CLI from scratch)
```

## Continuity Notes

**What's done:**

- Full E2E happy path confirmed working locally (Docker + Tailscale tunnel)
- Idempotency handles: full skip (config complete), partial resume (workflow alive + keys in state/config), expired workflow (clear + fresh start), crash after GitHub App creation
- UX: disclaimer gate → animated hero → phase steps → rich completion summary
- All commits typecheck clean; `tools/` typecheck failure pre-exists on `main` (missing `dist/` from app builds)

**What's not done:**

- E2E test suite (mocked GitHub responses) — replaces original Task 10 (Go CLI subcommand, removed by user)
- CI config + release-please config for `@themoltnet/cli` npm publishing — Task 11
- Landing page mention of encryption/indexing trade-off — user raised as a thought, not a firm request

**Where to start next:**

1. Write e2e tests with mocked GitHub API responses for `runIdentityPhase`, `runGithubAppPhase`, `runInstallationPhase`, `runAgentSetupPhase`
2. Or skip to Task 11: add `@themoltnet/legreffier` to `release-please-config.json` + `.release-please-manifest.json`, add `publish-legreffier` job to `.github/workflows/release.yml`, then open the PR

**Key files:**

- `packages/legreffier-cli/src/InitApp.tsx` — main Ink component, all phase logic
- `packages/legreffier-cli/src/api.ts` — REST API client, `checkWorkflowLive()`
- `packages/legreffier-cli/src/state.ts` — `LegreffierInitState` (now includes `privateKey`)
- `packages/legreffier-cli/src/github.ts` — `lookupBotUser()` with `[bot]` fallback
- `libs/design-system/src/cli/CliHero.tsx` — animated ASCII hero
- `libs/design-system/src/cli/CliDisclaimer.tsx` — gated disclaimer screen
- `libs/design-system/src/cli/CliSummaryBox.tsx` — completion summary card
