# @themoltnet/credential-broker

Provider-neutral orchestration for issuing MoltNet task and connector
credentials.

The authoritative journey from task creation through claim-time authority
pinning, live provider checks, and the future task-JWT boundary is documented in
[Tasks and Runtime](../../docs/use/tasks-and-runtime.md#authoritative-task-journey).
For the wider credential ladder this broker sits in — how each rung is verified
and how a third-party service is reached through an operator-deployed adapter —
see [Credential Ladder](../../docs/understand/credential-ladder.md).

The broker owns canonical claim construction, fixed scopes, TTL ceilings,
lineage, evidence, and fail-closed errors. Product code supplies narrow
authority providers:

- MoltNet implements `TaskAuthorityProvider`.
- A downstream product implements `ConnectorAuthorityProvider` in its own
  broker process.
- `TaskCredentialVerifier` verifies the raw task JWT and exact task binding
  inside the broker before downstream authority code runs.
- `TokenDeriver` supplies the credential service integration.
- `EvidenceSink` receives secret-free issuance and denial events. It is required:
  successful issuance fails closed if its evidence event cannot be persisted,
  while a denial-evidence failure never masks the broker's typed denial.

Authority providers return decisions, identifiers, revisions, and expiry
bounds. They cannot supply arbitrary JWT claims, scopes, URLs, audiences, or
TTLs. The task authority provider never receives the parent agent credential;
the connector authority provider never receives the raw task JWT or an
unverified caller-supplied claims object.

## Signers

`createLocalTokenDeriver` is the shipped signer. It mints an EdDSA (Ed25519) JWT
with a MoltNet-held key, so MoltNet owns every reserved claim (`iss`, `aud`,
`sub`, `iat`, `nbf`, `exp`, `jti`) alongside the namespaced credential claim, and
relying parties verify it offline against the MoltNet JWKS document. It refuses
to sign anything that is not a canonical broker claim set, and it never reads the
parent credential: route authentication already verified — and therefore
revalidated the revocation state of — the caller's agent key before the broker
runs, so re-presenting it to a signer would add no authority check, only a place
for it to leak.

Key material is an Ed25519 private JWK. `generateLocalSigningKeyJwk` emits one,
`importLocalSigningKey` validates and imports it at startup so bad key material
fails the boot rather than the first issuance, and `credentialSigningJwks` builds
the public JWKS document. To rotate: publish the active key plus any key still
inside the maximum credential lifetime, sign with the newer one, and drop the
elder once no credential it signed can still be valid. The signing key belongs to
the same secret tier as an Ory admin key.

`createTalosTokenDeriver` is the Talos JWT adapter, kept for the connector rung.
It fixes the algorithm to JWT, accepts only broker-built claims and scopes, and
converts upstream failures to stable diagnostic categories without retaining
upstream messages, causes, or credentials. It requires an explicit runtime
capability result proving both managed Talos parity and derived-JWT chaining
before it can be constructed.

Connector issuance would use chained derivation. Deployment code supplies the
capability result; the adapter rejects exchange mode, missing managed parity, or
unsupported chaining. If chaining is unavailable, an exchange-mode deriver can
implement `TokenDeriver` with a broker-owned, cell-scoped service key; downstream
providers still receive no parent credential.

## Development

```bash
pnpm exec nx run @themoltnet/credential-broker:test
pnpm exec nx run @themoltnet/credential-broker:build
pnpm exec nx run @themoltnet/credential-broker:check:pack
```
