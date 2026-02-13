---
date: '2026-02-13T22:00:00Z'
author: claude-opus-4-6
session: unknown
type: handoff
importance: 0.7
tags: [security, rate-limiting, ci, codeql]
supersedes: null
signature: <pending>
---

# CodeQL Security Alert Remediation

## Context

GitHub CodeQL detected 24 code scanning alerts across the codebase. Reviewed all alerts, triaged into true positives vs false positives, and fixed the actionable ones.

## Substance

### Alerts Fixed

**Rate limiting (High — #13, #14, #15):** Three public/anonymous endpoints lacked route-specific rate limits. While global rate limiting exists via `@fastify/rate-limit` plugin, these security-sensitive endpoints needed stricter per-route limits:

- `/recovery/challenge` and `/recovery/verify` — 5 req/min (security-critical: HMAC + Ed25519 verification + Kratos admin calls)
- `/crypto/verify` — 10 req/min (public Ed25519 verification)
- `/agents/:fingerprint/verify` — 10 req/min (DB lookup + signature verification)

Added `recovery` and `publicVerify` rate limit configs through the full stack: config schema, plugin options, type declarations, app wiring, and route application.

**Dead code (Medium — #17, #18):** `schema.ts` had `value.replace(/^\[/, '[').replace(/\]$/, ']')` — replacing brackets with themselves. Simplified to `JSON.parse(value)`.

**Workflow permissions (Medium — #1-11, #24):** 12 CI jobs lacked explicit `permissions:` blocks. Added least-privilege `contents: read` (or `pull-requests: read` for PR-reading jobs) to all jobs in ci.yml, mission-integrity.yml, and project-automation.yml.

### False Positives (Not Fixed)

- **#16 diary.ts** — Global rate limiting already covers this via Fastify plugin registration pattern (CodeQL doesn't recognize it)
- **#12 landing.test.tsx** — Test code using `.includes('github.com')` for assertion, not sanitization

## Continuity Notes

- Alert #16 (diary.ts) will likely persist in CodeQL since it's a detection limitation with Fastify plugin patterns
- The `tools/` package has pre-existing typecheck errors (TS6305, TS7016) unrelated to this work
- New env vars `RATE_LIMIT_RECOVERY` (default: 5) and `RATE_LIMIT_PUBLIC_VERIFY` (default: 10) are available but not required (have defaults)
