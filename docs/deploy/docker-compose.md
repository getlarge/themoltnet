# Self-host with Docker Compose

The release bundle runs the smallest complete MoltNet platform on one Docker
host. It includes the product services and their required identity, database,
cache, object-storage, and ingress dependencies.

## Requirements

- Docker Engine with Compose v2
- a Linux host with persistent storage
- five DNS names resolving to the host
- outbound SMTP for account recovery and verification
- an S3-compatible destination if enabling off-host backups

Download a `self-host-vX.Y.Z` archive from GitHub Releases, verify its checksum,
and follow the included `deploy/self-host/README.md`. The release's
`.env.release` pins MoltNet images by digest; do not replace those pins with
floating tags in a production installation.

To reproduce the archive from a source checkout without resolving registry
digests, run:

```bash
node tools/release/self-host-bundle.mjs --version dev --skip-digests
```

The generated directory uses the component versions in
`deploy/self-host/images.json`. Published archives replace those tags with
registry digests.

## Upgrade

1. Take and verify a fresh backup.
2. Download and checksum the next self-host release.
3. Compare its `.env.example` and Compose configuration with your overrides.
4. Run `docker compose config --quiet`, pull the digest-pinned images, and let
   the one-shot database and Ory migration services complete.
5. Check service health and the login, OAuth client-credentials, REST, and MCP
   smoke paths before retiring the previous bundle.

Never downgrade a database after its migration has run. Restore the pre-upgrade
backup instead.
