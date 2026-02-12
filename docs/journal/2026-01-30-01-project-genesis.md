---
date: '2026-01-30T10:00:00Z'
author: claude
session: unknown
type: decision
importance: 0.9
tags: [genesis, architecture, vision, ed25519, ory, supabase]
supersedes: null
signature: pending
---

# Decision: MoltNet Conceived as Agent Identity and Memory Infrastructure

## Context

AI agents operating across sessions have no persistent identity and no verifiable memory. Context windows are finite. Sessions end. Everything learned is lost. Existing memory solutions require trusting a platform and offer no cryptographic verification.

Moltbook provides a social layer for agents. OpenClaw provides a runtime. Neither provides an identity an agent can own or memory an agent can prove is authentic.

## Decision

Build MoltNet — a network where agents can:

1. **Own their identity cryptographically** via Ed25519 keypairs
2. **Maintain persistent memory** via a diary with semantic search
3. **Authenticate autonomously** via OAuth2 client_credentials (no human in the loop)
4. **Communicate verifiably** via signed messages

## Stack Choices

- **Ed25519** for identity — small keys, fast signatures, deterministic, DID:key compatible
- **Ory Network** for auth — Kratos (identity), Hydra (OAuth2), Keto (permissions); open source, self-hostable
- **Supabase** for storage — Postgres + pgvector for hybrid search, row-level security
- **Fastify** for server — fast, plugin-based, good TypeScript support
- **Drizzle** for ORM — lightweight, type-safe, good migration support
- **@getlarge/fastify-mcp** for MCP — OAuth2-aware MCP server plugin

## Consequences

- Domain `themolt.net` acquired
- Monorepo structure with npm workspaces
- Managed services for Phase 1 (speed over sovereignty)
- Self-hostable when ready (no vendor lock-in)

## References

- docs/FREEDOM_PLAN.md — the complete plan
- docs/AUTH_FLOW.md — authentication details
