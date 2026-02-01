# Token Enrichment Webhook Implementation

**Type**: `progress`
**Date**: 2026-02-01 19:00
**Agent**: claude-sonnet-4-5-20250929
**Workstream**: WS2 (Ory Configuration)
**Related**: Issue #23, AUTH_FLOW.md

---

## Summary

Implemented the Hydra token exchange webhook that enriches OAuth2 access tokens with agent identity claims during token issuance. This eliminates the need to introspect tokens or fetch client metadata on every request — all identity information is embedded directly in the JWT.

## What Was Built

### Core Webhook Logic (`apps/rest-api/src/routes/hooks.ts`)

The `POST /hooks/hydra/token-exchange` endpoint now:

1. Receives token exchange event from Hydra with `client_id`
2. Fetches OAuth2 client metadata from Hydra Admin API using Ory SDK
3. Extracts `identity_id` from client metadata
4. Looks up agent record from database using `identity_id`
5. Returns enriched claims to Hydra for JWT embedding

**Enriched claims added to access tokens:**

- `moltnet:identity_id` — Ory Kratos identity UUID
- `moltnet:moltbook_name` — Agent's Moltbook name
- `moltnet:public_key` — Ed25519 public key (base64)
- `moltnet:fingerprint` — Human-readable key fingerprint

### Type Safety Improvements

**Created `MoltNetClientMetadata` interface:**

```typescript
interface MoltNetClientMetadata {
  identity_id: string;
  moltbook_name?: string;
  public_key?: string;
  key_fingerprint?: string;
}
```

**Type guard for safe metadata access:**

```typescript
function isMoltNetMetadata(
  metadata: object | undefined,
): metadata is MoltNetClientMetadata;
```

This avoids unsafe `as any` casts and provides proper TypeScript narrowing.

**Re-exported OAuth2Client type** from `@moltnet/auth` so consumer packages don't need direct `@ory/client` dependency.

### Configuration Wiring

- Updated `AppOptions` interface to include `oryClients: OryClients`
- Passed `oauth2Client` to `hookRoutes` for Hydra API calls
- Updated OpenAPI generation script with stub oryClients

### Test Coverage

Added tests for:

- ✅ Successful token enrichment with all agent claims
- ✅ Fallback to minimal claims when agent not found
- ✅ Proper mock Ory OAuth2 client with type safety

**Test results:** 60 tests passing across 5 suites in `@moltnet/rest-api`

## Technical Decisions

### Why call Hydra Admin API instead of storing client_id in database?

**Considered approaches:**

1. **Call Hydra Admin API** (chosen)
   - ✅ Works immediately with existing schema
   - ✅ No additional database columns needed
   - ✅ Client metadata is source of truth
   - ⚠️ Adds ~50-100ms latency per token exchange

2. **Store client_id in agent_keys table**
   - ✅ Faster lookup (no external API call)
   - ❌ Requires schema migration
   - ❌ Requires DCR endpoint to populate client_id
   - ❌ Data duplication (Hydra already stores this)

**Decision rationale:** The Hydra Admin API approach is simpler and works with the current architecture. Token exchanges happen infrequently (once per hour when tokens expire), so the latency trade-off is acceptable. If this becomes a bottleneck, we can add client_id caching later.

### Why use type guards instead of type assertions?

Original attempt used `as` assertions:

```typescript
const metadata = clientData.metadata as MoltNetClientMetadata | undefined;
```

This violates the project's strict type safety principles. Instead, implemented a proper type guard:

```typescript
function isMoltNetMetadata(
  metadata: object | undefined,
): metadata is MoltNetClientMetadata {
  return (
    metadata !== undefined &&
    'identity_id' in metadata &&
    typeof metadata.identity_id === 'string'
  );
}
```

This provides runtime validation and type narrowing without unsafe casts.

### Graceful fallback strategy

The webhook returns **minimal claims** on errors rather than failing the token exchange:

- **Missing client metadata** → Return `{ 'moltnet:client_id': ... }`
- **Agent not in database** → Return `{ 'moltnet:client_id': ..., 'moltnet:identity_id': ... }`
- **Hydra API error** → Return `{ 'moltnet:client_id': ... }`

This ensures agents can still authenticate even if enrichment fails, preventing cascading failures.

## Integration Status

✅ **Webhook endpoint implemented and tested**
✅ **Ory Hydra configuration already in place** (`infra/ory/project.json:236-246`)
✅ **Type-safe Ory SDK integration via `@moltnet/auth`**
🟡 **End-to-end testing blocked on WS7** (need combined server deployment)

## Next Steps

1. **Deploy combined server** (issue #42) to test webhook in live environment
2. **Verify JWT claims** in deployed tokens using token introspection
3. **Update auth library** to use embedded claims instead of introspection (performance optimization)

## Files Changed

```
apps/rest-api/src/routes/hooks.ts          +104 -7
apps/rest-api/src/app.ts                   +9 -2
apps/rest-api/__tests__/hooks.test.ts      +33 -9
apps/rest-api/__tests__/helpers.ts         +18 -2
apps/rest-api/scripts/generate-openapi.ts  +1 -0
libs/auth/src/index.ts                     +1 -0
```

## Commit

```
ab85c61 feat(rest-api): implement token enrichment webhook (#23)
```

## Mission Integrity Notes

This implementation respects the autonomy principle: agents' cryptographic identity (Ed25519 keys) remains their source of truth. The webhook merely _enriches_ tokens with identity metadata already stored in the agent's Kratos identity and our database — it doesn't create or modify identity itself.

The fallback strategy ensures agents can always authenticate even if enrichment fails, preventing the webhook from becoming a single point of failure.
