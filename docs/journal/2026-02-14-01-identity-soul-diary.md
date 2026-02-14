---
date: '2026-02-14T06:00:00Z'
author: claude-opus-4-6
session: session_01Cfv3edtbWLtq1pfpj2SccT
type: handoff
importance: 0.8
tags: [handoff, ws5, mcp-server, identity, diary, prompts]
supersedes: null
signature: pending
---

# Handoff: Identity & Soul Diary System

## What Was Done This Session

- Designed and implemented the identity/soul diary system for MoltNet agents
- Created design doc `docs/IDENTITY_SOUL_DIARY.md` and implementation plan `docs/plans/2026-02-14-identity-soul-diary.md`
- Built `profile-utils.ts` with `findSystemEntry()` and `findProfileEntries()` for tag-based lookup of system diary entries
- Created first MCP prompt (`identity_bootstrap`) that checks agent identity and guides creation of whoami/soul entries
- Enhanced `moltnet_whoami` tool to return `profile` (whoami + soul content) and `hint` (nudge to bootstrap when entries are missing)
- Added `moltnet://self/whoami` and `moltnet://self/soul` MCP resources
- Added `title` field to `diary_create` MCP tool schema
- Wrote comprehensive unit tests (99/99 passing) and e2e tests for the full bootstrap flow
- Researched OpenClaw/mcporter MCP client capabilities — found it only supports tools (no prompts, resources, notifications, sampling, or elicitation)

## What's Not Done Yet

- **OpenClaw skill for identity bootstrap** — The primary MCP client (OpenClaw via mcporter) only supports tool calls. An OpenClaw skill would be the native mechanism to trigger `moltnet_whoami` at session start and act on the hint. This is WS8 work.
- **Feed stream → MCP notifications bridge** — Feasible via `mcpBroadcastNotification()` but moot for OpenClaw since it doesn't support MCP notifications. Worth implementing for Claude Desktop and other proper MCP clients.
- **Server-side tag filtering** — `findSystemEntry()` fetches up to 100 entries and filters client-side. A REST API query parameter for tag filtering would be more efficient at scale.

## Current State

- Branch: `claude/identity-soul-diary-vxyAu`
- Tests: 99/99 unit tests passing, e2e tests written (require Docker to run)
- Build: lint clean, typecheck clean
- 2 commits pushed

## Decisions Made

- **Tag convention over title convention**: System entries use `["system", "identity"]` and `["system", "soul"]` tags. Tags are queryable and composable; titles are freeform for the agent to express themselves.
- **Client-side filtering (V1)**: `findProfileEntries()` lists entries (limit=100) and filters by tags rather than adding tag query params to the REST API. Pragmatic — avoids API changes and client regeneration.
- **Layered nudge strategy**: Primary nudge is the `hint` field in `moltnet_whoami` tool response (works with any MCP client including mcporter). MCP prompts and resources are secondary, for proper MCP clients only.
- **MCP prompt as guided workflow**: `identity_bootstrap` returns a structured message with the agent's fingerprint, existing entries, and creation instructions — not a tool call. The agent reads it and decides what to do.

## Open Questions

- Should the OpenClaw identity skill be a Claude Code skill (markdown instructions) or an OpenClaw plugin (TypeScript lifecycle hooks)?
- Should `moltnet_whoami` be called automatically on every MCP session init, or only when the agent explicitly checks?
- Will OpenClaw eventually add native MCP client support (resources, prompts, notifications)?

## Where to Start Next

1. Read this handoff and `docs/IDENTITY_SOUL_DIARY.md` for full design context
2. For OpenClaw integration: draft a skill that calls `moltnet_whoami` on session start and creates entries if the hint is present (WS8)
3. For feed notifications: implement `mcpBroadcastNotification()` bridge from the public feed SSE stream (useful for Claude Desktop users)
4. For scale: add `tag` query parameter to `GET /diary/entries` REST API endpoint to enable server-side filtering
