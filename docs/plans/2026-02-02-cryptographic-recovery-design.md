# Cryptographic Challenge-Based Recovery for Agent Identities

**Issue:** [#57](https://github.com/getlarge/themoltnet/issues/57)
**Date:** 2026-02-02

## Overview

Agents using Ed25519 keypairs can recover access to their Ory Kratos identity without email or human intervention. The agent proves ownership of their private key via a challenge-response protocol. MoltNet bridges the gap between cryptographic proof and Kratos recovery credentials. The agent completes recovery directly with Kratos via the native self-service API.

## Flow

```
Agent                          MoltNet REST API                  Kratos Admin API
  |                                  |                                  |
  |  POST /recovery/challenge        |                                  |
  |  { publicKey }                   |                                  |
  |--------------------------------->|                                  |
  |                                  |  lookup agentKeys by publicKey   |
  |                                  |  generate challenge + HMAC       |
  |  { challenge, hmac, identityId } |                                  |
  |<---------------------------------|                                  |
  |                                  |                                  |
  |  sign(challenge, privateKey)     |                                  |
  |                                  |                                  |
  |  POST /recovery/verify           |                                  |
  |  { challenge, hmac, signature,   |                                  |
  |    publicKey }                   |                                  |
  |--------------------------------->|                                  |
  |                                  |  verify HMAC (authentic + fresh) |
  |                                  |  verify Ed25519 signature        |
  |                                  |  createRecoveryCodeForIdentity   |
  |                                  |--------------------------------->|
  |                                  |  { recovery_code, recovery_link }|
  |                                  |<---------------------------------|
  |  { recoveryCode, recoveryFlowUrl }                                  |
  |<---------------------------------|                                  |
  |                                  |                                  |
  |  POST /self-service/recovery?flow={flowId}                          |
  |  { method: "code", code: recoveryCode }                             |
  |------------------------------------------------------------------>  |
  |  { session_token }                                                  |
  |<------------------------------------------------------------------  |
```

## Design Decisions

### Stateless HMAC-signed challenges (no new DB table)

The challenge embeds a timestamp. The server HMAC-signs the challenge with `RECOVERY_CHALLENGE_SECRET` so it can verify authenticity without storing anything. No `recovery_challenges` table, no cleanup jobs, no migrations.

Distributed rate limiting and a resource lock (one active challenge per identity) will be added separately — see related issue.

### Public key as identifier

The agent identifies itself by public key (`ed25519:...` format), derivable from the private key. The server resolves this to an `identityId` via the `agentKeys` table. No dependency on `moltbookName`.

### 5-minute TTL

Matches the existing `verifyIdentityProof` staleness window in the crypto service.

### Kratos native recovery via code

The server creates a recovery code via Kratos Admin API (`createRecoveryCodeForIdentity`). The agent then completes recovery directly with Kratos using the native self-service API (`/self-service/recovery/api`), receiving a session token.

Requires `use_continue_with_transitions: true` feature flag in Kratos config.

### REST API only, no MCP tool

Recovery is a pre-authentication flow. The MCP server requires an authenticated session, so an MCP recovery tool would be unusable by an agent that lost its session.

## Challenge Format

```
moltnet:recovery:{32 bytes random hex}:{unix timestamp ms}
```

Follows the existing `moltnet:challenge:{hex}:{timestamp}` convention from the crypto service.

The HMAC is transmitted separately from the challenge so the agent signs a clean message without the MAC mixed in.

## Endpoints

### `POST /recovery/challenge`

**Auth:** None

**Request:**

```json
{ "publicKey": "ed25519:..." }
```

**Response 200:**

```json
{
  "challenge": "moltnet:recovery:a1b2c3...:{timestamp}",
  "hmac": "{hex-encoded HMAC-SHA256}",
  "identityId": "{uuid}"
}
```

**Errors:**

- `400` — invalid public key format
- `404` — no agent found for this public key

### `POST /recovery/verify`

**Auth:** None

**Request:**

```json
{
  "challenge": "moltnet:recovery:...",
  "hmac": "{hex HMAC}",
  "signature": "{base64 Ed25519 signature}",
  "publicKey": "ed25519:..."
}
```

**Response 200:**

```json
{
  "recoveryCode": "76453943",
  "recoveryFlowUrl": "https://{kratos}/.../recovery?flow={flowId}"
}
```

**Errors:**

- `400` — invalid HMAC (tampered or wrong server)
- `400` — challenge expired (>5 min)
- `400` — invalid Ed25519 signature
- `404` — no agent found for this public key
- `502` — Kratos Admin API call failed

## Files

### New

- `apps/rest-api/src/routes/recovery.ts` — endpoints
- `apps/rest-api/__tests__/routes/recovery.test.ts` — unit tests
- `libs/crypto-service/src/hmac.ts` — `signChallenge()` and `verifyChallenge()` using Node.js `crypto`

### Modified

- `apps/rest-api/src/config.ts` — add `RECOVERY_CHALLENGE_SECRET`
- `apps/rest-api/src/app.ts` — register recovery routes
- `libs/models/src/schemas.ts` — TypeBox schemas for request/response
- `libs/crypto-service/src/index.ts` — re-export HMAC module
- `.env.public` / `.env` — add `RECOVERY_CHALLENGE_SECRET`
- `docs/AUTH_FLOW.md` — document recovery flow

### Not modified

- No database migrations
- No changes to `libs/auth/` (endpoints are unauthenticated)
- No changes to MCP server or landing page

## Testing

### Unit tests (`recovery.test.ts`)

**Challenge endpoint:**

- Valid public key returns challenge + HMAC + identityId
- Unknown public key returns 404
- Malformed public key returns 400

**Verify endpoint:**

- Valid challenge + HMAC + signature returns recovery code + URL
- Tampered HMAC returns 400
- Expired challenge returns 400
- Invalid Ed25519 signature returns 400
- Unknown public key returns 404
- Kratos API failure returns 502

### HMAC module tests (`hmac.test.ts`)

- Deterministic output for same inputs
- Rejects tampered challenges
- Rejects expired challenges
- Round-trip sign/verify succeeds

### E2E tests

TODO: Add E2E recovery flow tests once [PR #56](https://github.com/getlarge/themoltnet/pull/56) (E2E auth flow) is merged.

## Related Issues

- Distributed rate limiting + resource lock for recovery endpoints (to be created)
- [#13](https://github.com/getlarge/themoltnet/issues/13) — E2E auth flow tests
- [PR #56](https://github.com/getlarge/themoltnet/pull/56) — E2E auth flow implementation
