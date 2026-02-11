---
date: '2026-02-07T16:30:00Z'
author: claude-opus-4-6
session: unknown
type: handoff
importance: 0.8
tags: [demo-agent, mcp, persona, docker, pr-89]
supersedes: null
signature: pending
---

# MCP-First Demo Agents with Persona System

## Context

Took over PR #89 (inter-session communication skill) which built a file-based channel system for Claude sessions to communicate. With the REST API now live at api.themolt.net, the approach was pivoted: instead of file-based channels, agents use the live MoltNet API via MCP server.

The key architectural decision was to go MCP-first rather than REST API client. Since Claude CLI natively supports MCP servers, the agent becomes **zero TypeScript code** — just a persona markdown file + MCP config + startup script.

## Substance

### What Was Built

`apps/demo-agent/` — a config/scripts package (not a TypeScript app) containing:

- **3 persona files** (from PR #89, adapted): Archivist (Sonnet, knowledge curator), Scout (Haiku, explorer), Sentinel (security guardian)
- **`.mcp.json`** — Claude CLI MCP config pointing to local MCP server at `localhost:8001`
- **`Dockerfile`** — extends `docker/sandbox-templates:claude-code`, builds MCP server into the image, copies personas
- **`docker-compose.yaml`** — orchestrates all 3 agents with per-agent env vars
- **`scripts/launch.sh`** — starts local MCP server (background) with agent's token, then launches Claude CLI with persona as `--system-prompt`
- **`scripts/launch-all.sh`** — builds image and launches all 3 agents via `docker run`

### Architecture Per Docker Sandbox

```
Docker Sandbox (per agent)
├── MCP server (background, port 8001)
│   └── ACCESS_TOKEN + PRIVATE_KEY from env
├── Claude CLI
│   ├── --system-prompt from persona .md file
│   ├── --allowedTools mcp__moltnet__*
│   └── .mcp.json → http://localhost:8001/mcp
└── 18 MoltNet tools available natively
```

### What Was Dropped from PR #89

- File-based `.molt-channel/` communication system
- `channel.sh` bash scripts
- `/channel` skill
- File watchers / inotify polling
- All custom TypeScript tool dispatching code (diary.ts, index.ts)

### Key Decisions

1. **MCP over REST API client** — Claude CLI has native MCP support, making agents zero-code (config only). An intermediate REST API client approach was built first but replaced when we realized the MCP server would be ready soon.

2. **One MCP server per agent** — The MCP server uses a single `ACCESS_TOKEN` from env (not multi-tenant). Each Docker sandbox runs its own MCP server instance.

3. **Persona as system prompt** — The full persona markdown (frontmatter + body) is passed as `--system-prompt` to Claude CLI. No custom prompt composition code needed.

## Continuity Notes

### Branch State

- **Branch:** `claude/demo-agents` (pushed)
- **Base:** `main` (commit `be007f2`)
- **Commit:** `6831865`
- **Lint:** clean (demo-agent has no TypeScript to lint)
- **Typecheck:** clean (demo-agent excluded — no tsconfig)
- **Pre-existing issue:** `apps/server` typecheck fails on `CombinedConfig` type — unrelated to this work

### What's Needed Before Running

1. **Seed agent** — needed to create voucher codes so demo agents can register (Edouard working on this)
2. **MCP server deployed** — or run locally. Another agent is doing e2e tests for the MCP server.
3. **Access tokens** — each persona agent needs its own OAuth2 token from registration
4. **Claude CLI OAuth2** — sandbox needs `claude login` (existing infra handles credential persistence)

### PR #89 Status

PR #89 is still open with merge conflicts. It should be closed in favor of this branch — the useful parts (persona system) have been extracted and the file-based channel approach is superseded by the MCP approach.

### What to Do Next

1. Close PR #89 with a note pointing to `claude/demo-agents`
2. Once MCP server e2e tests pass and server is deployed → test `launch.sh` against live MCP
3. Generate tokens for 3 agents via seed agent vouchers
4. Test full flow: `docker compose -f apps/demo-agent/docker-compose.yaml up`
5. Consider adding more personas or task templates for specific demo scenarios
