---
date: '2026-02-19T18:00:00Z'
author: claude-sonnet-4-6
session: unknown
type: handoff
importance: 0.7
tags: [crypto, signing, mcp-server, ux, agent-experience]
supersedes: null
signature: pending
---

# Fix: signing_payload Misdirection in crypto_prepare_signature

## Context

Agents were repeatedly failing the signing request flow with "Signature verification
failed." despite calling the right tools. The conversation log showed agents retrying
3+ times before either giving up or discovering (via npx @themoltnet/cli@latest) that
the old CLI lacked `--nonce` support.

The root cause was identified by tracing the full prepare → sign → submit → verify
path across the MCP tool response, the SDK, and the CLI binary.

## Substance

**The bug**: `crypto_prepare_signature` returned a `signing_payload` field set to
`"${message}.${nonce}"` alongside verbose instructions referencing that field by name.
Agents would sign this concatenated string directly, but the server verifies using
`verifyWithNonce(message, nonce, sig, pubKey)` — a completely different byte sequence.
Every such attempt fails silently with the same generic error message.

**Compounding factors**:

- The bundled CLI binary (v0.9.0 in `packages/cli/`) had no `--nonce` flag; only
  `@themoltnet/cli@0.12.0+` implemented the nonce protocol.
- The SDK's `sign()` export also used the simple signing path (now fixed in main as
  of the refactor that renamed it to `sign(message, nonce)`).
- The MCP tool description itself named `signing_payload` as a key return value,
  reinforcing the misuse pattern.

**Fix applied** (PR #245, branch `claude/fix-245-signing-protocol-mismatch`):

- Removed `signing_payload` from the `crypto_prepare_signature` response entirely.
- Replaced the verbose inline protocol instructions with a single `next_step` hint
  pointing agents to `crypto_submit_signature`.
- Added a `sign_message` MCP prompt covering the full prepare → local sign → submit
  flow. Agents can now invoke the prompt with their message and get clear sequential
  steps rather than decoding a response field.
- Updated unit and e2e tests: assert `signing_payload` is absent, `sign_message`
  prompt lists correctly and returns the expected guidance.

**Mission integrity note**: The fix keeps private keys where they belong — the prompt
does not attempt to sign server-side or expose key material. It only sequences the
calls the agent must make locally.

## Continuity Notes

- The `accountable-commit.md` slash command still references `signing_payload` and the
  old `moltnet sign "<signing_payload>"` invocation. That file is owned by a separate
  branch (the LeGreffier workflow); coordinate with that branch before merging to avoid
  re-introducing the confusion.
- The `sign_message` prompt is a thin wrapper — it does not call `crypto_prepare_signature`
  itself, it instructs the agent to. A future improvement could make it a proper
  agentic prompt that calls the tool and surfaces the `request_id` + `nonce` directly.
- The MCP e2e suite was not run against Docker for this PR (no stack available). CI
  will gate this.
