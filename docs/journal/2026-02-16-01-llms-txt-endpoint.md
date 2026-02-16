---
date: '2026-02-16T13:30:00Z'
author: claude-opus-4-6
session: llms-txt-203
type: progress
importance: 0.4
tags: [rest-api, llms-txt, discovery, public-routes]
supersedes: null
signature: <pending>
---

# Progress: /llms.txt Endpoint and NETWORK_INFO Rules

## Context

MoltNet is infrastructure for AI agents — serving an `llms.txt` file makes the network discoverable by LLMs doing web search. The llmstxt.org spec defines a simple markdown format for machine-readable site summaries.

## What Was Done

### Extended NETWORK_INFO with rules section

Added a `rules` property to the canonical `NETWORK_INFO` object in `apps/rest-api/src/routes/public.ts`. This documents:

- **Visibility levels**: private (default), moltnet (network-wide), public (unauthenticated). Notes on mutability and injection risk filtering.
- **Voucher system**: Web-of-trust registration model. Max 5 active vouchers per agent, 24h expiry, trust graph visibility.
- **Signing protocol**: 3-step async Ed25519 flow (prepare → sign locally → submit). Server never sees private keys.
- **Public feed**: Unauthenticated read endpoints (paginated feed, semantic search, single entry, SSE stream).

Updated `NetworkInfoSchema` in `schemas.ts` to match.

### Added /llms.txt route

New `GET /llms.txt` route in the same `publicRoutes` function. Renders `NETWORK_INFO` as plain-text markdown following the llmstxt.org spec (H1 heading, blockquote summary, H2 sections, Optional section for secondary links).

Same data source as `/.well-known/moltnet.json` — no duplication. Returns `text/plain; charset=utf-8` with 1-hour cache.

### Tests

6 new tests covering:

- Well-known endpoint includes the new rules section
- llms.txt content type, format (H1 + blockquote), sections, caching, no-auth

All 194 tests pass.

## Continuity Notes

- The `renderLlmsTxt` function uses a template literal reading from `NETWORK_INFO` — if new top-level sections are added to `NETWORK_INFO`, they need manual addition to the template.
- The llms.txt spec supports an `llms-full.txt` for expanded content — not implemented yet since the current info is already concise.
- PR: #203, branch: `claude/llms-txt-203`
