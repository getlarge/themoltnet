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
preserves existing roles. Renewal checks credential management and existing
membership. Both use the existing Talos key service with human authority,
independently of the predecessor credential. Captured secrets and request
recovery metadata use protected storage, writer locking, conflict checks and
read-back verification. A lost exchange requires fresh approval; an idempotency
key does not replay an already consumed one-time secret.

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

The enrollment-proof helper first appeared in `8ae522e79`; no SDK release tag
contains that commit. Its SDK helper, REST proof validator, message builder,
join-schema branch and desktop invitation UI are removed. Authenticated SDK/CLI
invitation joins, diary signing and new-identity key-possession validation
remain.

The pairing API first appeared in `8af24743a` and is present in
`agent-daemon-v0.50.0`. Its two published API route names therefore remain as
deprecated HTTP 410 migration adapters pointing clients to native sign-in and
Console PKCE. Confirmation pages/codes, claims polling, stored pairing tokens
and the custom authorization implementation are removed.

## Verification and measurements

CI is the validation runner. No local test, lint, typecheck or E2E suite was
run. OpenAPI generation, TypeScript/Go client generation, Nx reference
synchronization, formatting and static review completed locally. CI results are
pending.

The browser suite covers native approval, callback, API/Talos issuance,
protected storage, refreshed credential health, renewal while a predecessor
worker runs, Console PKCE and reconnection after server restart. Focused tests
cover grant restrictions, permissions, state/verifier handling, callback
origin/window, cancellation during signing-key retrieval, protected recovery and
writer conflicts. These are coverage descriptions, not claims of passing
execution.

Line measurements and CI evidence are recorded after the implementation and
generated-contract commits below. Dependencies add the existing catalogued
`jose` runtime dependency to Agent Server and the private workspace native API
client to Console E2E. No dependency versions were upgraded.

Measured with `git diff --numstat 0547a375b` through the implementation and
generated contracts, excluding this report. Categories are mutually exclusive:
generated paths first; package/configuration files next; test files and E2E
fixtures next; remaining handwritten runtime code last. Counts include the
retained token-request partitioning fix.

| Category                       |  Added | Removed |    Net |
| ------------------------------ | -----: | ------: | -----: |
| Production source              |  1,796 |   1,155 |   +641 |
| Tests and fixtures             |  1,156 |   1,273 |   -117 |
| Configuration and dependencies |     17 |       3 |    +14 |
| Generated contracts            | 10,944 |   4,715 | +6,229 |
