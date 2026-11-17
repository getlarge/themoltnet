# Reusable Ory Compose services

`compose.yaml` is the service source shared by the standalone bundle and
consumer overlays. Extend the needed services by name; Compose resolves bind
paths relative to this module. Keep the extracted archive directory structure.
No service publishes a host port. Expose public APIs through a reverse proxy;
keep administrative endpoints on private networks.

Declare networks `ingress`, `database`, `services`, `identity`, and `credentials`
in the consumer. These stable network keys can refer to existing external
networks with the consumer's `name` and `external` settings. Declare volume
`talos-data` similarly; for established data use `external: true` and its
protected volume name. The standalone consumer accepts `TALOS_DATA_VOLUME`.

Set `ORY_TOOLS_IMAGE` independently from the application migration image. The
release locks both to the same database-tools digest initially. It contains
Node and pg. All first-party images are source-revision pinned; Ory,
its UI, and Talos use the module's explicit digest pins. `images.txt` lists
every effective image, including maintenance jobs.

Set `ORY_DB_HOST` (default `postgres`), `ORY_DB_PORT` (5432),
`ORY_DB_SSLMODE` (`disable` on a private Docker network or `verify-full`),
`ORY_DB_MAX_CONNECTIONS` (10), `ORY_DB_MAX_IDLE_CONNECTIONS` (2),
`ORY_DB_ADMIN_USER` (`postgres`), `ORY_DB_ADMIN_PASSWORD`, and independent
`KRATOS_DB_PASSWORD`, `HYDRA_DB_PASSWORD`, `KETO_DB_PASSWORD`. Use URL-safe
passwords for the Compose DSNs. Pool limits are supported
[Ory DSN query parameters](https://www.ory.com/docs/oss/deployment), applied
to Kratos, Hydra, and Keto serves and migration jobs. The administrator password is used only by
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

The other configuration variables match `../self-host/.env.example`.
`IDENTITY_DOMAIN` and `OAUTH_DOMAIN` remain independent for standalone ingress;
a consumer with one auth host sets both to that hostname and routes Kratos/UI
paths separately from Hydra discovery and OAuth paths. `TALOS_PUBLIC_ISSUER`
defaults to `https://${API_DOMAIN}`. Override environment fields in an overlay
for internal application hook endpoints or a different public URL layout.

Run `ory-db-init`, `talos-init` (new empty volumes only), then
`kratos-migrate`, `hydra-migrate`, `keto-migrate`, and `talos-migrate` explicitly
with `docker compose run --rm --no-deps SERVICE`. Start serves, then run
`hydra-native-client` to reconcile clients. All jobs use profile `maintenance`
and `restart: "no"`; serves have no migration dependencies. `talos-init`
refuses partial or established state. Talos serve requires existing keys and
database; migrations require existing keys and never replace them.

Back up and restore the complete Talos volume, including `talos.db`,
`jwks.json`, and `hmac-secret`. Do not delete it to retry initialization.
Keep administrator API credentials and generated keys out of logs and archives.

Data migration and live promotion procedures are separate from this runtime
bundle and are maintained privately.
