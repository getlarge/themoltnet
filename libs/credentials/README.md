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

`jose` is intentional here rather than reuse of MoltNet's internal
`fast-jwt`/`get-jwks` Ory verifier. Talos publishes Ed25519/OKP keys, while this
public package needs portable remote-JWKS selection and rotation without
product-internal dependencies.

The v1 Talos integration does not rely on a caller-selected `aud` claim.
Connector gateways must validate the exact issuer and `connectorId`. This is
not standards-equivalent audience restriction and must not be presented as
arbitrary third-party JWT federation.

The URL-keyed nested claim is deliberately distinct from MoltNet's existing
flat `moltnet:*` OAuth enrichment claims. Credential schemas, evidence event
names, and authorization codes are closed for v1; changing those unions
requires an explicit contract-version decision.

## Development

```bash
pnpm exec nx run @themoltnet/credentials:test
pnpm exec nx run @themoltnet/credentials:build
pnpm exec nx run @themoltnet/credentials:check:pack
```
