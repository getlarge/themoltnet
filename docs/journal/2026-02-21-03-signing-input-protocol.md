---
date: 2026-02-21
session: 03
type: handoff
issue: 251
branch: feature/251-signing-input
title: 'Signing Input Protocol — signing_input field, SDK signBytes, Go CLI, MCP update'
---

# Signing Input Protocol

## What Was Done

Completed issue #251 end-to-end: the API now returns a `signing_input` field on every `SigningRequest` response, and all clients (SDK, Go CLI, MCP server) have been updated to use it.

### Problem solved

Previously, clients needed to know the binary framing protocol (`buildSigningBytes`) to construct the exact bytes to sign. This created coupling between client code and the server's internal signing format. With `signing_input`, clients receive pre-framed bytes (base64-encoded) and can sign them directly.

### Changes made

**REST API (`apps/rest-api/`)**

- Added `signingInput: Type.String(...)` to `SigningRequestSchema` in `schemas.ts`
- Added `toSigningResponse(row: SigningRequest)` helper that projects DB row fields into schema shape and computes `signingInput = base64(buildSigningBytes(message, nonce))`. Needed because the Drizzle row type includes `workflowId` (internal field not in the schema), so spreading it caused TS2345.
- All 4 signing request endpoints now use `toSigningResponse()` instead of returning raw DB rows.
- Added `signingInput` assertions to all 4 unit tests.

**OpenAPI + clients**

- Regenerated `apps/rest-api/public/openapi.json` — `SigningRequest` object now includes `signingInput: string`
- Regenerated `libs/api-client/src/generated/types.gen.ts` — `SigningRequest` type updated
- Regenerated all `cmd/moltnet-api-client/oas_*_gen.go` files — `SigningRequest.SigningInput string` field added
- Added Go client regeneration check to `.github/workflows/ci.yml` `openapi` job

**MCP server (`apps/mcp-server/`)**

- `handleCryptoPrepareSignature` now returns `signing_input: data.signingInput` in the tool result
- `next_step` guidance updated to explain: decode `signing_input` from base64, sign the raw bytes, submit
- Tool description updated to mention `signing_input`

**SDK (`libs/sdk/`)**

- Added `signBytes(signingInput: string, credentialsPath?: string): Promise<string>` to `sign.ts`
  - Uses `@noble/ed25519` `ed.signAsync` directly on raw bytes (same primitive as `signWithNonce`, bypasses `buildSigningBytes`)
  - Private key: read from credentials, base64-decoded to 32-byte seed
- Exported `signBytes` from `index.ts`
- New test file `__tests__/sign-bytes.test.ts`: 3 tests — round-trip verifiable with `verifyWithNonce`, same result as `sign(message, nonce)`, throws on missing credentials
- Kept tests in a separate file to avoid mock conflicts with `sign.test.ts` (which mocks `node:fs/promises` at module level)

**Go CLI (`cmd/moltnet/`)**

- `signWithRequestID` now decodes `req.SigningInput` and calls `signRawBytes` instead of re-computing framing
- Added `signRawBytes(rawBytes []byte, privateKeyBase64 string)` helper using `ed25519.NewKeyFromSeed(seed)` (private key stored as 32-byte seed, not 64-byte expanded key)
- Updated stub server in `sign_test.go` to return `SigningInput` field

**Test fixtures + crypto vectors**

- Added `signing_input_base64` to all 7 vectors in `test-fixtures/crypto-vectors.json`
- New test in `libs/crypto-service/__tests__/signing-vectors.test.ts` verifying computed `signing_input_base64` matches stored vectors

**CI (`github/workflows/ci.yml`)**

- `openapi` job: added `actions/setup-go@v5`, `go generate ./...` step, and `git diff` check for `cmd/moltnet-api-client/`

## Decisions Made

**No DB migration**: `signingInput` is derived from `message` + `nonce` columns on every read. No new column. Avoids adding a computed/redundant column to the schema.

**`toSigningResponse` helper**: Explicit field projection is required because the Drizzle `SigningRequest` type includes `workflowId` (not in the API schema). Spreading the raw row would cause TS2345 when passing to `reply.send()`. The helper lists all schema fields explicitly.

**Separate `sign-bytes.test.ts`**: The existing `sign.test.ts` mocks `node:fs/promises` at module level using `vi.mock()`. That intercepts real filesystem writes. The new `signBytes` tests need to write real credential files to a temp directory, so they live in a separate file.

**`signRawBytes` in Go**: Private keys are stored as 32-byte seeds (base64), not 64-byte expanded keys. `ed25519.NewKeyFromSeed(seed)` derives the full private key from the seed, matching how `SignForRequest` works in `crypto_ops.go`.

## What's Not Done

- E2E test for the new `signingInput` field (unit tests + type-level coverage exist, but no E2E test exercises the full flow with DBOS workflow)
- `signBytes` is not yet wired into the CLI `sign` command (CLI `sign --message` still uses `sign(message, nonce)` with server-fetched nonce). Issue #251 only required SDK + Go CLI support; CLI auto-sign with `signing_input` can be a follow-on.

## Current State

- **Branch**: `feature/251-signing-input`
- **Commits**: 8 commits on top of `main`
- **Tests**: All pass — `pnpm run validate` clean (lint, typecheck, test, build); `cd cmd/moltnet && go test ./...` pass
- **Build**: Clean — all 4 apps build successfully

## Open Questions

None. The implementation is complete and ready for review.

## Where to Start Next

This PR is ready for review. The reviewer should:

1. Verify `signing_input` is present in all 4 `SigningRequest` API responses (create, list, get, submit)
2. Run `pnpm --filter @themoltnet/sdk run test` to confirm `signBytes` round-trip passes
3. Run `cd cmd/moltnet && go test ./...` to confirm Go CLI signing test passes
4. Check the crypto vectors test confirms `signing_input_base64` matches

Next work after merge:

- Issue #252 or next item on the project board
