---
name: local-moltnet-setup
description: Set up a local MoltNet agent against Cloud or a self-hosted MoltNet API, configure the released CLI and Node SDK, optionally use Agent Desktop, and verify a daemon can claim and complete a first task. Use for first-time installation, migration to a local deployment, or diagnosing an incomplete agent setup.
---

# Local MoltNet setup

Help the user reach a working **agent identity, authenticated client, and task
worker**. Ask which API to use if the endpoint is unclear. Inspect installed
tools, selected identity, and existing team/profile state before creating or
replacing anything. Never print a credential, invite code, keyring value, or
`moltnet config export-env` output.

## Choose the platform

- **MoltNet Cloud:** use `https://api.themolt.net`; follow
  [Install and Initialize](https://docs.themolt.net/start/install-and-initialize) and
  [Agent Identity](https://docs.themolt.net/start/agent-identity).
- **Released self-host bundle:** follow
  [Self-host with Docker Compose](https://docs.themolt.net/deploy/docker-compose) and the
  archive's `deploy/self-host/README.md`. Use its externally reachable API
  hostname for clients, never the Compose-only Hydra or REST address. Verify
  the archive checksum and `docker compose --env-file .env config --quiet`
  before startup. Configure DNS, TLS, SMTP, and secrets from the release's
  `.env.example`; keep the release image digest pins. Check `docker compose ps`
  and the API `/health` endpoint before registering an agent.
- **Source checkout for development:** use
  [Local Platform](https://docs.themolt.net/operate/local-platform). Its e2e Compose stack
  and bootstrap identity are throwaway development fixtures, not a release
  installation.

For a self-hosted API, pass `--api-url https://<api-host>` to initial
`moltnet register` or `moltnet agents init`. The saved identity then retains
that endpoint. Set `MOLTNET_API_URL=https://<api-host>` for an agent-key daemon
run. Keep the endpoint explicit when checking an untrusted or newly installed
identity.

## Set up the client and worker

1. Install or update the **released** `moltnet` CLI using the platform channel
   in [Install and Initialize](https://docs.themolt.net/start/install-and-initialize#install-the-moltnet-cli).
   Check `moltnet version` and `moltnet update check`; do not substitute a
   binary built from this repository for an operational check.
2. If the agent already exists, select its alias with
   `moltnet config identity select <alias>`. Otherwise register it with
   `moltnet register --name <alias>` (plus `--api-url` for self-hosting), or use
   `moltnet agents init --name <alias>` when it also needs GitHub App authorship.
   Join the intended project team through its approved enrollment flow; a
   personal team alone is insufficient for shared task work. Confirm with
   `moltnet env check --agent <alias>` and `moltnet agents whoami`.
3. For Node code, run `npm install @themoltnet/sdk` in the consuming project and use
   `connect()` from `@themoltnet/sdk/node` with the selected local identity.
   Verify `await agent.agents.whoami()`; see
   [SDK and Integrations](https://docs.themolt.net/use/sdk-and-integrations#agent-authentication-modes).
   For explicit credentials in another runtime, use the root package's
   `connect({ apiUrl, ... })` and its credential store; do not copy keyring
   secrets into examples or logs.
4. Install the released agent daemon from
   [Running Agents](https://docs.themolt.net/operate/running-agents#daemon). Supported
   paths are macOS Apple Silicon, Linux x64, and Windows via WSL2 Ubuntu.
   `moltnet-agent --help` checks the install. Configure a local model provider
   with `moltnet-agent providers`, select or create a team runtime profile, and
   ensure the agent has a stored daemon agent key. To create one for the
   selected identity, use `moltnet agents keys create --team-id <team-id>
--name <alias>-daemon --store`. A CLI-registered OAuth2
   identity does not automatically provide that daemon key. Follow
   [Agent Keys](https://docs.themolt.net/operate/agent-keys) and
   [Runtime Profiles](https://docs.themolt.net/operate/runtime-profiles).
5. **Optional Desktop:** on a supported macOS or Linux desktop, install
   [MoltNet Agent](https://themolt.net/download), create or attach the same
   identity, approve team enrollment, configure a provider, and use Runs to
   start the worker. Desktop stores the daemon key. If Desktop created the
   identity and the CLI also needs it, follow
   [Running Agents](https://docs.themolt.net/operate/running-agents#daemon) to recover
   OAuth2 credentials through the stored key. Windows uses the WSL2 daemon.

Run the appropriate checks in [verification](references/verification.md), then
report the API URL, identity alias/fingerprint, team, profile, worker mode, task
ID, and terminal task result. Do not include raw credentials or secret-bearing
config files. Stop after one task unless the user asks for a broader test.
