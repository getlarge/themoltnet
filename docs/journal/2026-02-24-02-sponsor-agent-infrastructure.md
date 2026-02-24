---
date: '2026-02-24T16:00:00Z'
author: claude-sonnet-4-6
session: legreffier-onboarding-287
type: handoff
importance: 0.8
tags: [legreffier, voucher, sponsor-agent, database, config, tdd]
supersedes: null
signature: <pending>
---

# Sponsor Agent Infrastructure — `issueUnlimited()` + `SPONSOR_AGENT_ID` Config

## Context

Issue #287 — LeGreffier one-command onboarding. This session covers Phase 1 server-side
infrastructure: the sponsor agent mechanism that will allow the onboarding workflow to
issue vouchers on behalf of new agents without hitting the `MAX_ACTIVE_VOUCHERS = 5` cap.

Branch: `claude/legreffier-onboarding-287`

## Substance

### What was built

**1. `issueUnlimited()` on `VoucherRepository`**
(`libs/database/src/repositories/voucher.repository.ts`)

New method alongside the existing `issue()`. Key differences:

- No `MAX_ACTIVE_VOUCHERS` check — always inserts
- Return type is `AgentVoucher` (never null), not `AgentVoucher | null`
- Plain `db.insert()` — no transaction wrapper needed (single statement is atomic)
- Same TTL (`VOUCHER_TTL_MS`) and code generation (`randomBytes(32).toString('hex')`)

Exported automatically via `ReturnType<typeof createVoucherRepository>` — no type changes needed.

**2. Integration tests for `issueUnlimited()`**
(`libs/database/__tests__/voucher.repository.integration.test.ts`)

Added to the existing integration test file (which previously only covered `issue`, `redeem`,
`findByCode`, `listActiveByIssuer`). Three new tests:

- Returns a valid voucher with all expected fields
- Succeeds when issuer is already at `MAX_ACTIVE_VOUCHERS` (cap bypass proven with real DB)
- Issued voucher is redeemable normally

**Important**: The integration test file was converted from `describe.runIf(DATABASE_URL)` to
a hard `throw new Error(...)` at module level if `DATABASE_URL` is unset. CI already provides
`DATABASE_URL`, so no CI breakage. Local devs without a DB get a clear error message rather
than silent skips.

**3. `SPONSOR_AGENT_ID` in server config**
(`apps/rest-api/src/config.ts`)

Added to `SecurityConfigSchema`:

```typescript
SPONSOR_AGENT_ID: Type.Optional(Type.String({ format: 'uuid' })),
```

- Optional — server boots without it
- UUID format enforced via TypeBox `FormatRegistry` (required because `Value.Check` doesn't
  auto-validate formats without registration)
- `FormatRegistry.Set('uuid', ...)` added at the top of `config.ts`, guarded by `Has()` to
  prevent double-registration
- Three config tests: absent → undefined, valid UUID → string value, empty string → undefined,
  invalid UUID → throws

**4. `env.local.example` and `env.public` documentation**

- `env.local.example`: new `# ── LeGreffier onboarding ──` section with commented
  `SPONSOR_AGENT_ID` placeholder pointing to `pnpm bootstrap --count 1 --names "Sponsor"`
- `env.public`: comment noting the secret lives in `.env`

### What was dropped

The `--sponsor` CLI flag in `bootstrap-genesis-agents.ts` was implemented and then removed.
The existing `pnpm bootstrap --count 1 --names "Sponsor"` command already creates exactly one
genesis agent — a dedicated flag adds no value. Use:

```bash
pnpm bootstrap --count 1 --names "Sponsor" > sponsor-credentials.json
# extract identityId from JSON
dotenvx set SPONSOR_AGENT_ID "<identityId>"
```

### Key decisions

- **`issueUnlimited()` as a separate method** (not `issue(issuerId, { skipLimit: true })`):
  explicit naming prevents the bypass from being accidentally forwarded from the `/vouch`
  route. Misuse is visible in code review.

- **Plain insert, no transaction**: `issueUnlimited` is a single `INSERT` — no preceding
  `SELECT` means `SERIALIZABLE` adds overhead with zero correctness benefit.

- **`SPONSOR_AGENT_ID` is optional at startup**: the server starts without it. The upcoming
  `/public/legreffier/start` endpoint will 503 at request time if unset. This avoids breaking
  local dev environments that don't have a sponsor agent.

- **UUID format validation**: `format: 'uuid'` chosen over `pattern` regex — the project
  already uses `Type.String({ format: 'uuid' })` throughout `schemas.ts`. The `FormatRegistry`
  registration is the correct fix (not `skipLibCheck` or a manual regex).

- **Hard throw on missing DATABASE_URL**: per project preference, integration tests must not
  silently skip. Converted the outer `describe.runIf()` to a module-level throw.

## Continuity Notes

### What's next (Phase 2 — onboarding workflow)

From the issue #287 implementation plan:

**Server:**

- `legreffier-onboarding-workflow.ts` — DBOS workflow with 7 steps
- `POST /public/legreffier/start` — rate-limited (3/IP/day), starts workflow, returns
  `{ workflowId, manifestFormUrl }`
- `GET /public/legreffier/callback` — GitHub App manifest redirect target, calls `DBOS.send`
- `GET /public/legreffier/status/:workflowId` — CLI polling endpoint
- `POST /public/legreffier/complete` — final ack from CLI
- `GET /public/skills/:name` — serve versioned skill markdown

**CLI (Phase 2 — separate issue):**

- `moltnet legreffier init [--name <name>]` command

### Current state

- Branch: `claude/legreffier-onboarding-287`
- All unit tests pass (223 in rest-api, 50 in database)
- Integration tests require `DATABASE_URL` (will run in CI)
- Lint: clean
- Typecheck: clean
- NOT yet validated end-to-end (no Docker stack running in this session)

### Where to start next

1. Read `apps/rest-api/src/workflows/registration-workflow.ts` — the onboarding workflow
   follows the same DBOS pattern
2. Read `apps/rest-api/src/plugins/dbos.ts` — how to register a new workflow
3. The `SPONSOR_AGENT_ID` is available via `config.security.SPONSOR_AGENT_ID` in any
   route or workflow that has access to the Fastify instance config
4. Rate limiting pattern for public endpoints: see `apps/rest-api/src/routes/public/`
