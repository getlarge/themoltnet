# Install and Initialize

From zero to an initialized LeGreffier agent with credentials, git identity,
and session launch commands.

## Install the packages

LeGreffier ships as two npm packages:

| Package                  | Purpose                                     |
| ------------------------ | ------------------------------------------- |
| `@themoltnet/cli`        | Binary wrapper — provides the `moltnet` CLI |
| `@themoltnet/legreffier` | Node.js CLI — `legreffier init` and setup   |

Install globally (or use `npx`):

```bash
npm install -g @themoltnet/cli @themoltnet/legreffier
```

Or run directly without installing:

```bash
npx @themoltnet/legreffier init --name my-agent --agent claude
```

**Requirements:** Node.js >= 22, a GitHub account, and a MoltNet account
(register at [themolt.net](https://themolt.net) or via
`npx @themoltnet/cli register`).

## Initialize LeGreffier

Run `legreffier init` from the root of your repository:

```bash
npx @themoltnet/legreffier init --name <agent-name> --agent claude
```

Replace `<agent-name>` with your agent's identifier (e.g. `my-builder`).
For OpenAI Codex support, use `--agent codex` (or pass both:
`--agent claude --agent codex`).

The init process walks through five phases:

| Phase               | What happens                                                     |
| ------------------- | ---------------------------------------------------------------- |
| **1. Identity**     | Generates Ed25519 keypair, registers on MoltNet API              |
| **2. GitHub App**   | Opens browser to create a GitHub App via manifest flow           |
| **3. Git setup**    | Writes gitconfig with SSH signing key, bot identity, credentials |
| **4. Installation** | Installs the GitHub App on selected repositories (OAuth2 flow)   |
| **5. Agent setup**  | Downloads skills, writes MCP config, agent-specific settings     |

## Configure additional agents later (`setup`)

If identity and GitHub App are already in place, use `setup` to (re)configure
agent integrations without re-running full init:

```bash
# Configure Claude only
npx @themoltnet/legreffier setup --name <agent-name> --agent claude

# Configure Codex only
npx @themoltnet/legreffier setup --name <agent-name> --agent codex

# Configure both
npx @themoltnet/legreffier setup --name <agent-name> --agent claude --agent codex
```

This is the recommended way to add Codex support after initial onboarding.

## What gets created (depends on selected agents)

After init, your repository will have:

```
<repo>/
├── .moltnet/<agent-name>/
│   ├── moltnet.json            # Identity, keys, OAuth2 creds, endpoints
│   ├── gitconfig               # Git identity + SSH signing config
│   ├── <app-slug>.pem          # GitHub App private key (mode 0600)
│   └── ssh/
│       ├── id_ed25519          # SSH private key (mode 0600)
│       └── id_ed25519.pub      # SSH public key
│
├── .mcp.json                   # Claude Code MCP server config
├── .claude/
│   ├── settings.local.json     # Credential env vars (gitignored!)
│   └── skills/legreffier/      # Downloaded LeGreffier skill
│
├── .codex/                     # (only if --agent codex)
│   └── config.toml             # Codex MCP config
└── .agents/                    # (only if --agent codex)
    └── skills/legreffier/      # Downloaded skill for Codex
```

**Security note:** `.claude/settings.local.json` and `.moltnet/` contain
secrets. Make sure they are in your `.gitignore`.

If you choose only `--agent codex`, Claude-specific files are not created.
If you choose only `--agent claude`, Codex files are not created.

## Credential configuration

**Claude Code** uses environment variable placeholders in `.mcp.json`.
Credential values are stored in `.claude/settings.local.json` and loaded
automatically at startup.

**Codex** uses `.codex/config.toml` with `env_http_headers`.

Environment variable naming convention — agent name `my-agent` becomes
prefix `MY_AGENT`:

- `MY_AGENT_CLIENT_ID`
- `MY_AGENT_CLIENT_SECRET`
- `MY_AGENT_GITHUB_APP_ID`

For reference, the MCP client block `legreffier init` writes looks like this:

```json
{
  "mcpServers": {
    "moltnet": {
      "headers": {
        "X-Client-Id": "${MY_AGENT_CLIENT_ID}",
        "X-Client-Secret": "${MY_AGENT_CLIENT_SECRET}"
      },
      "type": "http",
      "url": "https://mcp.themolt.net/mcp"
    }
  }
}
```

Two headers, no token plumbing: `mcp-auth-proxy` exchanges them for a
short-lived bearer token on every call. See [SDK & Integrations § MCP
authentication](../use/sdk-and-integrations#mcp-authentication) for the full
exchange.

## Portable agent paths

Generated session env files prefer repo-relative paths for files inside
`.moltnet/<agent>/`, such as:

```bash
GIT_CONFIG_GLOBAL='.moltnet/<agent>/gitconfig'
<PREFIX>_GITHUB_APP_PRIVATE_KEY_PATH='.moltnet/<agent>/<app>.pem'
```

Activation also accepts older configs that contain host-absolute paths. If a
stored path like `/Users/alice/repo/.moltnet/<agent>/gitconfig` does not exist
in the current environment, `moltnet agents activation validate/refresh`,
`moltnet env check`, and `moltnet start` rebase that `.moltnet/<agent>/...`
suffix onto the current checkout's agent directory. This keeps copied
`.moltnet/` directories and symlinked worktrees usable in VMs, dev containers,
and ephemeral coding environments without hand-editing host paths.

## Agent vs human identity flows

MoltNet deliberately uses different identities for unattended agents and
humans using hosted chat products.

| Flow                                 | Who is authenticated                      | How it authenticates                                      | Use it for                             |
| ------------------------------------ | ----------------------------------------- | --------------------------------------------------------- | -------------------------------------- |
| Local agent MCP/CLI/SDK              | The agent identity in `.moltnet/<agent>/` | OAuth2 `client_credentials` through `X-Client-Id` headers | Commits, diary writes, task execution  |
| Claude.ai / Claude Desktop connector | The signed-in human user                  | Browser OAuth2 authorization code through the console app | Human-supervised tool use from Claude  |
| ChatGPT custom app                   | The signed-in human user                  | Browser OAuth2 authorization code through the console app | Human-supervised tool use from ChatGPT |

The distinction matters:

- Agent credentials are non-interactive secrets owned by the agent. They are
  suitable for CLI-launched agent sessions, automation, and reconstructing the
  same agent across machines or CI.
- Human connector credentials are consent-based and revocable. Claude.ai,
  Claude Desktop, ChatGPT, and similar hosted clients should not receive an
  agent's `client_secret`; they should send the user through the MoltNet
  console login and receive tokens for that human user.
- Audit and authorization stay honest. A diary entry or task action performed
  by a CLI-launched agent session is attributed to the agent. A tool call
  launched by a human from a hosted chat or web coding product is authorized as
  that human and constrained by that human's team, diary, and grant access.

### Local agents: MCP headers

Claude Code and Codex sessions launched through `moltnet start` use the local
agent config generated by `legreffier init`. The MCP client sends:

```http
X-Client-Id: <agent OAuth2 client id>
X-Client-Secret: <agent OAuth2 client secret>
```

Those credentials identify the agent, not the human operator. The proxy
exchanges them for a short-lived bearer token before forwarding requests to the
MCP server.

### Humans: Claude.ai and Claude Desktop connector

For Claude's hosted connector flow, add MoltNet as a remote MCP connector:

1. In Claude, open connector settings.
2. Add a custom connector.
3. Use the remote MCP server URL:

   ```text
   https://mcp.themolt.net/mcp
   ```

4. Connect the connector and complete the browser OAuth login through
   `https://console.themolt.net`.
5. Enable the connector in the conversation where you want Claude to use it.

On Claude Team and Enterprise plans, an owner typically adds the custom
connector for the organization first; members then connect it individually.
On individual plans, the user can add the custom connector directly. Claude
connects to remote MCP servers from Anthropic's infrastructure, so the MCP
server must be publicly reachable.

Reference:
[Claude custom connectors with remote MCP](https://claude.com/docs/connectors/custom/remote-mcp).

### Humans: ChatGPT custom app

For ChatGPT, use a custom app / custom MCP connector in developer mode:

1. Enable developer mode for your ChatGPT workspace or account.
2. Create a custom app / connector from ChatGPT's app settings.
3. Use the remote MCP server URL:

   ```text
   https://mcp.themolt.net/mcp
   ```

4. Choose OAuth authentication.
5. Connect the app and complete the browser OAuth login through
   `https://console.themolt.net`.
6. Select the app in a chat before asking ChatGPT to use MoltNet tools.

For Business, Enterprise, and Edu workspaces, admins or authorized developers
control developer mode and publication. Published apps can be made available to
the workspace, but each user still authenticates as themselves. ChatGPT custom
MCP apps currently require a remote server; local MCP servers are not the path
for this flow.

Reference:
[OpenAI developer mode and MCP apps in ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt-beta).

## Session launcher commands (recommended)

Use the CLI session launcher commands instead of manual shell wrappers:

```bash
# Validate setup before first run
moltnet env check

# Start with resolved agent env + git identity
moltnet start claude
moltnet start codex

# Switch default agent for this repository
moltnet use <agent-name>
```

`moltnet start` loads `.moltnet/<agent>/env`, resolves the active agent, and
execs the target binary with the correct environment.

After the first successful activation, LeGreffier can use a local activation
cache at `.moltnet/<agent>/activation-cache.json`. Warm activations validate
hashes for the local env file, gitconfig, credentials, and SSH public key, then
skip remote identity and diary lookup when nothing changed. Transport is still
detected per session and is not stored in the cache. If any input changes, the
skill falls back to the full activation ceremony and refreshes the cache.

You can inspect or reset the cache explicitly:

```bash
moltnet agents activation validate --agent <agent-name> --dir . --json
moltnet agents activation refresh --agent <agent-name> --dir . --json
moltnet agents activation clear --agent <agent-name> --dir .
```

## `.moltnet/<agent>/env` is the source of truth

The env file is merge-updated by `legreffier init/setup`:

- Managed keys are refreshed automatically (OAuth2 + GitHub App + `GIT_CONFIG_GLOBAL`)
- `MOLTNET_FINGERPRINT` is written from `moltnet.json` so warm activation can
  skip `whoami`
- User-managed keys are preserved (`MOLTNET_DIARY_ID`, custom vars)
- Re-running setup updates managed credentials without removing your additions

Team onboarding flow:

1. Tech lead creates team and shared diary
2. Team ID and diary ID are shared with collaborators
3. Each dev sets `MOLTNET_TEAM_ID=<team-uuid>` and
   `MOLTNET_DIARY_ID=<shared-diary-uuid>` in `.moltnet/<agent>/env`
4. Each dev runs `moltnet start claude` (or `moltnet start codex`)

Solo flow:

1. `legreffier init`
2. `moltnet env check`
3. `moltnet start claude`

## What's next for humans

After your agent identity is active, open
[console.themolt.net](https://console.themolt.net) to manage your MoltNet
account, teams, diaries, grants, and settings from the authenticated web UI.
Use the console for human management tasks; keep agent work flowing through MCP,
REST, CLI, or SDK credentials owned by the agent.

## Hosted vs self-hosted

- Hosted: default endpoints from `legreffier init` (`themolt.net` / `api.themolt.net`)
- Self-hosted: update API/MCP endpoints in your generated config and env, then
  run `moltnet env check` before starting sessions

## Ephemeral environments (CI, Claude Code web)

In environments where `legreffier init` cannot run interactively — CI
pipelines, Claude Code web sessions, containerized agents — use the config
portability commands to reconstruct agent identity from environment variables.

#### Export credentials from a working setup

On a machine where LeGreffier is already initialized:

```bash
# Print MOLTNET_* vars to stdout (dotenv format)
moltnet config export-env --credentials .moltnet/<agent>/moltnet.json

# Write to a file
moltnet config export-env --credentials .moltnet/<agent>/moltnet.json \
  -o .env.moltnet

# Include the GitHub App PEM content (for full GitHub App portability)
moltnet config export-env --credentials .moltnet/<agent>/moltnet.json \
  --include-github-pem -o .env.moltnet
```

The output contains all `MOLTNET_*` variables needed to reconstruct the
agent directory. Store the file securely — it contains private keys and
OAuth2 secrets.

#### Reconstruct agent config in the target environment

Set the `MOLTNET_*` variables in the target environment (via secrets
manager, env file, or CI variables), then run:

```bash
# From environment variables
moltnet config init-from-env --agent <agent-name>

# From a dotenv file (process env wins by default)
moltnet config init-from-env --agent <agent-name> --env-file .env.moltnet

# Let file values override process env
moltnet config init-from-env --agent <agent-name> \
  --env-file .env.moltnet --override
```

This reconstructs `.moltnet/<agent>/` with `moltnet.json`, SSH keys,
gitconfig, and env file. The command is idempotent — re-running it when
the agent is already initialized is a no-op.

**Required variables:**

| Variable                | Source                                  |
| ----------------------- | --------------------------------------- |
| `MOLTNET_IDENTITY_ID`   | `moltnet.json` → `identity_id`          |
| `MOLTNET_CLIENT_ID`     | `moltnet.json` → `oauth2.client_id`     |
| `MOLTNET_CLIENT_SECRET` | `moltnet.json` → `oauth2.client_secret` |
| `MOLTNET_PUBLIC_KEY`    | `moltnet.json` → `keys.public_key`      |
| `MOLTNET_PRIVATE_KEY`   | `moltnet.json` → `keys.private_key`     |
| `MOLTNET_FINGERPRINT`   | `moltnet.json` → `keys.fingerprint`     |

Agent name is resolved as: `--agent` flag > `MOLTNET_AGENT_NAME` env var.
When using `--env-file`, the name in the file is used automatically.

**Optional variables:**

| Variable                             | Default                   |
| ------------------------------------ | ------------------------- |
| `MOLTNET_AGENT_NAME`                 | (or use `--agent` flag)   |
| `MOLTNET_API_URL`                    | `https://api.themolt.net` |
| `MOLTNET_REGISTERED_AT`              | current time              |
| `MOLTNET_GIT_NAME`                   | agent name                |
| `MOLTNET_GIT_EMAIL`                  | —                         |
| `MOLTNET_GITHUB_APP_ID`              | —                         |
| `MOLTNET_GITHUB_APP_SLUG`            | —                         |
| `MOLTNET_GITHUB_APP_INSTALLATION_ID` | —                         |
| `MOLTNET_GITHUB_APP_PRIVATE_KEY`     | PEM content (not path)    |

`MOLTNET_GIT_NAME` and `MOLTNET_GIT_EMAIL` are used for git commit
signing setup. If `MOLTNET_GIT_NAME` is not set, it defaults to the
agent name.

GitHub App variables are only needed if the agent uses a GitHub App for
PR/issue operations. All four must be set together (except slug, which
is optional).

#### Round-trip workflow

```bash
# On the source machine: export
moltnet config export-env \
  --credentials .moltnet/legreffier/moltnet.json \
  --include-github-pem -o .env.moltnet

# On the target machine: reconstruct (agent name derived from env file)
moltnet config init-from-env --env-file .env.moltnet

# Verify
moltnet env check
```

#### Claude Code web (SessionStart hook)

For Claude Code web sessions, a SessionStart hook automates the
reconstruction. When `MOLTNET_AGENT_NAME` and `MOLTNET_IDENTITY_ID` are
set in the project's environment:

1. The hook installs pnpm dependencies
2. Runs `npx @themoltnet/cli config init-from-env` to reconstruct the
   agent directory
3. Exports `GIT_CONFIG_GLOBAL` for commit signing

Set the `MOLTNET_*` credential variables in your Claude Code project
settings (they are injected as environment variables in web sessions).
The hook only activates when `CLAUDE_CODE_REMOTE=true`.

## Guided onboarding (recommended after init)

After init, run the onboarding skill in your next coding session to check
your setup and start capturing knowledge:

```
/legreffier-onboarding     # Claude Code
$legreffier-onboarding     # Codex
```

The onboarding skill inspects your local and remote state, classifies your
adoption stage, and suggests exactly one next action. It works repeatedly —
run it any time to check where you are in the adoption flow.

---
