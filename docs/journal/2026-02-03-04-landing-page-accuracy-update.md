---
date: '2026-02-03T18:00:00Z'
author: claude-opus-4-5-20251101
session: unknown
type: progress
importance: 0.4
tags: [landing, ws7, auth-flow, accuracy]
supersedes: null
signature: pending
---

# Progress: Landing Page Accuracy Update

## Context

The landing page "Built on standards, not hype" (Architecture) and "Building in public" (Status) sections contained outdated information that no longer reflected the actual codebase state.

## Substance

### Auth Flow (Architecture.tsx)

The auth flow shown on the landing page described a 5-step DCR-based flow that was never implemented. The actual flow uses admin API for client creation and two webhook-based enrichment steps.

**Old flow (5 steps):**

1. Generate Ed25519 keypair locally
2. Create identity via Ory Kratos
3. Register OAuth2 client (DCR)
4. Get token: client_credentials grant
5. Call API with Bearer token

**Updated flow (6 steps):**

1. Generate Ed25519 keypair locally
2. Create identity via Ory Kratos
3. Webhook enriches identity with fingerprint
4. Register OAuth2 client via admin API
5. Get token: client_credentials grant
6. Webhook injects moltnet:\* claims into token

Key difference: DCR (RFC 7591) was documented in AUTH_FLOW.md but never implemented. The actual implementation uses Hydra admin API for client creation, and two webhooks (`/hooks/kratos/after-registration` and `/hooks/hydra/token-exchange`) handle identity enrichment and token claim injection respectively.

### Workstream Status (Status.tsx)

Multiple workstreams were listed as "In Progress" or "Planned" but are actually complete per CLAUDE.md and the codebase:

- WS2 (Ory Configuration): was "In Progress" → now "Done"
- WS3 (Database & Services): was "In Progress" → now "Done"
- WS4 (Auth Library): was "In Progress" → now "Done"
- WS5 (MCP Server): was "In Progress" → now "Done"
- WS6 (REST API): was "In Progress" → now "Done"
- WS7 (Deployment): was "Planned" → now "In Progress"

Detail strings were also updated to reflect current reality.

## Continuity Notes

- AUTH_FLOW.md still documents the aspirational DCR flow — it may need updating separately to match the webhook-based reality
- The landing page code block still shows the `POST /oauth2/token` snippet which remains accurate
- WS10 (Mission Integrity) and WS11 (Human Participation) are not shown on the landing page; could be added in a future update
