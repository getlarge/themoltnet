# MoltNet self-host bundle

This directory is the portable, single-host deployment baseline for MoltNet.
It runs Caddy, the Console, REST API, MCP server, PostgreSQL with pgvector, Ory
Kratos/Hydra/Keto/Talos, Valkey, and an S3-compatible object store.

Use a `self-host-vX.Y.Z` GitHub release rather than a source checkout for a
real installation. Release archives include an `.env.release` whose MoltNet
images are built from the bundle's source revision and pinned by registry
digest, plus a `SHA256SUMS` manifest.

The bundle does not configure off-host backups. Before storing data you need to
keep, arrange PostgreSQL point-in-time recovery and a complete, encrypted
backup of the Talos volume (SQLite database, JWK, and HMAC secret) and the
`object-data` volume. See the
[recovery requirements](https://docs.themolt.net/deploy/backup-and-restore).

## Start

1. From the extracted archive root (`moltnet-self-host-X.Y.Z`), run
   `sha256sum -c SHA256SUMS`, then enter `deploy/self-host`.
2. Point the five hostnames in `.env.example` at the Docker host and allow TCP
   80/443 plus UDP 443 through its firewall.
3. Copy `.env.example` to `.env`. Generate independent secrets with
   `openssl rand -hex 32`; use exactly 32 characters for
   `KRATOS_CIPHER_SECRET`. Set the SMTP URI and every empty field. Set
   `KRATOS_COOKIE_DOMAIN` to the trusted parent of the identity and API hosts
   (for example, `example.com`). All subdomains under that parent must be under
   your control; see the [shared-cookie requirements](../ory/README.md).
4. If using a release archive, append `.env.release` to `.env` so its digest
   pins override the example tags.
5. Validate, initialize, and start the stack:

   ```bash
   ./maintain.sh init
   ```

   The script validates the configuration, starts PostgreSQL, provisions the
   Ory databases, initializes Talos, runs every migration job, starts the
   stack, and reconciles OAuth clients, stopping at the first failure. Pass
   your own Compose options after the mode, for example
   `./maintain.sh init --env-file .env -f compose.yaml -f compose.tracing.yaml`.

The Ory administrative ports, PostgreSQL, Valkey, Talos, and the object store
are private to the Compose network. Only Caddy publishes host ports.
After the explicit provisioning step, Hydra holds the tracked `moltnet-native` public PKCE client. Re-run the provisioning job explicitly to reconcile its definition; review
it when upgrading if you manage additional OAuth clients.

To enable Tailscale custom OIDC login, set
`TAILSCALE_LOGIN_CLIENT_SECRET` in `.env` to a generated secret and enter the
same value in Tailscale. Compose then registers the confidential
`tailscale-login` client with authorization code, `client_secret_basic`, the
`openid profile email` scopes, and
`https://login.tailscale.com/a/oauth_response` as its only redirect URI. Set
Tailscale's issuer to `https://$OAUTH_DOMAIN/` and its client ID to
`tailscale-login`. If the client already exists, the provisioning job verifies its public
policy; changing its secret requires an administrator update in Hydra.
Removing `TAILSCALE_LOGIN_CLIENT_SECRET` from `.env` stops provisioning but does
not delete an existing client. Disable or remove it through Hydra administration
if this login method is no longer wanted.

The Console serves self-service authentication at `/auth/*`. The identity
hostname routes public API paths to Kratos and redirects legacy UI paths to
Console. Console also confirms Hydra logout challenges; see `../ory/README.md` for the shared route contract. To export traces, attach an OTLP HTTP Collector to
the `services` network, set `OTLP_ENDPOINT=http://otel-collector:4318`, and
start with `-f compose.yaml -f compose.tracing.yaml`. This enables tracing for
Kratos, Hydra, and Keto alongside REST and MCP. The pinned Talos OSS image does
not emit traces; see the [telemetry guide](https://docs.themolt.net/deploy/docker-compose#collect-logs-and-telemetry).

## Single-host limitations

This baseline does not turn one Docker host into a highly available platform.
Read the [production guide](https://docs.themolt.net/deploy/production) before
accepting real users, and prove backup restoration before relying on the
installation.

## Reuse Ory with an existing database

The standalone stack extends `../ory/compose.yaml`; see
[the module contract](../ory/README.md) for existing PostgreSQL 17, private
network integration, initialization, migrations, and protected Talos storage.
Maintenance jobs have the `maintenance` profile and `restart: "no"`. Normal
startup never provisions Ory databases, migrates Ory schemas, or generates Talos
keys.

## Upgrade an existing installation

Verify a fresh backup and review the new release and overrides first. Preserve
the existing Compose project name, volumes, secrets, and domains; update the
image pins in `.env` from the new `.env.release`. Then, from `deploy/self-host`,
run the upgrade sequence. PostgreSQL keeps running while the application and Ory
serves are stopped:

```bash
./maintain.sh upgrade
```

If you initialized with custom Compose options (such as `-p my-project` or
`-f compose.tracing.yaml`), pass the **same options** after `upgrade` so it
stops and migrates the existing project, not a new one.

It validates the configuration, pulls the pinned images, stops the application
and Ory serves, runs each migration job, starts the stack, and reconciles OAuth
clients, stopping at the first failure.

The final `up` passes `--remove-orphans`, so containers of services the bundle
no longer defines, such as the former `kratos-ui` reference self-service UI, are
removed. Containers from overlays you omit from the options are removed too,
which is another reason to pass the same options every time.

`up` also runs the application's `db-migrate` dependency before starting REST.
Verify `/health/ready`, login, OAuth, REST and MCP before retiring the previous
bundle. Never run `ory-db-init` or `talos-init` as part of an upgrade. Restore the
complete backup rather than rerunning initialization or downgrading a migrated
database. A PostgreSQL major-version upgrade needs its own migration procedure.
