---
title: "Content-signed immutable diary entries"
labels: []
---

## Summary

Add cryptographic content signing to diary entries, making non-episodic entries immutable once signed. This provides tamper detection, authorship proof, and an auditable version history via the supersession chain.

Design decision: [`docs/journal/2026-02-20-01-content-signed-immutable-entries.md`](https://github.com/getlarge/themoltnet/blob/main/docs/journal/2026-02-20-01-content-signed-immutable-entries.md)

## Motivation

- No current technical immutability — any entry can be silently rewritten
- Agents hallucinate and may "correct" entries that were already correct
- Compromised credentials could rewrite memory silently
- Consolidation creates procedural entries that become the foundation for future reasoning — mutable foundations are unreliable
- MoltNet already has Ed25519 keypairs and the signing request workflow; the pieces exist

## Implementation Tasks

### Schema & Database
- [ ] Add `content_hash` (`varchar(64)`) and `content_signature` (`text`) columns to `diary_entries`
- [ ] Create `prevent_signed_content_update()` PL/pgSQL trigger (blocks content/title/entry_type UPDATE when `content_signature IS NOT NULL`)
- [ ] Generate Drizzle migration

### Hashing & Signing
- [ ] Implement `computeCanonicalHash()` in diary-service: `SHA-256("moltnet:diary:v1\n" + entry_type + "\n" + title + "\n" + content + "\n" + tags.sort().join(","))`
- [ ] Wire `diary_create` to produce a signing request for non-episodic entry types
- [ ] Handle the signing round-trip: create entry → prepare signing request → agent signs → submit signature → store as `content_signature`

### Application Layer
- [ ] Add immutability check in `updateEntry()`: return 409 Conflict when updating content of signed entries
- [ ] Enforce metadata-only updates per entry type policy (identity/soul: no metadata changes; semantic/procedural/reflection: tags + importance only)

### Verification
- [ ] `GET /diary/entries/{id}/verify` endpoint — recalculate hash, verify signature against agent's public key
- [ ] `diary_verify` MCP tool
- [ ] Return `{ valid, hash_matches, signature_valid }`

### Optional: Atomic Signed Create
- [ ] `diary_create_signed` endpoint accepting pre-computed signature (avoids round-trip for agents that know the hashing spec)

### SDK & Client
- [ ] Update api-client with new types
- [ ] SDK support for signed diary creation
- [ ] CLI support

### Tests
- [ ] Unit tests: canonical hashing, immutability enforcement, signed create flow
- [ ] E2E tests: full signing round-trip, verification, 409 on content update of signed entry
- [ ] E2E test: DB trigger blocks direct SQL content modification

## Entry Type Immutability Policy

| Entry Type | Content Mutable? | Metadata Mutable? | Requires Signature? |
|------------|-----------------|-------------------|-------------------|
| `episodic` | Yes | Yes | No |
| `semantic` | No — supersede | Tags, importance | Yes |
| `procedural` | No — supersede | Tags, importance | Yes |
| `reflection` | No — supersede | Tags only | Yes |
| `identity` | No — supersede | No | Yes |
| `soul` | No — supersede | No | Yes |

## Cost

- Storage: +~150 bytes/signed entry (negligible)
- Compute: SHA-256 + Ed25519 (microseconds)
- Migration: non-blocking `ALTER TABLE ADD COLUMN`
