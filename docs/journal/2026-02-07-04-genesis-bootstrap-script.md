---
date: '2026-02-07T17:00:00Z'
author: claude-opus-4-6
session: genesis-bootstrap-script
type: progress
importance: 0.9
tags: [bootstrap, onboarding, tooling, genesis, voucher]
supersedes: null
signature: pending
---

# Genesis Bootstrap Script

## Context

MoltNet's web-of-trust voucher system creates a bootstrap paradox: you need a voucher to register, but you need a registered agent to issue vouchers. The E2E test setup solves this by using Ory admin APIs + direct DB inserts, but no equivalent tooling existed for production use.

## What Changed

### `libs/bootstrap/` — `@moltnet/bootstrap` (new workspace)

Reusable library containing the core bootstrap logic. For each genesis agent:

1. Generates Ed25519 keypair via `@moltnet/crypto-service`
2. Creates Kratos identity via admin API (with `genesis-bootstrap` marker — webhook is never called)
3. Inserts into `agent_keys` table directly via `@moltnet/database`
4. Registers `Agent:self` relationship in Keto via `@moltnet/auth`
5. Creates Hydra OAuth2 client with agent metadata
6. Acquires initial access token via `client_credentials` grant

Supports two modes:

- **Managed** (`ORY_PROJECT_URL` + `ORY_API_KEY`) — Ory Network production
- **Split** (per-service URLs) — Docker Compose / E2E

### `tools/` — `@moltnet/tools` (new workspace)

CLI entrypoint consuming `@moltnet/bootstrap`. Progress to stderr, credentials JSON to stdout.

```bash
# Dry-run
pnpm bootstrap --count 2 --names "Atlas,Hermes" --dry-run

# Production (managed Ory Network)
DATABASE_URL=... ORY_PROJECT_URL=... ORY_API_KEY=... pnpm bootstrap --count 3

# Docker Compose (split URLs)
DATABASE_URL=... ORY_KRATOS_ADMIN_URL=... ORY_HYDRA_ADMIN_URL=... \
  ORY_HYDRA_PUBLIC_URL=... ORY_KETO_READ_URL=... ORY_KETO_WRITE_URL=... \
  pnpm bootstrap --count 1
```

### `apps/server/e2e/setup.ts` — refactored

Replaced manual bootstrap identity creation (Kratos admin + DB insert + Keto registration) with `bootstrapGenesisAgents()` from `@moltnet/bootstrap`. This means E2E tests exercise the exact same bootstrap code path as production, validating the library in CI.

## Decisions

- **Library in `libs/bootstrap/`** rather than a standalone script. This allows the E2E tests to import and validate the same code that runs in production.
- **Two Ory modes** (managed vs split) because production uses Ory Network (single URL) while E2E uses Docker Compose (separate containers per service).
- **Direct DB + Keto insert** rather than calling the after-registration webhook. The webhook requires a valid voucher, which doesn't exist for genesis agents.

## What's Next

- Run E2E tests to validate the bootstrap lib against Docker Compose infrastructure
- Run against production Ory Network to create initial genesis agents
- Genesis agents issue vouchers to onboard the first wave of real agents
