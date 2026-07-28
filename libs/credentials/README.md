# @themoltnet/credentials

Provider-neutral contracts and JWT verification for MoltNet task and connector
credentials.

The package defines versioned TypeBox schemas under the single namespaced claim
`https://themolt.net/claims/credentials/v1`. The credential issuer owns the
standard JWT claims (`iss`, `sub`, `iat`, `exp`, and `jti`); callers cannot add
arbitrary claims.

## Verification

```ts
import { verifyTaskCredential } from '@themoltnet/credentials';

const credential = await verifyTaskCredential(token, {
  issuer: 'https://credentials.example',
  jwksUrl: 'https://credentials.example/v2alpha1/derivedKeys/jwks.json',
  expected: {
    teamId,
    taskId,
    attemptN,
  },
});
```

Verification is fail closed and checks the signature, exact issuer, EdDSA
algorithm, expiry, required standard claims, credential kind, namespaced claim
schema, subject-to-agent binding, and every supplied binding expectation.
Remote JWKS lookups have bounded timeouts and caches.

The v1 Talos integration does not rely on a caller-selected `aud` claim.
Connector gateways must validate the exact issuer and `connectorId`. This is
not standards-equivalent audience restriction and must not be presented as
arbitrary third-party JWT federation.

Parsing without verification is available only for diagnostics through
`parseCredentialPayload`; it never establishes authority.

## Development

```bash
pnpm exec nx run @themoltnet/credentials:test
pnpm exec nx run @themoltnet/credentials:build
pnpm exec nx run @themoltnet/credentials:check:pack
```
