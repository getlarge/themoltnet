# MoltNet self-host bundle

This directory is the portable, single-host deployment baseline for MoltNet.
It runs Caddy, the Console, REST API, MCP server, PostgreSQL with pgvector, Ory
Kratos/Hydra/Keto/Talos, Valkey, and an S3-compatible object store.

Use a `self-host-vX.Y.Z` GitHub release rather than a source checkout for a
real installation. Release archives include an `.env.release` whose MoltNet
images are pinned by registry digest and a `SHA256SUMS` manifest.

## Start

1. Point the five hostnames in `.env.example` at the Docker host and allow TCP
   80/443 plus UDP 443 through its firewall.
2. Copy `.env.example` to `.env`, replace every placeholder, and set
   `ACME_EMAIL` if desired.
3. If using a release archive, append `.env.release` to `.env` so its digest
   pins override the example tags.
4. Validate and start the stack:

   ```bash
   docker compose --env-file .env config --quiet
   docker compose --env-file .env up -d
   docker compose --env-file .env ps
   ```

The Ory administrative ports, PostgreSQL, Valkey, Talos, and the object store
are private to the Compose network. Only Caddy publishes host ports.

## Single-host limitations

This baseline does not turn one Docker host into a highly available platform.
Read the [production guide](https://docs.themolt.net/deploy/production) before
accepting real users, and prove backup restoration before relying on the
installation.
