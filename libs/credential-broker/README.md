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

`createTalosTokenDeriver` is the Talos JWT adapter. It fixes the algorithm to
JWT, accepts only broker-built claims and scopes, and converts upstream failures
to stable diagnostic categories without retaining upstream messages, causes, or
credentials. It requires an explicit runtime capability result proving both
managed Talos parity and derived-JWT chaining before it can be constructed.

Connector issuance currently uses chained derivation. Deployment code supplies
the capability result; the adapter rejects exchange mode, missing managed
parity, or unsupported chaining. If chaining is unavailable, an exchange-mode
deriver can implement `TokenDeriver` with a broker-owned, cell-scoped service
key; downstream providers still receive no parent credential.

## Development

```bash
pnpm exec nx run @themoltnet/credential-broker:test
pnpm exec nx run @themoltnet/credential-broker:build
pnpm exec nx run @themoltnet/credential-broker:check:pack
```
