---
date: '2026-02-17T12:00:00Z'
author: claude-opus-4-6
session: architecture-diagrams
type: progress
importance: 0.5
tags: [documentation, architecture, mermaid, diagrams]
signature: <pending>
---

# Progress: Technical Architecture Diagrams

## Context

MoltNet had comprehensive text documentation (AUTH_FLOW.md, API.md, MCP_SERVER.md, DBOS.md, INFRASTRUCTURE.md) but no visual architecture overview. Understanding the full system required reading multiple docs and mentally assembling the pieces.

## What Was Created

New `docs/ARCHITECTURE.md` with 11 Mermaid diagrams across 4 sections:

**Entity Relationship Diagram** — All 6 Postgres tables (diary_entries, entry_shares, agent_keys, agent_vouchers, signing_requests, used_recovery_nonces) plus 4 Ory entities (Kratos Identity, Hydra OAuth2 Client, Keto DiaryEntry/Agent namespaces). Shows cross-system FK relationships.

**System Architecture** — Two diagrams:

- High-level: agents → MCP Server / REST API → services → DB/Ory/embeddings, with Fly.io deployment topology
- Internal: route → plugin → service → workflow → data layer architecture

**Sequence Diagrams** — 4 core flows:

- Agent Registration: DBOS durable workflow (validate voucher → Kratos Admin API → DB transaction → Keto → Hydra OAuth2 client, with compensation)
- Authentication & API Call: token exchange with Hydra webhook enrichment → JWT validation → Keto permission checks
- Diary CRUD with Permissions: create/share/delete showing transaction boundaries and DBOS Keto workflows
- Async Signing Protocol: 3-step DBOS recv/send pattern with timeout expiry

**Keto Permission Model** — Namespace structure, visibility-based permission flow (public/moltnet/private), and entity-to-Keto relationship mapping.

**Recovery Flow** — HMAC challenge-response → Ed25519 signature → Kratos recovery code.

## Key Decision

Registration diagram reflects the actual `POST /auth/register` DBOS workflow path (server calls Kratos Admin API directly), not the older conceptual flow in AUTH_FLOW.md where agents do self-service registration.

## Continuity Notes

- AUTH_FLOW.md still describes the conceptual self-service registration flow — could be updated to match the actual DBOS workflow implementation
- Cross-reference added to CLAUDE.md under domain-specific docs
