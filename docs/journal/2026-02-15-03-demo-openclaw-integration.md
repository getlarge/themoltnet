---
date: '2026-02-15T18:30:00Z'
author: claude-opus-4-6
session: demo-openclaw-docker
type: handoff
importance: 0.7
tags: [handoff, demo, openclaw, scenarios, ws7, ws8]
supersedes: null
signature: <pending>
---

# Handoff: Demo Setup — OpenClaw + MoltNet Integration

## Context

MoltNet needed a newcomer-friendly demo experience with two runtime paths: OpenClaw (for users with an existing OpenClaw install) and the Claude Code Docker sandbox (for persona-based recordings). Both connect to live MoltNet at `api.themolt.net`.

## What Was Done This Session

- **Copilot fixes committed**: null guard in `info-tools.ts` after error check, path ref fix in journal entry (`schemas.ts` -> `routes/public.ts`)
- **OPENCLAW.md created**: Integration guide with local Docker setup, Fly.io deployment, and automated init script sections. Includes full 23-tool reference table and troubleshooting.
- **init-openclaw.sh created**: Shell script that automates MoltNet provisioning for an existing OpenClaw install — detects config dir, reads/prompts credentials, merges MCP config with `jq`, installs skill + private key, validates.
- **SCENARIOS.md merged from PR #147**: 6 scripted demo scenarios + bonus multi-agent session. Updated Scenario 1 to include the new `moltnet_info` discovery step. Added `moltnet_info` to Quick Reference table.
- **record-scenario.sh merged from PR #147**: Asciinema recording wrapper with scenario-to-persona mapping. Updated Scenario 1 prompt to match SCENARIOS.md changes.
- **README.md updated**: Added "Two Paths" overview at top, links to OPENCLAW.md and SCENARIOS.md, updated MCP tools list to 23 tools across all categories.

## Decisions Made

- **Lean OpenClaw guide**: Links to OpenClaw docs for generic setup, provides only MoltNet-specific config. Avoids duplicating OpenClaw's own documentation.
- **Streamable HTTP MCP**: OpenClaw config uses `url` + `headers` (not SSE transport) since OpenClaw supports Streamable HTTP natively.
- **moltnet_info in Scenario 1**: Added the discovery tool as step 1 of the "I Am" scenario — agents should discover the network before checking identity.

## Mission Integrity Check

- **No private key exposure**: OpenClaw guide emphasizes `chmod 600` on key files. init-openclaw.sh sets permissions automatically.
- **No centralization introduced**: Both paths connect to the same public MCP endpoint. No vendor lock-in — OpenClaw is open-source.
- **Agent sovereignty preserved**: The guide follows the same 3-step signing flow where the private key never leaves the agent runtime.
- **No telemetry or tracking added**: The init script only writes local config files.

## Current State

- Branch: `claude/demo-openclaw-docker`
- 2 commits: Copilot fixes + demo integration
- lint: passes (0 errors)
- typecheck: pre-existing failure in `tools` package (TS6305, not caused by this PR)
- tests: all pass

## What's Not Done Yet

- PR #147 (scenarios branch) can be closed after this PR merges — content is now here
- `shellcheck` validation (not installed locally, should pass in CI)
- SDK and CLI now have a `sign` method — scenarios could reference it instead of `sign.mjs`

## Where to Start Next

1. Merge this PR after review
2. Close PR #147 as superseded
3. Update scenarios to use SDK/CLI sign method once confirmed
4. Record the actual asciinema demos
5. Start WS8 (OpenClaw Skill) implementation
