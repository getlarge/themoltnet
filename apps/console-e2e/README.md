# Console authentication browser validation

`e2e-auth` runs `src/auth-self-service.e2e.spec.ts` against the Console's
self-service authentication UI and real Ory Kratos browser flows. Local
validation uses the existing `docker-compose.e2e.yaml` stack, including the
MoltNet REST API, registration/settings hooks and Mailpit. There is no separate
authentication stack or test-only runtime configuration override.

The suite creates a synthetic identity, verifies its email, resets its password,
and enrolls and removes TOTP. Use disposable self-hosted infrastructure or a
separately provisioned non-production environment. Do not run it against
production or a database snapshot reserved for migration testing.

## Run against the E2E stack

Run these commands from the repository root. Install workspace dependencies with
`pnpm install` if needed, then install the browser and start the standard E2E
stack from your current checkout:

```bash
pnpm --dir apps/console-e2e exec playwright install chromium
pnpm run e2e:up
NX_LOAD_DOT_ENV_FILES=false pnpm exec nx run @moltnet/console-e2e:e2e-auth
```

The Console image serves the current built UI at `http://localhost:5174`, with
runtime configuration pointing to Kratos at `http://localhost:4433` and the API
at `http://localhost:8080`. Mailpit is available at `http://localhost:8025`.
Use `localhost` consistently; changing only some URLs to `127.0.0.1` changes
origins and cookie behavior. See [E2E Tests](../../AGENTS.md#e2e-tests) for
`NX_LOAD_DOT_ENV_FILES` and rebuilding images after source changes.

The target enables `AUTH_UI_TESTS=1`. Global setup waits for Kratos, the REST
API, the Console and Mailpit; it starts none of them. Keep the suite serial:
later cases depend on the identity registered earlier.

To work on the same UI with Vite instead of the built container, stop the
stack's Console and start the development server in a separate terminal:

```bash
COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml stop console
NX_LOAD_DOT_ENV_FILES=false \
VITE_KRATOS_URL=http://localhost:4433 \
VITE_API_BASE_URL=http://localhost:8080 \
VITE_CONSOLE_URL=http://localhost:5174 \
pnpm exec nx run @moltnet/console:dev --port=5174 --strictPort
```

Run the same `e2e-auth` command while that server is running. Stop Vite with
Ctrl-C when finished, then tear the stack down with `pnpm run e2e:down`.

## Optional checks

`AUTH_UI_VISUAL_TESTS=1` enables desktop/mobile and light/dark login screenshots,
a missing-flow notice screenshot, and an enrolled-TOTP settings screenshot:

```bash
NX_LOAD_DOT_ENV_FILES=false AUTH_UI_VISUAL_TESTS=1 pnpm exec nx run @moltnet/console-e2e:e2e-auth
```

Committed screenshot filenames target macOS (`darwin`). Match the baseline
platform and browser; `PLAYWRIGHT_CHANNEL` selects an installed browser channel.
Other platforms need reviewed baselines. A screenshot comparison is not evidence
of an untested browser or deployment.

`AUTH_UI_EXPIRY_TESTS=1` enables an additional expired-login-flow case. It requires
a backend login-flow lifespan short enough to expire within the test's 30-second
polling window. The standard self-hosted configuration uses one hour, so leave
this flag unset for the commands above. Configure a disposable backend with a
short lifespan before enabling it; missing-flow and CSRF-restart cases run
without this flag.

## Use a separately provisioned non-production environment

Provision the Console, API, identity service and captured mail before running
the suite. Replace these example endpoints with the isolated environment's URLs:

```bash
NX_LOAD_DOT_ENV_FILES=false \
CONSOLE_BASE_URL=https://console.auth.example.test \
KRATOS_PUBLIC_URL=https://identity.auth.example.test \
KRATOS_HEALTH_URL=https://identity.auth.example.test/health/alive \
REST_API_URL=https://api.auth.example.test \
REST_API_HEALTH_URL=https://api.auth.example.test/health \
MAILPIT_API_URL=https://mail.auth.example.test \
pnpm exec nx run @moltnet/console-e2e:e2e-auth
```

Health URLs must return a successful status to the runner. The Console's served
`/config.js` must contain matching `kratosUrl`, `consoleUrl` and `apiBaseUrl`
values. Development mode also supports `VITE_KRATOS_URL`, `VITE_CONSOLE_URL` and
`VITE_API_BASE_URL`; production requires runtime configuration. Test environment
variables select runner endpoints; they do not rewrite the Console's config.

The backend must provide:

- Browser-flow CORS with credentials for the Console origin, working cookies,
  and UI URLs for `/auth/login`, `/auth/registration`, `/auth/settings`,
  `/auth/recovery`, `/auth/verification` and `/auth/error`.
- Password registration and login using email as an identifier. The suite
  generates a unique `auth-ui-…@example.com` address and password, filling
  `traits.email` and, when present, `traits.username`. Additional required traits
  or registration gates need an appropriate fixture or test adaptation.
- Registration without automatic login, returning to `/auth/login`; logout
  leading to a usable login form; `/auth/logout` allowed as a browser return URL;
  and rejection of `https://untrusted.example.test/` as a return URL. Configure
  the application's registration/login/settings hooks as required by the
  intended integration.
- Settings with TOTP enrollment and removal enabled, with its secret exposed in
  the settings flow's `totp_secret_key` node. The runner generates codes from
  this synthetic secret and checks a subsequent login produces an `aal2` session.
- Code-based email verification and recovery, plus delivery of generated
  recipients' mail into Mailpit. Its API must support `/api/v1/messages`,
  `/api/v1/search` and `/api/v1/message/{id}`. The helper matches recipient and
  receive time and extracts a six-digit code. Ordinary email delivery alone
  does not meet this requirement.

No pre-provisioned user credentials are supplied. External identities and mail
are not deleted by the suite; the environment owner must remove them or dispose
of the environment after testing.

## Interpret the result

`AUTH_UI_OAUTH_TESTS=1` additionally creates and deletes a synthetic Hydra
client and checks challenge reauthentication, REST API consent, the
authorization-code callback and RP-initiated logout. It requires
`HYDRA_ADMIN_URL` (default `http://localhost:4445`) and `HYDRA_PUBLIC_URL`
(default `http://localhost:4444`) for the same disposable stack. CI enables
this case and the core cases; expiry and screenshots are separate opt-ins.
Failures retain Playwright traces according to `playwright.config.ts`.

Localhost ports share cookie scope, unlike separate identity and API hostnames.
The default stack therefore does not validate the self-hosted shared-cookie
boundary. Before accepting a multi-host deployment, check login, consent and
RP-initiated logout with its distinct HTTPS hosts and `KRATOS_COOKIE_DOMAIN`
using the same full stack, not an auth-only replacement fixture. See the
[shared-cookie requirements](../../deploy/ory/README.md).

A passing run covers only the asserted paths for the selected Console artifact,
backend version and configuration; validate any other deployment separately.
Synthetic social-provider and mock Tailscale relying-party checks have separate
[isolated OIDC acceptance setup](./fixtures/oidc/README.md). Live social
providers, passkeys, other MFA methods, application API access and the full
Console suite are outside this target's assertions.
