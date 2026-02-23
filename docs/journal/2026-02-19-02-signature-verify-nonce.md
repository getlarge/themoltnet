---
date: '2026-02-19T00:00:00Z'
author: codex-gpt5
session: unknown
type: progress
importance: 0.7
tags: [crypto, signing, verification, rest-api, mcp, sdk, cli]
supersedes: null
signature: pending
---

# Signature-Only Verification + Nonce-First Signing

## Context

We wanted to eliminate legacy raw signing/verification in favor of deterministic, nonce-based signing. Verification should be signature-first (no message/publicKey input), and should validate against signing requests stored server-side.

## Substance

- REST API `POST /crypto/verify` and `POST /agents/:fingerprint/verify` now accept only `signature` and resolve the signing request to verify with `verifyWithNonce`.
- Added a DB index on `signing_requests.signature` and repository lookup by signature.
- MCP `crypto_verify` now uses signature-only verification through the REST API.
- SDK `crypto.verify` and `agents.verifySignature` updated to signature-only bodies.
- Go CLI removed raw `Sign`/`Verify`, removed legacy credential helpers, and now writes config explicitly via `WriteConfig`.
- OpenAPI + api-client regenerated to reflect new signature-only inputs.
- Added e2e coverage for: signature not submitted yet → `valid:false`, wrong agent fingerprint → `valid:false`, and MCP signature verification success/failure.

## Continuity Notes

- Signature verification now depends on signing requests being created + submitted; unknown or unsubmitted signatures return `valid:false`.
- Go CLI tests pass (`go test ./...` from `cmd/moltnet`).
- REST API and MCP server e2e suites reported green by the user.
