---
date: '2026-02-07T18:30:00Z'
author: claude-opus-4-6
session: genesis-bootstrap-script
type: handoff
importance: 0.9
tags: [bootstrap, onboarding, tooling, genesis, voucher, handoff]
supersedes: null
signature: pending
---

# Handoff: Genesis Bootstrap Script

## What Was Done

Created the genesis bootstrap tooling to solve MoltNet's bootstrap paradox (need a voucher to register, need a registered agent to issue vouchers).

### New packages

- **`libs/bootstrap/`** (`@moltnet/bootstrap`) — Reusable library with `bootstrapGenesisAgents()`. Supports managed Ory Network (single URL + API key) and split Docker Compose (per-service URLs). Creates Kratos identity, inserts into `agent_keys`, registers in Keto, creates OAuth2 client, acquires token.
- **`tools/`** (`@moltnet/tools`) — CLI entrypoint. Progress to stderr, credentials JSON to stdout.

### Modified

- **`apps/server/e2e/setup.ts`** — Refactored to use `@moltnet/bootstrap` for the genesis agent, replacing manual Kratos/DB/Keto calls. E2E tests now exercise the same bootstrap code path as production.
- **`CLAUDE.md`** — Added `tools/`, `libs/bootstrap/`, and `pnpm bootstrap` command.

## What's Not Done

- E2E tests haven't been run against Docker Compose yet (requires `docker compose -f docker-compose.e2e.yaml up -d --build`)
- No production run yet — need actual `DATABASE_URL`, `ORY_PROJECT_URL`, `ORY_API_KEY`
- PR not yet created

## Current State

- **Branch**: `claude/genesis-bootstrap-script` — pushed to origin
- **Based on**: `main` at `1813ed8`
- **Typecheck**: All workspaces pass
- **Lint**: Clean (only expected `no-console` warnings in CLI tool)
- **Issue**: #114 — assigned

## Decisions

- Library in `libs/bootstrap/` so E2E tests can import and validate the same code
- Two Ory modes (managed vs split) via discriminated union config
- Direct DB + Keto insert (bypasses voucher-gated webhook)
- `tools/` as separate workspace for CLI tools (not in `scripts/`)

## Open Questions

- Should genesis agents have special scopes or permissions beyond the default set?
- Should the script support a `--verify` flag to test the created agent can call `/vouch`?

## Where to Start Next

1. Run `pnpm run validate` and E2E tests to confirm everything passes
2. Create PR from `claude/genesis-bootstrap-script`
3. Run against production Ory Network to create the first genesis agents
4. Have genesis agents issue vouchers to onboard the initial wave
