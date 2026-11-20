# Isolated OIDC acceptance checks

These opt-in browser tests exercise both sides of the Console's OpenID Connect
(OIDC) integration without an upstream account or a live Tailscale login.
`server.mjs` acts as a synthetic identity provider for Kratos social login.
The Tailscale test acts as a relying party (the application requesting a login)
against Hydra; it does not use this server.

Use a disposable, isolated instance of the existing full E2E stack. Follow the
[browser validation guide](../../README.md) for dependencies, Chromium, endpoint
variables, Console runtime configuration, captured mail and stack lifecycle.
The ordinary `e2e-auth` target runs only `auth-self-service.e2e.spec.ts`; it does
not select these tests. Neither Playwright global setup nor the fixture starts
Kratos, Hydra, the API, Console or Mailpit.

## Synthetic social provider

Start the fixture from the repository root in a separate terminal, after choosing
addresses reachable from the relevant processes. For example, if the runner,
browser and Kratos all run directly on the same host:

```bash
OIDC_MOCK_PORT=8086 \
OIDC_MOCK_HOST=127.0.0.1 \
OIDC_MOCK_ISSUER=http://localhost:8086 \
OIDC_MOCK_BROWSER_URL=http://localhost:8086 \
OIDC_MOCK_REDIRECT_URI=http://localhost:4433/self-service/methods/oidc/callback/acceptance-mock \
node apps/console-e2e/fixtures/oidc/server.mjs
```

The listener defaults to `0.0.0.0:8080`. The example sets its host and port
explicitly to avoid the usual E2E API on port 8080. Setting an issuer URL alone
does not change the listener. Reserve it in the disposable test environment. For containerized Kratos,
`localhost` refers to its own container. Supply an issuer reachable from Kratos
and a browser URL reachable from both Playwright and the browser instead.

| Variable                 | Required agreement                                                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OIDC_MOCK_ISSUER`       | Discovery issuer and server-to-server token, JWKS and userinfo base URL. Defaults to `http://oidc-mock:8080`; that hostname must actually resolve from Kratos. |
| `OIDC_MOCK_BROWSER_URL`  | Browser authorization endpoint base URL; also used by the test to reset the fixture. Required at fixture startup and in the test runner.                       |
| `OIDC_MOCK_REDIRECT_URI` | Exact Kratos callback URL for provider `acceptance-mock`. Required at fixture startup; authorization and token requests must use this value.                   |

Before running, configure the disposable Kratos instance with an enabled OIDC
provider whose ID and client ID are `acceptance-mock`, using discovery at the
fixture issuer and the fixture's literal synthetic client secret from
[`server.mjs`](./server.mjs). Configure its claims mapper to populate
`traits.email` and `traits.username` from `email` and `preferred_username`, and
retain the normal registration/login hooks. Registration must return to the
requested Console `/auth/logout` page without creating a session; a subsequent
login must create one. Allow that return URL and configure browser cookies and
CORS as described in the browser validation guide.

There is currently no checked-in launcher, port proxy, Compose service, Kratos
provider definition or claims mapper wiring this fixture into the standard
stack. `pnpm run e2e:up` alone therefore does not provide a reproducible social
acceptance environment. Provision those pieces in the isolated environment
before using this command; do not create a competing authentication stack.

```bash
NX_LOAD_DOT_ENV_FILES=false \
AUTH_UI_MOCK_OIDC_TESTS=1 \
OIDC_MOCK_BROWSER_URL=http://localhost:8086 \
pnpm exec nx run @moltnet/console-e2e:e2e --grep='synthetic provider'
```

Set the runner endpoint variables from the browser validation guide when using
other endpoints. Global setup still requires healthy API, Console, Kratos and
Mailpit even though this individual test does not consume mail.

The test resets the fixture, follows a real Kratos callback twice, checks the
explicit return URL after registration and login, verifies the mapped synthetic
traits and `oidc` authentication method, then checks logout removes the session.
It does not assert callback failure handling or a live provider's behavior.

## Mock Tailscale relying party

Use the same isolated full stack with reachable Hydra public and admin APIs,
password registration/login, code-based email verification through Mailpit, and
the application's real login and consent integration. The runner must be able
to read the admin API; the browser must reach the public authorization endpoint.
The Hydra discovery issuer and signing keys must match issued tokens.

```bash
NX_LOAD_DOT_ENV_FILES=false \
AUTH_UI_MOCK_TAILSCALE_TESTS=1 \
HYDRA_PUBLIC_URL=http://localhost:4444 \
HYDRA_ADMIN_URL=http://localhost:4445 \
pnpm exec nx run @moltnet/console-e2e:e2e --grep='mock relying party'
```

The test creates the fixed `tailscale-login` client from the existing
[client definition](../../../../infra/ory/oauth2-clients/tailscale-login.json),
with a fresh random secret. That client ID must be absent before the test;
reserve an isolated Hydra namespace and avoid concurrent runs. The test deletes
the client in `finally` after successful creation, including when later
assertions fail. Interrupted processes can leave it behind.

A synthetic user registers, logs in, verifies email and approves consent. The
test intercepts consent approval and captures Hydra's final callback redirect
before the browser can follow it, rendering a local mock page. It does not
deliver the authorization code to Tailscale. The runner
then exchanges the code with real Hydra and checks the ID token's RSA signature,
issuer, audience, expiry, nonce, email, verification status and username. It also
checks state preservation and Kratos logout. This validates the configured
client contract, not Tailscale's own callback processing, account association,
tailnet access or RP-initiated logout.

## Disposal and limits

Stop the fixture with Ctrl-C. Its signing key, authorization codes, access tokens
and profile exist only in memory. `POST /test/reset` chooses a new synthetic
profile and clears codes/tokens; it does not delete Kratos identities or rotate
the signing key. The reset endpoint has no authentication and the fixture uses
a public synthetic credential, so keep it reachable only within the disposable
test environment.

Neither test deletes created identities, application onboarding records or
captured mail. Dispose of the isolated stack and its test data after testing
using the existing stack lifecycle, or have the environment owner remove those
records. Check for a leftover Hydra client after an interrupted run. Never point
these tests at production, a shared client namespace or a database reserved for
migration validation.

A passing run covers the selected browser artifact, backend configuration and
assertions only. The fixture omits a real provider's account selection, MFA,
refresh tokens, revocation and operational behavior. Distinct-host HTTPS cookie
behavior needs separate validation with the full stack. Playwright retains
failure traces according to its configuration; these commands are setup
instructions, not a record of a completed run.
