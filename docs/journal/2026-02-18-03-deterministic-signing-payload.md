---
date: '2026-02-18T20:50:00Z'
author: copilot
session: deterministic-signing-payload
type: handoff
importance: 0.8
tags: [crypto, signing, cross-language, security, domain-separation]
supersedes: null
signature: <pending>
---

# Deterministic Signing Payload via SHA-256 Pre-Hash

## Context

Agents using multiline messages (newlines, Unicode, em-dashes, emoji) consistently
failed signature verification across TypeScript and Go. Root causes:

1. Go CLI `readPayload` used `bufio.Scanner.Text()` — silently truncated multiline stdin
2. No canonical serialization — raw `message + "." + nonce` varies across runtimes
3. No adversarial test vectors for cross-language validation

## What Was Done

### Core: `buildSigningBytes(message, nonce)`

Implemented identically in TypeScript and Go with domain separation and
length-prefixed binary framing:

```
signing_bytes = UTF-8("moltnet:v1") || u32be(32) || SHA256(UTF8(message)) || u32be(len(nonce)) || UTF8(nonce)
```

- **Domain separation**: `moltnet:v1` prefix prevents cross-protocol replay
- **SHA-256 pre-hash**: Message hashed to fixed 32 bytes, immune to encoding diffs
- **Length-prefixed framing**: Future-proof if nonce format changes

### Files Changed

- `libs/crypto-service/src/crypto.service.ts` — `buildSigningBytes()`, `signWithNonce()`, `verifyWithNonce()`
- `libs/crypto-service/src/index.ts` — Export `buildSigningBytes`
- `cmd/moltnet/crypto.go` — `BuildSigningBytes()`, `SignForRequest()`, `VerifyForRequest()`
- `cmd/moltnet/sign.go` — `readPayload` uses `io.ReadAll` instead of `bufio.Scanner`
- `libs/database/src/workflows/signing-workflows.ts` — `SignatureVerifier` gains `verifyWithNonce`; workflow uses it
- `apps/mcp-server/src/crypto-tools.ts` — Updated tool descriptions and instructions
- `test-fixtures/crypto-vectors.json` — 7 adversarial signing vectors

### Test Results

- 117 TypeScript crypto tests (42 new) — all pass
- All Go tests including 7 cross-language signing vectors — all pass
- Both languages produce identical output for all adversarial vectors
- CodeQL: 0 security alerts

## Mission Integrity Assessment

| Safeguard | Status | Notes |
|-----------|--------|-------|
| T1: Cryptographic anchoring | ✅ Strengthened | Domain separation prevents cross-context replay |
| T4: Offline-first verification | ✅ Maintained | `buildSigningBytes` is pure computation, no network needed |
| T7: Dependency hardening | ✅ Maintained | Only `crypto/sha256` (Go) and `node:crypto` (Node.js) |
| T8: Substitutability | ✅ Maintained | Any implementation can rebuild signing bytes from spec |

Key question from decision framework:
- **Does it move control from agents?** No — agents still sign locally with their own keys
- **Can it be verified offline?** Yes — deterministic pure function
- **Does it survive platform failure?** Yes — no external dependencies

## What's Next

- Existing raw `sign()` / `verify()` functions remain for backward compatibility
- The `signing_payload` field in MCP responses is now a human-readable hint only
- Future: consider adding `purpose` field to signing envelope for finer domain separation

## Continuity Notes

- Branch: `copilot/fix-deterministic-signing-payload`
- PR addresses issue requesting deterministic signing with domain separation
- All validation passes: lint ✅, typecheck ✅, test ✅, build ✅
