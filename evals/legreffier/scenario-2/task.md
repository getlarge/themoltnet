# Audit Trail Query Tool

## Problem/Feature Description

An engineering team maintains a cryptographically signed diary of all decisions, incidents, and commits in their repositories. When onboarding new team members or performing security audits, they need to quickly trace why specific changes were made and verify the authenticity of the audit trail.

The team needs a TypeScript tool that queries the diary to answer "why" questions about past changes. The tool should search diary entries efficiently, verify cryptographic signatures where present, and produce a structured report. The diary system supports both metadata-based filtering and semantic search.

## Output Specification

Create the following files:

1. `investigate.ts` — A TypeScript module (well-typed pseudocode, doesn't need to compile) that takes a query and retrieves relevant diary entries, verifies signatures, and produces a report.

2. `investigation-report.ts` — TypeScript types/interfaces for the structured output of an investigation.

3. `search-strategy.md` — A document explaining the search approach, how to handle empty results, and how to authenticate entries.

## Input Files

The following files are provided as inputs. Extract them before beginning.

=============== FILE: inputs/diary-entries-sample.json ===============
[
{
"id": "entry-001",
"entryType": "semantic",
"title": "Decision: Use Ed25519 over RSA for agent signing",
"content": "Decision: Use Ed25519 for all agent cryptographic operations.\nAlternatives considered: RSA-2048, ECDSA P-256\nReason chosen: Ed25519 provides fast verification, small keys, and deterministic signatures.\nTrade-offs: Less hardware support than RSA in some HSMs.\nContext: Agent keys must be embedded in config files; small key size is important.\n\n<metadata>\nsigner: A1B2-C3D4-E5F6-G7H8\noperator: alice\ntool: claude\nrefs: libs/crypto-service/src/sign.ts, @moltnet/crypto-service\ntimestamp: 2026-02-15T10:30:00Z\nbranch: feat/crypto-v2\nscope: scope:crypto\n</metadata>",
"tags": ["decision", "branch:feat/crypto-v2", "scope:crypto"],
"contentSignature": "dGhpcyBpcyBhIGZha2Ugc2lnbmF0dXJlIGZvciBldmFsIHB1cnBvc2VzIGJ1dCBpdCBsb29rcyBsaWtlIGJhc2U2NA==",
"importance": 8,
"createdAt": "2026-02-15T10:30:00Z"
},
{
"id": "entry-002",
"entryType": "episodic",
"title": "Incident: Key decode failure on ARM64",
"content": "What happened: Ed25519 key decode crashed with SIGILL on ARM64 Mac minis.\nRoot cause: The crypto library used x86 intrinsics not available on ARM.\nFix applied: Switched to noble-ed25519 which is pure JS.\nWatch for: Any future crypto library must be tested on ARM64.\n\n<metadata>\noperator: bob\ntool: codex\nrefs: libs/crypto-service/src/decode.ts, noble-ed25519\ntimestamp: 2026-02-20T14:00:00Z\nbranch: fix/arm64-crypto\nscope: scope:crypto\n</metadata>",
"tags": ["incident", "branch:fix/arm64-crypto", "scope:crypto", "workaround"],
"importance": 6,
"createdAt": "2026-02-20T14:00:00Z"
},
{
"id": "entry-003",
"entryType": "procedural",
"title": "Accountable commit: JWT validation hardening",
"content": "Added subject claim validation and expiry checks to JWT middleware.\nRisk: High — auth/secrets code path.\nImpact: Prevents accepting JWTs without a subject or expired tokens.\n\n<metadata>\nsigner: A1B2-C3D4-E5F6-G7H8\noperator: alice\ntool: claude\nrisk-level: high\nfiles-changed: 2\nrefs: libs/auth/src/middleware.ts:validateJWT, libs/auth/src/types.ts\ntimestamp: 2026-03-01T09:00:00Z\nbranch: feat/jwt-hardening\nscope: scope:auth\n</metadata>\n\n<moltnet-signed>\n<signature>8e2b45a1-f9c3-4d67-b891-3a4e5f6c7d8e</signature>\n</moltnet-signed>",
"tags": ["accountable-commit", "risk:high", "branch:feat/jwt-hardening", "scope:auth"],
"importance": 8,
"createdAt": "2026-03-01T09:00:00Z"
}
]
=============== END FILE ===============
