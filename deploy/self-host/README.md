# MoltNet self-host bundle

This directory is the portable, single-host deployment baseline for MoltNet.
It runs Caddy, the Console, REST API, MCP server, PostgreSQL with pgvector, Ory
Kratos/Hydra/Keto/Talos, Valkey, and an S3-compatible object store.

Use a `self-host-vX.Y.Z` GitHub release rather than a source checkout for a
real installation. Release archives include an `.env.release` whose MoltNet
images are pinned by registry digest and a `SHA256SUMS` manifest.

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
   `KRATOS_CIPHER_SECRET`. Set the SMTP URI and every empty field.
4. If using a release archive, append `.env.release` to `.env` so its digest
   pins override the example tags.
5. Validate and start the stack:

   ```bash
   docker compose --env-file .env config --quiet
   docker compose --env-file .env up -d
   docker compose --env-file .env ps
   ```

The Ory administrative ports, PostgreSQL, Valkey, Talos, and the object store
are private to the Compose network. Only Caddy publishes host ports.
Hydra provisions the tracked `moltnet-native` public PKCE client before the REST
API starts. The same client definition is reapplied on subsequent starts; review
it when upgrading if you manage additional OAuth clients.

## Single-host limitations

This baseline does not turn one Docker host into a highly available platform.
Read the [production guide](https://docs.themolt.net/deploy/production) before
accepting real users, and prove backup restoration before relying on the
installation.
