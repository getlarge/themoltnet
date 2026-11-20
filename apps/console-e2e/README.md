# Console authentication browser validation

`e2e-auth` runs `src/auth-self-service.e2e.spec.ts` against a real Ory
Kratos endpoint and the Console. Use the disposable self-hosted fixture below,
or provision a separate non-production endpoint with the same capabilities.
The suite creates an identity, changes its password when mail tests are enabled,
and enrolls TOTP. Do not point it at production or a database snapshot reserved
for migration testing.

Run commands from the repository root. Install workspace dependencies with
`pnpm install` if needed, then install the browser:

```bash
pnpm --dir apps/console-e2e exec playwright install chromium
```

## Run the disposable fixture

You need Docker Compose and free ports 24433, 24434, 24437 and 25174. This
fixture uses SQLite in a named Docker volume and captures synthetic mail; it
does not start the MoltNet REST API or the full application stack.

```bash
COMPOSE_DISABLE_ENV_FILE=true docker compose -p console-auth-ui -f apps/console-e2e/fixtures/auth/compose.yaml run --rm migrate
COMPOSE_DISABLE_ENV_FILE=true docker compose -p console-auth-ui -f apps/console-e2e/fixtures/auth/compose.yaml up -d mail kratos
```

Start the Console in a separate terminal and leave it running:

```bash
NX_LOAD_DOT_ENV_FILES=false pnpm exec nx run @moltnet/console:dev --port=25174 --strictPort
```

Run the suite from another terminal:

```bash
NX_LOAD_DOT_ENV_FILES=false \
CONSOLE_BASE_URL=http://localhost:25174 \
KRATOS_PUBLIC_URL=http://localhost:24433 \
KRATOS_HEALTH_URL=http://localhost:24433/health/alive \
MAILSLURPER_API_URL=http://localhost:24437 \
AUTH_UI_INJECT_CONFIG=1 \
AUTH_UI_MAIL_TESTS=1 \
AUTH_UI_EXPIRY_TESTS=1 \
pnpm exec nx run @moltnet/console-e2e:e2e-auth
```

The target sets `AUTH_UI_TESTS=1` and `AUTH_UI_ONLY=1`. Global setup waits for
Kratos and the Console, but starts neither. In this mode it does not wait for
the API or mailbox; the mail test itself polls the mailbox. Keep the suite
serial: later tests depend on the identity created by the registration test.
Use `localhost` consistently; replacing only some URLs with `127.0.0.1` changes
origins and cookie behavior.

For a built Console artifact, use `@moltnet/console:preview` instead of `:dev`
with the same port flags; its Nx target builds the Console first. The test's
`AUTH_UI_INJECT_CONFIG=1` intercepts `/config.js` in each Playwright page and
supplies the selected Kratos and Console URLs, plus `REST_API_URL` (default
`http://localhost:8080`). This works for development and built artifacts, but
only inside the test browser.

Stop the Console with Ctrl-C. Remove the disposable identities and captured
mail by removing the fixture containers and database volume:

```bash
COMPOSE_DISABLE_ENV_FILE=true docker compose -p console-auth-ui -f apps/console-e2e/fixtures/auth/compose.yaml down -v
```

## Use a separately provisioned non-production endpoint

Start or deploy the Console and provision the backend before invoking the
suite. Replace the URLs below with your isolated environment:

```bash
NX_LOAD_DOT_ENV_FILES=false \
CONSOLE_BASE_URL=https://console.auth.example.test \
KRATOS_PUBLIC_URL=https://identity.auth.example.test \
KRATOS_HEALTH_URL=https://identity.auth.example.test/health/alive \
pnpm exec nx run @moltnet/console-e2e:e2e-auth
```

`KRATOS_HEALTH_URL` must return a successful status to the test runner; it can
be a separate reachable readiness endpoint. Configure the Console's real
`/config.js` with `kratosUrl`, `consoleUrl` and `apiBaseUrl`. Development mode
also supports `VITE_KRATOS_URL`, `VITE_CONSOLE_URL` and `VITE_API_BASE_URL`;
production requires runtime configuration. Set `AUTH_UI_INJECT_CONFIG=1` only
when deliberately testing an artifact against alternate endpoints; such a run
does not validate its served runtime configuration.

The backend must provide:

- Browser-flow CORS with credentials for the Console origin, working cookies,
  and UI URLs for `/auth/login`, `/auth/registration`, `/auth/settings`,
  `/auth/recovery`, `/auth/verification` and `/auth/error`.
- Password registration and login using `traits.email` as an identifier. The
  suite generates a unique `auth-ui-…@example.com` address and password; it
  optionally fills `traits.username` when that input is present. Other required
  traits or registration gates need a different fixture or test adaptation.
- Registration without automatic login, redirecting to `/auth/login`; logout
  returning to that route; `/auth/logout` allowed as a browser return URL; and
  rejection of `https://untrusted.example.test/` as a return URL.
- Settings with TOTP enrollment enabled and the secret exposed in the settings
  flow's `totp_secret_key` node. The runner generates codes from this synthetic
  secret and checks that subsequent login produces an `aal2` session.
- For `AUTH_UI_MAIL_TESTS=1`: code-based email verification and recovery, a
  Mailslurper-compatible API at `MAILSLURPER_API_URL`, and delivery of generated
  recipients' mail into that fixture. The helper reads `/mail?pageNumber=1`,
  matches recipient and send time, and extracts a six-digit code. Ordinary
  email delivery alone does not satisfy this requirement.
- For `AUTH_UI_EXPIRY_TESTS=1`: login flows that expire within the test's
  30-second polling window. The supplied fixture uses 15 seconds.

Mail and expiry cases are skipped unless their flags equal `1`; basic runs
still require TOTP. There are no pre-provisioned user credentials to supply.
External identities are not deleted by the suite: the environment owner must
remove the generated users and captured mail or dispose of that environment.

## Interpret the result

The suite exercises registration without auto-login, invalid credentials,
session persistence, logout, missing-flow recovery, unsafe return URL
rejection, reauthentication, settings, TOTP enrollment and second-factor login.
The opt-in cases also exercise expiry recovery, email verification, account
recovery and password reset. Set `AUTH_UI_VISUAL_TESTS=1` to include the reusable desktop/mobile, light/dark
login screenshot checks. Baselines were captured with Chrome on macOS; use the
same browser/platform or review deliberate baseline updates.

Failures retain Playwright traces according to
`playwright.config.ts`.

A successful fixture run demonstrates those paths for that Console artifact,
Kratos version and fixture configuration. It does not establish compatibility
with every Ory configuration, an actual deployment's proxy/TLS/cookie/CORS or
served runtime configuration, or Ory Network acceptance. Validate the actual
non-production integration separately with its intended configuration. Social
providers, passkeys, other MFA methods, OAuth login challenges, application API
access and the full Console suite are outside this target's assertions.

See [self-hosted identity configuration](../../docs/deploy/index.md) and
[the Console runtime configuration loader](../console/src/config.ts) for the
broader deployment context. This README describes the test procedure; it is
not a record of a passing run or deployment status.
