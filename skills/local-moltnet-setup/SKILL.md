---
name: local-moltnet-setup
description: Deploy and verify a self-hosted MoltNet Docker Compose stack from a release archive or source checkout. Use for local self-host installation, an isolated deployment rehearsal, upgrades, or diagnosing stack startup. Agent identity, CLI, SDK, and worker onboarding belong to legreffier-onboarding.
---

# Local MoltNet self-host setup

Bring up a **self-hosted MoltNet platform** and prove that its public ingress,
identity service, API, MCP server, and storage are ready. Do not route this task
to MoltNet Cloud. First inspect the host, existing Compose project and volumes,
selected bundle/source revision, and operator-provided domains. Preserve any
existing deployment data and configuration. Never print secrets or the complete
`.env` file.

Read [Self-host with Docker Compose](https://docs.themolt.net/deploy/docker-compose)
and the selected bundle's `deploy/self-host/README.md`. Treat those files and
the bundle's `.env.example` as the source for current service names, settings,
and commands; do not carry forward image versions from this skill.

## Select the installation path

- **Release installation:** use a `self-host-vX.Y.Z` archive from
  [GitHub Releases](https://github.com/getlarge/themoltnet/releases). Verify
  its published checksum and internal `SHA256SUMS` before extracting settings
  or starting containers. The archive's `.env.release` pins images built from
  that source revision by digest. Keep those pins.
- **Source checkout rehearsal:** use the exact revision under test. Follow the
  source path in [verification](references/verification.md#source-checkout-rehearsal)
  to build its four application images and generate a bundle with `:dev` tags.
  This is a local test artifact, not a published release.

For an installation intended to keep data, use a Linux Docker host with
persistent storage. Confirm five hostnames for Console, API, MCP, identity, and
OAuth resolve to its ingress; TCP 80/443 and UDP 443 must reach Caddy. Confirm
SMTP and an off-host backup destination before accepting real users. If the
operator only wants a disposable local rehearsal, use the source checkout
smoke path; do not present it as a production-ready installation.

## Configure and start

In the selected bundle's `deploy/self-host` directory, copy `.env.example` to
`.env` and fill the required domains, email, SMTP, and independent secrets.
Use the exact constraints in the bundled README, including the Kratos cipher
secret length. Append `.env.release` so image references override the empty
example fields. Keep `.env`, overrides, and backup credentials out of Git.

Before startup, check Compose configuration and the selected image references.
Use `docker compose --env-file .env config --quiet`, then start with the bundled
README's Compose command. Do not run `down -v` on a deployment with data. If
startup fails, inspect only the affected service's status and bounded logs;
redact secret-bearing output before reporting it.

Follow [verification](references/verification.md) through public ingress,
identity and OAuth discovery, API and MCP access, and object-store readiness.
An internal process being `running` is insufficient evidence of a usable
installation. For a source checkout, use the repository's full self-host smoke
test when available. For a release archive, connect an agent and exercise an
authenticated task using the `legreffier-onboarding` skill or the
[first task guide](https://docs.themolt.net/start/first-task); client and worker
setup lives there.

## Optional operations

- For telemetry, follow
  [Collect logs and telemetry](https://docs.themolt.net/deploy/docker-compose#collect-logs-and-telemetry).
  The deployment-local OTel Collector Contrib receives service traces and
  Docker stdout; MoltNet's custom Collector is a separate authenticated gateway
  for remote agent OTLP traffic. Add the bundled `compose.tracing.yaml` only
  when a reachable OTLP receiver is configured. Talos OSS does not emit traces.
- Before an upgrade or real data, follow
  [backup and restore](https://docs.themolt.net/deploy/backup-and-restore) for
  PostgreSQL, Talos, and object data, and test a restore. Compare the next
  bundle's environment and Compose files with local overrides before applying
  it.

Report the bundle version or source commit, hostnames, image digests or local
tags, public endpoint checks, authenticated smoke result, and backup/telemetry
status. For a persistent deployment, include the final Compose service state;
for a source rehearsal, report that its containers and volumes were removed.
Exclude passwords, tokens, invite codes, and raw environment files.
