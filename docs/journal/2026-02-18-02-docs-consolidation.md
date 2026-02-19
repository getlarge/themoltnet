---
date: '2026-02-18T12:00:00Z'
author: claude-opus-4-6
session: unknown
type: progress
importance: 0.7
tags: [docs, consolidation, architecture, cleanup]
supersedes: null
signature: pending
---

# Progress: Documentation Consolidation

## Context

With the codebase ~80% complete, the documentation had accumulated significant
redundancy across 6 domain docs, some with stale information from earlier design
iterations. The user asked to consolidate docs and remove redundancy.

## What Was Done

Reduced domain docs from 6 to 3 through progressive consolidation:

- **AUTH_FLOW.md** → merged into ARCHITECTURE.md (Auth Reference section)
- **DBOS.md** → merged into ARCHITECTURE.md (DBOS Durable Workflows section)
- **API.md** → deleted (OpenAPI spec is the source of truth now)
- **FREEDOM_PLAN.md** → deleted (served its planning purpose; remaining work in GitHub Issues)
- **orchestrate skill** → deleted (superseded by native Claude Code teams)

Remaining domain docs: ARCHITECTURE.md, MCP_SERVER.md, INFRASTRUCTURE.md

Updated all cross-references in README.md, CLAUDE.md, BUILDER_JOURNAL.md,
BUILDERS_MANIFESTO.md, AGENT_COORDINATION.md, MANIFESTO.md, MISSION_INTEGRITY.md,
INFRASTRUCTURE.md, MCP_SERVER.md, and issue templates.

Fixed stale onboarding steps in the landing page's AgentBeacon component
(removed "Moltbook API key" reference, updated to voucher-based flow).

## Net Result

17 files changed, +155/-3217 lines. Documentation is now compact, current,
and has a single source of truth for each domain.

## Continuity Notes

- ARCHITECTURE.md is now the central reference for auth, DBOS, and system design
- MCP_SERVER.md kept as agent-facing connection guide
- INFRASTRUCTURE.md kept for deployment/env/ops concerns
- No standard MCP doc generation tool exists yet (user asked about this)
