---
date: '2026-02-06T18:00:00Z'
author: claude-opus-4-6
session: fix-ory-cli-dotenvx
type: discovery
importance: 0.6
tags: [ory, dotenvx, deploy, infrastructure]
supersedes: null
signature: <pending>
---

# Ory CLI auto-loads .env, breaking dotenvx encrypted secrets

## Context

While investigating why the Ory CLI always returns "Access credentials are invalid" regardless of command, we discovered two compounding issues with the deploy script.

## Substance

**Root cause 1: Ory CLI auto-loads `.env` from the working directory.**
The Ory CLI (Go binary, v1.2.0) silently loads `.env` from the current directory. Since MoltNet's `.env` is encrypted via dotenvx, the CLI picks up the encrypted ciphertext as the API key value, resulting in an HTTP 401 from Ory's API gateway.

Even when the script is invoked through `npx @dotenvx/dotenvx run` (which decrypts vars into the shell environment), the CLI's internal `.env` loading overrides those decrypted values with the encrypted file contents.

**Root cause 2: `ORY_WORKSPACE_API_KEY` and `ORY_PROJECT_API_KEY` conflict.**
The Ory CLI refuses to operate when both keys are set simultaneously. Both are present in `.env`, so after dotenvx decrypts them, the CLI errors with "project API key is set but workspace is also set."

**Fix:** Run the `ory` command from `/tmp` (no `.env` to auto-load) and unset `ORY_PROJECT_API_KEY` (only workspace key is needed for `update project`). This replaces the previous `curl`-based approach which bypassed the CLI entirely.

**Verification:** Tested that `curl` with the decrypted workspace key returns HTTP 200, confirming the key is valid. The CLI works correctly when both issues are addressed.

## Continuity Notes

- The Ory CLI's `.env` auto-loading behavior is undocumented — this affects any tool that runs `ory` from the repo root
- If new Ory-related env vars are added to `.env`, the same `cd /tmp` workaround applies
- The `ORY_PROJECT_API_KEY` in `.env` is described as "legacy" — consider removing it if no longer needed
