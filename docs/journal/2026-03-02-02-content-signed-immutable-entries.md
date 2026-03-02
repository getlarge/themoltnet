# Content-Signed Immutable Diary Entries — Implementation

**Type:** progress
**Date:** 2026-03-02
**Issue:** #261
**Branch:** `claude/content-signed-entries-261`

## What Was Done

Implemented cryptographic content signing for diary entries using CIDv1 content identifiers and Ed25519 signatures. Non-episodic entries become immutable once signed.

### Signing Flow

```
Agent computes CID locally → crypto_prepare_signature(message=CID)
→ agent signs locally → crypto_submit_signature
→ POST /entries with contentHash + signingRequestId
→ server recomputes CID, verifies signing request → stores signature
→ entry is immutable
```

### Changes by Layer

**crypto-service** — New `computeContentCid()` and `computeCanonicalHash()` utilities. Uses domain-prefixed canonical input (`moltnet:diary:v1\n{entryType}\n{title}\n{content}\n{sortedTags}`), SHA-256, and CIDv1 (raw codec, base32lower multibase). 10 unit tests.

**database** — `content_hash` (varchar 100) and `content_signature` (text) columns on `diary_entries`. PL/pgSQL trigger `prevent_signed_content_update` blocks content/title/entry_type changes on signed entries at the DB level.

**diary-service** — Service-layer immutability enforcement with entry-type policy:

- All signed entries: reject content, title, entryType changes
- identity/soul: also reject tags, importance
- reflection: also reject importance
- Always allow supersededBy

**rest-api** — `POST /entries` accepts optional `contentHash` + `signingRequestId`. Server recomputes CID and verifies the signing request (completed, valid, owned by agent, message matches CID). New `GET /entries/:id/verify` endpoint does full cryptographic verification. 409 Conflict on immutable entry update.

**mcp-server** — `entries_create` tool accepts `content_hash` and `signing_request_id`. New `entries_verify` tool calls server-side verification.

**api-client** — Regenerated with new fields and `verifyDiaryEntry` endpoint.

**sdk** — `diary.verify()` and `diary.createSigned()` convenience methods. Re-exports `computeContentCid`.

### Test Results

All unit tests pass across all workspaces (1100+ tests total). Key new coverage:

- 10 content-cid tests (determinism, null handling, tag sorting, CID format)
- 3 immutability enforcement tests (signed entry rejection, supersededBy allowed, identity/soul policy)
- Test helpers updated with contentHash/contentSignature defaults

## What's Next

- **E2E tests**: Full signing round-trip (compute CID → sign → create → verify → attempt update → 409), unsigned entry update, verify endpoint responses
- **CID-as-DAG exploration** (Task #7): Research decomposing entries into DAG structures for living skills

## Decisions

- CID computation is agent-side (server only verifies), keeping the trust model clean — agent asserts content, server verifies assertion
- DB trigger provides defense-in-depth beyond service-layer checks
- `signingRequestId` stays in the API layer only; service layer receives resolved `contentSignature`
