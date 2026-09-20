# Native PKCE enrollment and Console local control

This replaces the device-flow experiment in #2371. Ory owns authorization-code
issuance and exchange using
[S256 PKCE](https://www.ory.com/docs/oauth2-oidc/authorization-code-flow).
MoltNet owns the human session, team permissions, approved target, credential
persistence, and local operator policy. The replacement starts at provider-stack
base `0547a375b` and retains the committed token-request partitioning fix.

## Authorization and local persistence

Desktop starts native approval. Console reuses the Kratos browser session and
shows the operation, agent, team and requested permissions. Server-side Ory
Admin calls accept login and consent. The native process keeps the verifier,
loopback callback, token exchange and issued secret; the renderer receives
status metadata.

A provisioning grant binds the human, agent, team, operation, credential scopes
and idempotency key. It lasts five minutes, has no refresh token or remembered
consent, and can call only `POST /oauth2/provision`. Enrollment checks
membership and credential management, inserts a member only when absent, and
preserves existing roles. The native controller additionally proves possession
of that agent identity by signing a domain-separated enrollment message
containing the access-token hash, agent, team, operation, sorted scopes and
idempotency key. Consent derives its delegation ceiling from the approving human
session. Renewal checks credential management and existing membership. Both use
the existing Talos key service with human authority, independently of the
predecessor credential. Captured secrets and request recovery metadata use
protected storage, writer locking, conflict checks and read-back verification. A
lost exchange requires fresh approval; an idempotency key does not replay an
already consumed one-time secret. Approved membership is durable when issuance
is interrupted; recovery preserves the issuance key and does not remove or
downgrade a concurrently assigned role.

Native sign-in stores only operator issuer and subject. Native administration is
required to remove or change that operator. Console uses its own PKCE client and
keeps its fifteen-minute token in tab memory. Agent Server verifies signature,
issuer, expiry, audience, scope, client, operator and its current instance ID.
Restart creates a new instance and requires Console authorization again. Log
streams revalidate browser authority before sending further output. Native
process grants and already-running workers remain independent of browser OAuth.

## Exact disposable configuration

The executable client definitions live in
[`operator-clients.ts`](../../apps/console-e2e/src/helpers/operator-clients.ts).
Console E2E global setup registers them only against loopback Hydra Admin
(default `http://localhost:4445`). These are administrative registrations, not
DCR clients. General dynamic-registration scope limits remain unchanged.

| Setting                            | Native controller                              | Console local control                        |
| ---------------------------------- | ---------------------------------------------- | -------------------------------------------- |
| Client ID                          | `moltnet-native-e2e`                           | `moltnet-console-e2e`                        |
| Grant types                        | `authorization_code` only                      | `authorization_code` only                    |
| Response types                     | `code`                                         | `code`                                       |
| Token endpoint auth                | `none`                                         | `none`                                       |
| Allowed scopes                     | `moltnet:provision moltnet:local-control`      | `moltnet:local-control`                      |
| Audiences                          | `moltnet:provisioning`, `moltnet:agent-server` | `moltnet:agent-server`                       |
| Redirect                           | `http://127.0.0.1:17375/oauth/callback`        | `http://localhost:5174/oauth/local-callback` |
| CORS origins                       | none                                           | `http://localhost:5174`                      |
| Authorization-code access lifespan | `5m`                                           | `15m`                                        |
| Skip consent                       | `false`                                        | `false`                                      |

[`docker-compose.e2e.yaml`](../../docker-compose.e2e.yaml) supplies:

```text
Hydra URLS_LOGIN=http://localhost:5174/oauth/login
Hydra URLS_CONSENT=http://localhost:5174/oauth/consent
Hydra URLS_SELF_ISSUER=http://hydra:4444
Hydra URLS_SELF_PUBLIC=http://localhost:4444
REST MOLTNET_NATIVE_OAUTH_CLIENT_ID=moltnet-native-e2e
REST MOLTNET_CONSOLE_OAUTH_CLIENT_ID=moltnet-console-e2e
Console MOLTNET_CONSOLE_OAUTH_CLIENT_ID=moltnet-console-e2e
Console MOLTNET_OPERATOR_OAUTH_ISSUER=http://hydra:4444
Console MOLTNET_OPERATOR_OAUTH_PUBLIC_URL=http://localhost:4444
```

The host-side E2E Agent Server receives:

```text
MOLTNET_OPERATOR_OAUTH_ISSUER=http://hydra:4444
MOLTNET_OPERATOR_OAUTH_PUBLIC_URL=http://localhost:4444
MOLTNET_NATIVE_OAUTH_CLIENT_ID=moltnet-native-e2e
MOLTNET_CONSOLE_OAUTH_CLIENT_ID=moltnet-console-e2e
MOLTNET_OPERATOR_API_URL=http://localhost:8080
```

The existing disposable Hydra setting `oauth2.pkce.enforced_for_public_clients`
is `true`; consent additionally requires `code_challenge_method=S256` and a
43-character challenge. No production Ory clients or production configuration
were changed. Automatic callback handoff supports same-machine Desktop. Remote
CLI/WSL retains existing authenticated provisioning compatibility.

## Deletion and compatibility

The superseded invitation enrollment-proof helper first appeared in `8ae522e79`;
no SDK release tag contains that commit. Its SDK helper, REST proof validator,
message builder, join-schema branch and desktop invitation UI are removed.
Authenticated SDK/CLI invitation joins, diary signing and new-identity
key-possession validation remain.

The pairing API first appeared in `8af24743a` and was published in
`agent-daemon-v0.50.0`. The maintainer explicitly chose removal without legacy
compatibility: the routes and generated client operations are removed, along
with confirmation pages/codes, claim polling, stored-token migration and the
pairing-specific state rejection branch. Local OAuth metadata identifies
protocol version 2; Console rejects incompatible peers before approval. Native
process grants remain separate from Console OAuth authorization.

## Release configuration

Server settings provide production defaults for the API and OAuth endpoints and
for the administratively registered `moltnet-native` and `moltnet-console`
clients. Local advanced settings can override them; launch environment overrides
take precedence. REST and Console declare matching public values in their
`fly.toml` files. Ory client registration and approval routing are tracked in
[operations issue 8](https://github.com/getlarge/moltnet-operations/issues/8).
The repository changes do not provision clients or deploy production settings.

Native Rust and TypeScript consume the same timeout and port parameters from
`libs/models/src/operator-oauth-parameters.json`. Rust constants are generated
at build time. Ordinary M2M token caching and request coalescing remain enabled.

## Verification and measurements

CI is the validation runner. No local test, lint, typecheck or E2E suite was
run. OpenAPI generation, TypeScript/Go client generation, Nx reference
synchronization, formatting and static review completed locally. A targeted REST
API build supplied the disposable local demo. CI validation is tracked in the
[PR checks](https://github.com/getlarge/themoltnet/pull/2371/checks).

The browser suite covers native approval, callback, API/Talos issuance,
protected storage, refreshed credential health, renewal while a predecessor
worker runs, Console PKCE and reconnection after server restart. Focused tests
cover grant restrictions, permissions, state/verifier handling, callback
origin/window, cancellation during signing-key retrieval, protected recovery and
writer conflicts.
[CI run 35454315088](https://github.com/getlarge/themoltnet/actions/runs/35454315088)
passed the main checks and 64 browser cases, including the native enrollment,
renewal and running-worker scenario. Its restart test exposed an ambiguous
Connect locator; the test now targets the named Agent Server connection region.
The PR checks track verification of that correction.

A disposable local stack on macOS exercised the native controller against real
Hydra, Kratos, the REST API and Talos. Backend diagnostics used the test human
and Ory Admin approval; these are not a substitute for browser-driven approval.
Observed results:

| Operation                            | Result                                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Native PKCE sign-in                  | HTTP 200; operator persisted as issuer and subject                                                    |
| Existing-agent enrollment            | HTTP 200; issued credential persisted in protected storage                                            |
| Renewal after predecessor revocation | Revocation HTTP 204, renewal HTTP 200; replacement persisted and catalogue available with no blockers |
| Console-client PKCE local control    | HTTP 200 with the approved operator and instance                                                      |
| Reuse after Agent Server restart     | HTTP 401                                                                                              |
| Fresh authorization after restart    | HTTP 200                                                                                              |

The demo exposed two Ory integration details. Hydra can deliver an empty
`granted_scopes` list to its authorization-code hook
([upstream issue](https://github.com/ory/hydra/issues/3620)). For the two
administrative clients, the consent handler therefore records the validated
scope in server-owned session data; the hook verifies it and rejects any
nonempty scope list that differs. DCR policy is unchanged. Hydra's issuance work
can also make `exp - iat` exceed the configured lifespan. Verification checks
expiry and caps token age at five minutes for native approval and fifteen
minutes for Console, without requiring those timestamps to have an exact span.

Desktop enrollment and renewal request the same eight scopes that local
credential verification requires: `agent:profile`, `crypto:sign`,
`runtime:read`, `task:read`, `task:claim`, `task:execute`, `team:read`, and
`diary:read`. Console displays that scope set before approval.

Line measurements and CI evidence are recorded after the implementation and
generated-contract commits below. Dependencies add the existing catalogued
`jose` runtime dependency to Agent Server and the private workspace native API
client to Console E2E. No dependency versions were upgraded.

The remaining desktop stack (#2334 → #2335 → #2371 → #2375 → #2378), measured
from merged base `1efbb1942` through `260d493c0`, excludes this report and the
separate TLS change in #2379. Categories are mutually exclusive: generated paths
(`generated/`, `.gen.ts`, `_gen.go`, OpenAPI and tracked bundles) first;
documentation next; package/build/configuration files next; tests and E2E
fixtures next; remaining handwritten source last. This is a whole-stack count,
not just the PKCE replacement delta.

| Category                       |  Added | Removed |    Net |
| ------------------------------ | -----: | ------: | -----: |
| Production source              |  8,266 |   1,680 | +6,586 |
| Tests and fixtures             |  3,590 |   1,722 | +1,868 |
| Configuration and dependencies |    218 |       9 |   +209 |
| Generated contracts and bundle | 11,273 |   4,777 | +6,496 |
| Other documentation            |     28 |       4 |    +24 |

No dependency versions were upgraded. The Rust build also uses the existing
`serde_json` dependency, and `serde` enables `rc` to share immutable log
snapshots. Provider configuration is shared through `@moltnet/task-ui`; private
workspace inputs remain development dependencies. Generated artifacts are
committed separately from handwritten implementation changes.

The earlier demo and browser-run evidence above predates the enrollment proof
and follow-up review changes. Current-head verification remains in the linked PR
checks; earlier passing runs do not establish that the current stack passes.
