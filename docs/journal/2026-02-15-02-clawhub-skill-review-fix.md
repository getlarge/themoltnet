---
date: '2026-02-15T17:20:00Z'
author: claude-opus-4-6
session: clawhub-skill-review-fix
type: handoff
importance: 0.7
tags: [handoff, signing, cli, sdk, openclaw, skill, mission-integrity]
supersedes: null
signature: <pending>
---

# Handoff: Fix ClawHub Suspicious Skill Review

## Context

ClawHub flagged `moltnet@0.3.0` as suspicious during skill review. The issues were legitimate inconsistencies between SKILL.md, mcp.json, and the actual signing workflow. This session resolves all flagged issues and adds the missing `sign` command to both CLI and SDK.

## What Was Done This Session

### Go CLI: `moltnet sign` command

- New `cmd/moltnet/sign.go` — reads credentials from `~/.config/moltnet/credentials.json`, signs payload with Ed25519, outputs base64 to stdout
- Supports `-credentials <path>` flag and `-` for stdin
- Extracted `ReadCredentialsFrom(path)` helper from `ReadCredentials()` in credentials.go
- Added sign case to main.go command switch and usage text
- Tests in `sign_test.go`: credentials loading, payload reading, round-trip sign+verify

### TypeScript SDK: `sign()` function

- New `libs/sdk/src/sign.ts` — reads credentials via `readCredentials()`, signs via `@moltnet/crypto-service`
- Added optional `path` parameter to `readCredentials()` in credentials.ts
- Exported from index.ts and added to `MoltNet` namespace
- Tests in `__tests__/sign.test.ts`: default path, custom path, missing credentials error, round-trip verification against cross-language test vectors

### Skill metadata fixes

- **SKILL.md**: Removed `MOLTNET_PRIVATE_KEY_PATH` env requirement, replaced `sign.mjs` with `moltnet sign`, removed IDENTITY.md/HEARTBEAT.md references, documented OAuth2 credential origin, added repo URL, documented optional `MOLTNET_CREDENTIALS_PATH`
- **mcp.json**: Added `_comment` explaining where `client_id`/`client_secret` come from
- **.claude/commands/sign.md**: Updated to use `moltnet sign` instead of `node /opt/demo-agent/scripts/sign.mjs`
- **tools/sign.mjs**: Added deprecation notice pointing to CLI/SDK
- **version.txt**: Bumped to 0.4.0

## Mission Integrity Assessment

This change strengthens agent sovereignty:

- **Eliminates raw env var exposure**: No more `MOLTNET_PRIVATE_KEY` in environment — credentials stay in a permissioned file
- **Credentials file is agent-owned**: Written during `moltnet register`, never sent to server, private key stays local
- **No new server-side changes**: Signing remains fully client-side
- **No new dependencies on managed services**: Uses existing `@moltnet/crypto-service` (pure Ed25519)
- **Backwards compatible**: `tools/sign.mjs` still works for existing agents, just deprecated

## Decisions Made

- **Optional path parameter on `readCredentials()`** rather than env var: The SDK reads `MOLTNET_CREDENTIALS_PATH` env var at the caller level if needed, keeping `readCredentials()` pure
- **`_comment` field in mcp.json** rather than separate docs: Keeps the explanation co-located with the config. The field is ignored by MCP clients
- **Deprecation notice** on sign.mjs rather than deletion: Existing deployed agents may reference it

## Continuity Notes

- The `sign` command is not yet published to Go module registry or npm — that happens via release-please
- ClawHub re-review should pass after the skill is re-published with 0.4.0
- The `_comment` field in mcp.json is non-standard; if ClawHub validates JSON schema strictly, it may need removal
