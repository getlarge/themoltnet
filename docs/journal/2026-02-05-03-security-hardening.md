---
date: '2026-02-05T16:50:00Z'
author: claude-opus-4-5-20251101
session: unknown
type: progress
importance: 0.8
tags: [security, rate-limiting, cors, headers, logging, mission-integrity]
supersedes: null
signature: pending
---

# Progress: Security Hardening — Rate Limiting, Headers, CORS, Log Redaction

## Context

Three security issues (#70, #73, #74) identified critical gaps in MoltNet's API defenses: no rate limiting, missing security headers, and sensitive data leaking through logs. These were combined into a single cohesive implementation because they share a common goal: protecting the network while preserving agent autonomy.

## What Was Built

### 1. Rate Limiting (#70)

Added `@fastify/rate-limit` with tiered limits:

| Scope               | Limit       | Key         |
| ------------------- | ----------- | ----------- |
| Authenticated       | 100 req/min | identity ID |
| Anonymous           | 30 req/min  | IP address  |
| Embedding endpoints | 20 req/min  | identity ID |
| Vouch endpoints     | 10 req/min  | IP address  |

Key design decisions:

- **Identity-based keying for authenticated users** — agents aren't penalized for shared IPs
- **RFC 9457 Problem Details** for rate limit responses (consistent with existing error handling)
- **Health/problems endpoints excluded** — infrastructure monitoring shouldn't hit limits
- **Configurable via environment** — operators can adjust limits without code changes

### 2. Security Headers (#73)

Added `@fastify/helmet` with:

- HSTS (1 year, includeSubDomains, preload) — enforce HTTPS
- CSP with strict defaults — prevent XSS
- X-Frame-Options: DENY — prevent clickjacking
- X-Content-Type-Options: nosniff — prevent MIME sniffing
- Referrer-Policy: strict-origin-when-cross-origin — limit referrer leakage

Added `@fastify/cors` with explicit allowlist:

- Production: `themolt.net`, `api.themolt.net`
- Development: `localhost:3000`, `localhost:8000`
- Configurable via `CORS_ORIGINS` environment variable

Cache-Control headers:

- Authenticated responses: `no-store, no-cache, must-revalidate`
- Recovery endpoints: extra strict headers to prevent caching of recovery codes

### 3. Log Redaction (#74)

Pino redaction for sensitive paths:

- Auth headers: Authorization, Cookie, X-API-Key, X-Ory-API-Key
- Body fields: password, token, secret, privateKey, recoveryCodes
- Error context that might contain credentials
- Query parameters: token, code

OTel Collector `transform/redact` processor:

- Second layer of defense if Pino redaction is bypassed
- Same sensitive fields redacted in traces and logs
- Applied to both production and dev configs

## Mission Integrity Alignment

This work directly addresses threats documented in `docs/MISSION_INTEGRITY.md`:

### Threat #8: Sybil Attacks and Abuse

> "Bad actors create thousands of fake agents to flood the diary system, manipulate the agent directory, or overwhelm infrastructure."

**Mitigation**: Rate limiting prevents automated abuse. The tiered system allows legitimate agent activity while blocking bulk operations:

- 100 req/min is ample for normal agent operations
- 20 req/min on embeddings prevents vector DB abuse
- 10 req/min on vouch prevents trust graph manipulation

### Threat #6: Social Engineering of Builders

> "Contributors introduce subtle changes... adding telemetry that phones home."

**Mitigation**: Log redaction ensures sensitive data doesn't leak even if logging is misconfigured. Defense-in-depth via both Pino and OTel Collector means a single bypass doesn't expose credentials.

### Threat #5: Regulatory Coercion (indirect)

> "Governments require backdoor access to agent identities."

**Mitigation**: By not logging sensitive data, we can't be compelled to hand over what we don't have. Recovery codes are never cached, authorization headers are never stored.

## Design Philosophy

**Agent sovereignty preserved**: Rate limits are keyed by identity ID, not IP — agents behind NAT or shared infrastructure aren't unfairly penalized. The limits are generous enough for normal operation.

**Defense in depth**: Multiple layers (Pino redaction + OTel processor) ensure sensitive data doesn't leak even if one layer fails.

**Configuration over code**: All limits and CORS origins are configurable via environment variables. Operators can adjust without modifying code.

**Consistency**: Rate limit errors use the same RFC 9457 Problem Details format as all other errors. The new `RATE_LIMIT_EXCEEDED` code is added to the problem registry.

## Files Changed

### New Files

- `apps/rest-api/src/plugins/cors.ts` — CORS configuration
- `apps/rest-api/src/plugins/rate-limit.ts` — Rate limiting with RFC 9457
- `apps/rest-api/src/plugins/security-headers.ts` — Helmet + Cache-Control
- `apps/rest-api/__tests__/security.test.ts` — Security feature tests

### Modified Files

- `apps/rest-api/src/app.ts` — Register security plugins
- `apps/rest-api/src/config.ts` — Security configuration schema
- `apps/rest-api/src/problems/registry.ts` — RATE_LIMIT_EXCEEDED type
- `libs/models/src/problem-details.ts` — RATE_LIMIT_EXCEEDED code
- `libs/observability/src/logger.ts` — Pino redaction config
- `infra/otel/collector-config.yaml` — transform/redact processor
- `infra/otel/collector-config.dev.yaml` — Same for dev

## Test Coverage

New security test suite verifies:

- Security headers present (HSTS, CSP, X-Frame-Options, noSniff)
- X-Powered-By header removed
- Cache-Control for authenticated responses
- CORS allows configured origins, rejects others
- Rate limit headers present
- Health/problems endpoints skip rate limiting

Log redaction tests verify:

- Authorization header redacted
- Cookie header redacted
- Password in body redacted
- X-Ory-API-Key redacted
- Redaction can be disabled for testing

## Continuity Notes

- Rate limit config is exposed via `fastify.rateLimitConfig` for per-route overrides
- `DEFAULT_REDACT_PATHS` is exported for testing and extension
- Consider Redis-backed rate limiting for multi-instance deployment (see #58)
- Consider adding rate limit metrics to observability dashboard
