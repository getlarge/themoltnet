# Reusable Ory Compose services

`compose.yaml` is the service source shared by the standalone bundle and
consumer overlays. Extend the needed services by name; Compose resolves bind
paths relative to this module. Keep the extracted archive directory structure:
the module binds configuration from `../../infra/ory` and its own directory.
No service publishes a host port. Expose public APIs through a reverse proxy;
keep administrative endpoints on private networks.

Declare networks `ingress`, `database`, `services`, `identity`, and `credentials`
in the consumer. These stable network keys can refer to existing external
networks with the consumer's `name` and `external` settings. Declare volume
`talos-data` similarly; for established data use `external: true` and its
protected volume name. The standalone consumer accepts `TALOS_DATA_VOLUME`.

Set `ORY_TOOLS_IMAGE` independently from the application migration image. The
release locks both to the same database-tools digest initially. It contains
Node and pg. All first-party images are source-revision pinned; Ory
and Talos use the module's explicit digest pins.

Set `ORY_DB_HOST` (default `postgres`), `ORY_DB_PORT` (5432),
`ORY_DB_SSLMODE` (`disable` on a private Docker network or `verify-full`),
`ORY_DB_MAX_CONNECTIONS` (10), `ORY_DB_MAX_IDLE_CONNECTIONS` (5),
`ORY_DB_ADMIN_USER` (`postgres`), `ORY_DB_ADMIN_PASSWORD`, and independent
`KRATOS_DB_PASSWORD`, `HYDRA_DB_PASSWORD`, `KETO_DB_PASSWORD`. Use URL-safe
passwords for the Compose DSNs. Pool limits are supported
[Ory DSN query parameters](https://www.ory.com/docs/oss/deployment), applied
to Kratos, Hydra, and Keto serves and migration jobs. At the defaults, the
three serves can hold 30 connections together; size the server's
`max_connections` for that plus the application. The administrator password is used only by
`ory-db-init`; serves receive only their own database credential. Run the
provisioner against a healthy database explicitly. It creates only missing
Ory roles/databases, preserves existing passwords and app ownership, and rejects
unexpected Ory database owners, elevated role flags, or role memberships.
The provisioner requires a PostgreSQL superuser to disable statement and
parameter logging for its administrator session. If your managed provider does
not permit those settings, have its administrator create the roles/databases
instead. Existing passwords are retained, not checked against supplied values.
Errors name the failed invariant or a SQLSTATE code without driver details.
For a database outside the private Docker network, explicitly use
`ORY_DB_SSLMODE=verify-full` and a server certificate trusted by the containers;
only `disable` and `verify-full` are supported by the provisioner.

The Console serves authentication screens under `/auth/*`, using its existing
`kratosUrl` and `consoleUrl` runtime settings for either Ory Network or this
self-hosted module. The canonical routes live in
`apps/console/src/auth/routes.json`; the configuration contract test checks the
Network template, local configuration, and this module against them. Point
Kratos flow UI URLs and Hydra login/registration/error URLs at those Console
routes. Keep allowed return URLs, credentialed CORS, and same-site cookies
aligned with the public origins. Include the API origin in its own CORS
allowlist so browser consent form submissions are accepted. Registration returns to login so the login
hook completes human onboarding. OAuth consent remains on REST API at
`/oauth2/consent`.

Hydra logout challenges also use Console at `/auth/logout`. After explicit
confirmation, REST API validates that the challenge belongs to the current
human session, accepts it through Hydra's admin API, and Console ends the
Kratos session before following Hydra's continuation. The browser test procedure and
its validation limits are documented in `apps/console-e2e/README.md` in the
source checkout. Do not change live project settings as part of packaging.

The other configuration variables match `../self-host/.env.example`.
`IDENTITY_DOMAIN` and `OAUTH_DOMAIN` remain independent for standalone ingress;
a consumer with one auth host sets both to that hostname and routes Kratos API
paths separately from Hydra discovery and OAuth paths. `TALOS_PUBLIC_ISSUER`
defaults to `https://${API_DOMAIN}`. Kratos calls the application's hooks at
`ORY_HOOK_BASE_URL` (default `http://rest-api:8080`, on the `identity`
network). Override other environment fields in an overlay for a different
public URL layout.

The standalone bundle runs the sequences below with
`deploy/self-host/maintain.sh init|upgrade`. Other consumers run the jobs
themselves: `ory-db-init`, `talos-init` (new empty volumes only), then
`kratos-migrate`, `hydra-migrate`, `keto-migrate`, and `talos-migrate` explicitly
with `docker compose run --rm --no-deps SERVICE`. Start serves, then run
`hydra-native-client` to reconcile clients. All jobs use profile `maintenance`
and `restart: "no"`; serves have no migration dependencies. `talos-init`
refuses partial or established state. Talos serve requires existing keys and
database; migrations require existing keys and never replace them.

Back up and restore the complete Talos volume, including `talos.db`,
`jwks.json`, and `hmac-secret`. Do not delete it to retry initialization.
Keep administrator API credentials and generated keys out of logs and archives.

The development stack (`docker-compose.base.yaml`) defines its own Ory
services with development flags and per-service databases. It is
intentionally separate from this module; the self-host smoke tests exercise
this module's lifecycle.

Data migration and live promotion procedures are separate from this runtime
bundle and are maintained privately.
