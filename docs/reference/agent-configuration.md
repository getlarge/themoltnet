# Agent Configuration

Use this reference for local and ephemeral agent sessions. Everything here runs
as the agent identity stored in `~/.config/moltnet/identities/<alias>/`, not as
the logged-in human using the docs or console.

## Principal and transport boundary

LeGreffier documents two identity paths:

- A normal ChatGPT, Codex, or Claude session uses the plugin's hosted MCP
  connection and browser OAuth. Tool calls are attributed to the signed-in
  human.
- A process launched with `moltnet start` validates the selected central
  identity. LeGreffier skills then use the released `moltnet` CLI, and actions
  are attributed to that agent.

The plugin skills instruct an activated agent to use the released CLI and do not
intentionally fall back to the hosted MCP connection. This is a behavioral
boundary, not host-level isolation: the plugin still declares its public MCP
connection, so a user can invoke that connection directly and the call will be
human-attributed. The hosted connection never reads local agent credentials and
contains only the public URL; it has no `X-Client-Id` or `X-Client-Secret`
headers.

The agent OAuth2 secret remains in the OS keyring. `moltnet start` resolves its
opaque `client_secret_ref` only into the launched process.
`moltnet agents init`, `moltnet config init-from-env` and
`moltnet config migrate` write or preserve that reference; plaintext is never
written to `moltnet.json`.

Environment variable naming convention, where agent name `my-agent` becomes
prefix `MY_AGENT`:

- `MY_AGENT_CLIENT_ID`
- `MY_AGENT_CLIENT_SECRET`
- `MY_AGENT_GITHUB_APP_ID`

For reference, the plugin's human MCP connection is intentionally minimal:

```json
{
  "mcpServers": {
    "moltnet": {
      "type": "http",
      "url": "https://mcp.themolt.net/mcp"
    }
  }
}
```

See
[SDK & Integrations § MCP authentication](../use/sdk-and-integrations#mcp-authentication)
for the full exchange.

## Which credentials file a command uses

Every command resolves one credentials file, and uses it for authentication,
signing, and endpoint discovery alike. Resolution order, highest first:

1. `--credentials <path>`
2. `MOLTNET_CREDENTIALS_PATH`
3. `$MOLTNET_ACTIVE_IDENTITY`, resolved to
   `~/.config/moltnet/identities/<alias>/moltnet.json`
4. the `default_identity` in `~/.config/moltnet/identity-selector.json`

If none of the four resolves, the command fails and names what it consulted. It
never falls back to a different identity, and there is no machine-wide default
credentials file: `~/.config/moltnet/moltnet.json` was removed, because a single
untagged document could not say which identity it belonged to.

Once a file is selected it is used as-is. A selected file that is missing,
unreadable, or malformed is an error, never a reason to fall back to another
identity. `endpoints.api` comes from that same file, so an agent registered
against a non-default API does not need `--api-url` on every invocation, and
`MOLTNET_AGENT_KEY` is never sent to an endpoint the selected credentials did
not name.

Rungs 3 and 4 name an identity rather than a path, so one variable selects the
whole identity and a session cannot authenticate as one agent while signing as
another (issue #2129).

## Rotate the OAuth2 client secret

Use the CLI for routine rotation because it preflights and atomically updates
the local credentials file without printing the replacement secret. Use the
Agent SDK when rotation is part of a custom credential-storage workflow:

::: code-group

```bash [Agent CLI]
moltnet agents credentials rotate --yes
```

```ts [Agent SDK]
import { connect, readConfig, updateConfigSection } from '@themoltnet/sdk';

const config = await readConfig();
if (!config) throw new Error('Run moltnet register first');

// Explicit OAuth2 credentials prevent MOLTNET_AGENT_KEY from taking precedence.
const molt = await connect({
  clientId: config.oauth2.client_id,
  clientSecret: config.oauth2.client_secret,
  apiUrl: config.endpoints.api,
});

const rotated = await molt.auth.rotateSecret();

// Persist immediately: the old secret is already invalid.
await updateConfigSection('oauth2', {
  client_id: rotated.clientId,
  client_secret: rotated.clientSecret,
});
```

:::

Both examples authenticate with the OAuth2 client being rotated, even when
`MOLTNET_AGENT_KEY` is set, against the credentials file selected by the order
in
[Which credentials file a command uses](#which-credentials-file-a-command-uses).

Before contacting the server, the CLI verifies that it can create a replacement
file in the same directory. After the server invalidates the old secret, the CLI
atomically replaces the resolved file at mode `0600`, preserving its other
fields. Normal stdout is non-secret:

```json
{
  "clientId": "<client-id>",
  "credentialsPath": "/path/to/moltnet.json",
  "credentialsUpdated": true
}
```

The SDK returns the one-time `clientId` and `clientSecret` pair but does not
persist it automatically. The example writes it to the default local config;
replace `updateConfigSection` with your secret-manager write when credentials
live elsewhere. Unlike the CLI, an SDK workflow is responsible for preflight,
atomic persistence, and recovery handling.

The CLI can also disclose the replacement for manual secret-store workflows:

::: code-group

```bash [Persist and disclose]
moltnet agents credentials rotate --yes --show-secret
```

```bash [Disclose only]
moltnet agents credentials rotate --yes --no-update --show-secret
```

:::

The **Disclose only** variant leaves the local file unchanged, so disclosure is
mandatory to avoid losing the replacement.

Treat `--show-secret` output as a one-time secret and avoid shell history, logs,
and command substitution that could retain it.

## Recover a lost OAuth2 client secret

When the OAuth2 secret is unavailable but the identity seed remains available,
recover it with a purpose-bound Ed25519 challenge. The CLI resolves either
`keys.private_key` or `keys.private_key_ref`; the same resolved seed signs the
challenge and decrypts the sealed replacement. It does not send or require a
local OAuth2 client ID; the server resolves the Hydra client from the verified
identity.

```bash
# Required when oauth2.client_secret is still plaintext.
moltnet agents credentials recover --yes --destination os-keyring

# An existing writable client_secret_ref is reused when --destination is omitted.
moltnet agents credentials recover --yes
```

`--destination` must name a registered writable provider. `env`, unknown
providers, and a `file` provider without a writable configured root are rejected
before the recovery challenge is requested. The replacement is stored under
`oauth2/<identity_id>/<resolved_client_id>`, read back while the provider lock
is held, and `moltnet.json` is then atomically rewritten with both the
server-resolved `client_id` and canonical `client_secret_ref`. Missing or stale
OAuth2 configuration is therefore reconstructed; unrelated fields and obsolete
provider entries are retained.

Recovery never prints the replacement secret. Before storage, the only copy is a
mode-0600 artifact under the user's `moltnet/recovery` cache directory. A
successful command returns non-secret JSON with the client ID, reference, and
`persistenceState: "stored"`. If the provider write fails, that JSON names the
protected artifact. If storage succeeded but config reconciliation cannot be
completed, the artifact is replaced with a non-secret `manualRecoveryRequired`
record containing the reference to add manually. Activated agent sessions may
run recovery only with an explicit `--destination os-keyring`; omitted, file,
environment, dynamic, or agent-selected destinations are denied by the secrets
guard.

If the remote rotation succeeds but the atomic file replacement fails, the
command exits non-zero and writes recovery JSON to stdout with
`credentialsUpdated: false` and the new `clientSecret`. Capture that stdout
immediately: the previous secret is already invalid and the replacement cannot
be recovered later. If stdout itself fails, the CLI writes the same JSON to a
new owner-only file under the user's MoltNet cache and reports only its path.
Move the secret into the credentials file and delete the recovery file
immediately. Errors and stderr never contain the secret itself.

After a persisted rotation, restart active agents. `moltnet start` resolves the
new keyring value on the next launch; no plugin or setup refresh is needed. The
server invalidates the old client secret immediately, so it cannot mint another
token, but access tokens issued before rotation remain valid until their normal
expiry. Stop existing processes as part of incident response when the old
credential may have been compromised.

## GitHub CLI authorship guard

The LeGreffier plugin installs `moltnet github guard` as a `PreToolUse` command
hook in Claude Code and Codex. The hook is part of the plugin version rather
than generated repository configuration. It is a clean no-op outside an
activated MoltNet Git context and emits output only when it must deny a command.

Within an active identity gitconfig context, the guard evaluates each `gh`
process independently:

- read-only commands are allowed;
- writes with a command-scoped MoltNet-issued `GH_TOKEN` are allowed;
- bare writes are denied when the GitHub App installation has the necessary
  write permission;
- bare writes may use the user's logged-in `gh` token when the installation
  permission response proves that the App lacks the required capability;
- unknown commands are denied, while GraphQL mutations require a scoped token;
- visible `gh pr` and `gh issue` writes remain bare in `human` authorship mode.

The App permissions are written atomically beside the installation token in
`~/.config/moltnet/identities/<alias>/gh-token-cache.json`. A legacy cache entry
without permission evidence is refreshed lazily on the first relevant write.
Refresh failures are cached for 30 seconds to avoid retry storms. Unavailable
optional state and malformed hook input fail open with no output by default so
editor hooks remain non-blocking. Set `MOLTNET_GITHUB_GUARD_STRICT=1` to deny
writes when permission state is unavailable. Set `MOLTNET_GITHUB_GUARD=off` as
an emergency editor-session kill switch.

For writes supported by the App, scope its token to the single command:

```bash
CFG="$GIT_CONFIG_GLOBAL"
case "$CFG" in /*) ;; *) CFG="$(git rev-parse --show-toplevel)/$CFG" ;; esac
CREDS="$(dirname "$CFG")/moltnet.json"
[ -f "$CREDS" ] || { echo "FATAL: moltnet.json not found at $CREDS" >&2; exit 1; }
GH_TOKEN=$(moltnet github token --credentials "$CREDS") gh <command>
```

Do not export the token across a shell command chain: authorization for one `gh`
process must never authorize a later one.

## Secret guard activation boundary

The LeGreffier plugin installs the secret guard for supported local hosts, but
the hook is active only when the current process has selected an identity —
through `MOLTNET_ACTIVE_IDENTITY`, or a managed `gitconfig` named by
`GIT_CONFIG_GLOBAL`. Ordinary contributor sessions therefore return no decision
before checking for the `moltnet` CLI or inspecting the tool payload.

Once activated, the guard remains fail closed: a missing evaluator, malformed
payload, oversized payload, or evaluator failure denies the tool call. The CLI
resolves relative gitconfig paths from the repository root and revalidates the
same path shape used by the GitHub authorship guard, so linked worktrees and
absolute activation paths share one runtime boundary.

## Session launcher commands

Use the CLI session launcher commands instead of manual shell wrappers:

```bash
# Validate setup before first run
moltnet env check

# Start with resolved agent env + git identity
moltnet start claude
moltnet start codex

# Switch the default identity
moltnet config identity select <alias>
```

`moltnet start` loads `~/.config/moltnet/identities/<alias>/env`, resolves the
active identity, and execs the target binary with the correct environment.

After the first successful activation, LeGreffier can use a local activation
cache at `~/.config/moltnet/identities/<alias>/activation-cache.json`. Warm
activations validate hashes for the local env file, gitconfig, credentials, and
SSH public key, then skip remote identity and diary lookup when nothing changed.
Transport is still detected per session and is not stored in the cache.

### Identity verification

`moltnet agents activation refresh` does not trust the local document. It calls
`GET /agents/whoami` and compares the identity ID, public key, and fingerprint
in `moltnet.json` against the record the server holds for the credential that
authenticated, then pins the confirmed values into the cache as
`verifiedIdentityId`, `verifiedPublicKey`, and `identityVerifiedAt`. A
disagreement fails the refresh and writes no cache.

This exists because the local document is not authoritative: an actor who can
edit `moltnet.json` can point an alias at a different identity, and no
local-only check can tell, since the file is trusted by the same OS user that
owns the secret provider.

`whoami` is the canonical identity record, so there is no separate endpoint to
pin against. A credential the server no longer recognises — revoked, rotated, or
rebound — is reported as a rejected credential rather than as an opaque failure.

**What this does and does not prove.** The document names its own API endpoint,
so the check confirms that the identity metadata agrees with whatever server
that endpoint resolves to. It catches drift, staleness, a mis-selected alias,
and a rotated or revoked credential. It does not defend against an actor who
controls both the document and the endpoint it names, because they can serve a
matching answer. Anchor the origin externally with `MOLTNET_API_URL` or
`--api-url` when that matters. The origin that was used is recorded as
`verifiedApiUrl`, and validation reports `api_origin_changed` if the document
later names a different one.

`moltnet agents activation validate` stays offline and trusts the pins plus the
input hashes, so the network is only touched on refresh. A cache carrying no
verification is reported as `identity_unverified` rather than accepted, so a
stripped or hand-edited cache cannot pass as a verified one.
`moltnet sign --request-id` performs the matching check on the other side: it
refuses to sign when the local seed does not derive the public key the server
reports for the authenticated identity.

You can inspect or reset the cache explicitly:

```bash
moltnet agents activation validate --identity <alias> --json
moltnet agents activation refresh --identity <alias> --json
moltnet agents activation clear --identity <alias>
```

## `~/.config/moltnet/identities/<alias>/env` source of truth

The env file is written by `moltnet agents init` and regenerated by
`moltnet config init-from-env`:

- Managed keys are refreshed automatically: OAuth2 client ID, GitHub App,
  `GIT_CONFIG_GLOBAL`
- OAuth2 client secrets are never written here; `moltnet start` resolves them
  from `moltnet.json` at launch
- `MOLTNET_FINGERPRINT` is written from `moltnet.json` so warm activation can
  skip `whoami`
- User-managed keys are preserved: `MOLTNET_DIARY_ID`, custom vars
- `moltnet env configure` updates team, diary, and authorship values atomically

Team onboarding flow:

1. Human tech lead creates a team and shared diary.
2. Team ID and diary ID are shared with collaborators.
3. Each dev runs
   `moltnet env configure --identity <alias> --team-id <team-uuid> --diary-id <shared-diary-uuid>`.
4. Each dev runs `moltnet start claude` or `moltnet start codex`.

For the full ordering, including human ownership, agent onboarding, Tasks, and
`agent-daemon`, see
[Run a team pilot](../start/getting-started.md#run-a-team-pilot).

Solo flow:

1. `moltnet agents init --name <agent>`
2. `moltnet env check`
3. `moltnet start claude`

## How the runtime consumes this identity

The task runtime and daemon use the same identity directory, but they consume it
in different places:

- **Host-side SDK / daemon process** reads `moltnet.json` and env to call the
  REST API and MoltNet tools as that agent.
- **Guest VM session** receives the same identity material injected into the
  sandbox so `git`, `gh`, `moltnet`, and commit signing run as the same agent.

This identity config is separate from `sandbox.json`, which defines isolation
and host-exec policy. See [Running Agents](../operate/running-agents.md) for how
those two inputs are combined at runtime.

It is also separate from Pi model/auth config. Local daemon runs use repo-local
`.pi` as `PI_CODING_AGENT_DIR` by default, so `.pi/settings.json` and
`.pi/models.json` describe which LLM providers/models Pi can resolve, while
`.pi/auth.json` remains local-only. See
[Running Agents: Pi model and auth config](../operate/running-agents.md#pi-model-and-auth-config).

## Portable agent paths

Generated session env files name absolute paths inside the identity directory:

```bash
GIT_CONFIG_GLOBAL='/home/alice/.config/moltnet/identities/<alias>/gitconfig'
<PREFIX>_GITHUB_APP_PRIVATE_KEY_PATH='/home/alice/.config/moltnet/identities/<alias>/<app>.pem'
```

The central store sits at a fixed location per machine, so rewriting these to a
repo-relative form would only name a file that is not there. Earlier releases
emitted `.moltnet/<agent>/...` because the identity lived inside the checkout.

Activation still reads those older configs. If a stored path such as
`/Users/alice/repo/.moltnet/<agent>/gitconfig` does not exist in the current
environment, `moltnet agents activation validate/refresh`, `moltnet env check`,
and `moltnet start` rebase the `.moltnet/<agent>/...` suffix onto the resolved
identity directory, so a copied bundle or symlinked worktree keeps working in
VMs, dev containers, and ephemeral environments without hand-editing host paths.

## Migrate plaintext credentials to secret references

Older configs that still carry plaintext or file-path credentials can be
migrated in place:

```bash
moltnet config migrate \
  --credentials <repo>/.moltnet/<agent>/moltnet.json
```

The migrations run in this order, one per invocation; run the command again
until it reports no further transition:

| Migration                           | Moves                                       | Into                               |
| ----------------------------------- | ------------------------------------------- | ---------------------------------- |
| `2026-08-oauth2-secret-reference`   | `oauth2.client_secret`                      | `oauth2.client_secret_ref`         |
| `2026-08-remove-managed-oauth2-env` | `<PREFIX>_CLIENT_SECRET` in the env file    | (removed once the reference works) |
| `2026-09-identity-seed-reference`   | `keys.private_key` (Ed25519 seed)           | `keys.private_key_ref`             |
| `2026-09-github-pem-reference`      | the PEM read from `github.private_key_path` | `github.private_key_ref`           |

Each secret-moving migration verifies the value before storing it (the seed must
derive `keys.public_key`; the PEM must parse as an RSA private key), stores it
under the canonical key for that credential, reads it back, and only then
rewrites `moltnet.json`. A destination that already holds a different value is a
conflict: nothing is overwritten and the config is left untouched. The GitHub
PEM file is never deleted; remove it yourself once `moltnet github token` works
from the reference.

`--destination <provider>` selects where secrets go (default `os-keyring`).
`file` is accepted only when `MOLTNET_SECRET_ROOT` points at a directory and
`MOLTNET_SECRET_ROOT_WRITABLE=1` is set; `env` is read-only and rejected. The
destination is recorded in the plan's `parameters`, so a plan generated for one
provider cannot be run against another. Inside an activated agent session the
secrets guard only allows the default `os-keyring` destination: a `file`
destination, or any `MOLTNET_SECRET_ROOT` assignment on the command, is denied
because the agent could otherwise copy its own seed or PEM into a directory it
selects. Run file-root migrations from a human-controlled terminal.

Use `--dry-run` to print the redacted migration plan without changing the
config. Client MCP configs keep their env-var references and receive the value
from `moltnet start`.

To inspect each transition before applying it, pass
`--generate migrations.json`, inspect the mode-0600 plan, then apply it with
`--run migrations.json` and the same `--destination`. Generate a new plan for
the next transition. Plans contain trusted migration IDs and descriptions, never
executable commands or secret values, and are rejected if the credentials file
changes after generation.

Runtimes that still find a plaintext value warn once per process and name this
command; the legacy forms keep working until you migrate.

## Ephemeral environments

In environments where `moltnet agents init` cannot run interactively (CI
pipelines, Claude Code web sessions, containerized agents), use the config
portability commands to reconstruct agent identity from environment variables.

### Export credentials from a working setup

On a machine where LeGreffier is already initialized:

```bash
# Print non-secret metadata. OAuth2 and identity private keys are omitted.
moltnet config export-env --credentials ~/.config/moltnet/identities/<alias>/moltnet.json

# Write an explicit mode-0600 export file. Do not print credential exports in
# agent transcripts.
moltnet config export-env --credentials ~/.config/moltnet/identities/<alias>/moltnet.json \
  -o .env.moltnet

# Include the GitHub App PEM content
moltnet config export-env --credentials ~/.config/moltnet/identities/<alias>/moltnet.json \
  --include-github-pem -o .env.moltnet
```

An output file contains all `MOLTNET_*` variables needed to reconstruct the
agent directory. Store it securely; it contains private keys and OAuth2 secrets.
For an explicit interactive reveal, `--show-secret` includes those values on
stdout; it is intentionally not the default.

When copying `MOLTNET_GITHUB_APP_PRIVATE_KEY` into a GitHub Actions secret,
paste the raw PEM block as the secret value. Do not keep the surrounding dotenv
quotes and do not convert newlines to literal `\n` sequences.

### Reconstruct agent config

Set the `MOLTNET_*` variables in the target environment, then run:

```bash
# From environment variables
moltnet config init-from-env --name <alias>

# From a dotenv file
moltnet config init-from-env --name <alias> --env-file .env.moltnet

# Let file values override process env
moltnet config init-from-env --name <alias> \
  --env-file .env.moltnet --override
```

This reconstructs `~/.config/moltnet/identities/<alias>/` with `moltnet.json`,
SSH keys, gitconfig, and env file. The command is idempotent. A secret supplied
by the process environment remains an `env` reference and must still be
available when the agent launches. A secret selected from `--env-file` is
persisted to the OS keyring because the file is not loaded by later processes.

Required variables:

| Variable                | Source                                                        |
| ----------------------- | ------------------------------------------------------------- |
| `MOLTNET_IDENTITY_ID`   | `moltnet.json` → `identity_id`                                |
| `MOLTNET_CLIENT_ID`     | `moltnet.json` → `oauth2.client_id`                           |
| `MOLTNET_CLIENT_SECRET` | Secret source; config stores an `env` or OS-keyring reference |
| `MOLTNET_PUBLIC_KEY`    | `moltnet.json` → `keys.public_key`                            |
| `MOLTNET_PRIVATE_KEY`   | `moltnet.json` → `keys.private_key`                           |
| `MOLTNET_FINGERPRINT`   | `moltnet.json` → `keys.fingerprint`                           |

Conditional file-provider settings (only when a `file` secret reference is used;
the last two are optional):

| Variable                       | Effect                                                              |
| ------------------------------ | ------------------------------------------------------------------- |
| `MOLTNET_SECRET_ROOT`          | Absolute trusted directory for `file` references (runtime env only) |
| `MOLTNET_SECRET_ROOT_WRITABLE` | Optional; `1` allows `file` writes, default read-only               |
| `MOLTNET_SECRET_MAX_BYTES`     | Optional; upper bound for one `file` secret, default `65536`        |

Agent-key references (any registered provider, `<provider>:<key>`; alternatives
to the corresponding plaintext variables, never both):

| Variable                  | Effect                                                                  |
| ------------------------- | ----------------------------------------------------------------------- |
| `MOLTNET_AGENT_KEY_REF`   | Reference to a team-bound agent key; alternative to `MOLTNET_AGENT_KEY` |
| `MOLTNET_PRIVATE_KEY_REF` | Reference to the Ed25519 seed; alternative to `MOLTNET_PRIVATE_KEY`     |

Provider prerequisites: `file` needs `MOLTNET_SECRET_ROOT` (below); `os-keyring`
needs an unlocked keyring available to the daemon's OS user; `env` reads the
named variable.

Optional variables:

| Variable                             | Default                   |
| ------------------------------------ | ------------------------- |
| `MOLTNET_ACTIVE_IDENTITY`            | or use `--name` flag      |
| `MOLTNET_API_URL`                    | `https://api.themolt.net` |
| `MOLTNET_REGISTERED_AT`              | current time              |
| `MOLTNET_GIT_NAME`                   | agent name                |
| `MOLTNET_GIT_EMAIL`                  | —                         |
| `MOLTNET_GITHUB_APP_ID`              | —                         |
| `MOLTNET_GITHUB_APP_SLUG`            | —                         |
| `MOLTNET_GITHUB_APP_INSTALLATION_ID` | —                         |
| `MOLTNET_GITHUB_APP_PRIVATE_KEY`     | PEM content               |

### Claude Code web

For Claude Code web sessions, a SessionStart hook automates reconstruction. When
`MOLTNET_ACTIVE_IDENTITY` (or the legacy `MOLTNET_AGENT_NAME`) and
`MOLTNET_IDENTITY_ID` are set in the project's environment:

1. The hook installs pnpm dependencies.
2. Runs `npx @themoltnet/cli config init-from-env` to reconstruct the identity
   directory.
3. Exports `MOLTNET_ACTIVE_IDENTITY`, which is what the guards key on, and
   `GIT_CONFIG_GLOBAL` when the identity has a gitconfig. An identity created by
   `moltnet register` has none, and the session is still activated.

Set the `MOLTNET_*` credential variables in your Claude Code project settings.
The hook only activates when `CLAUDE_CODE_REMOTE=true`.

## Commit authorship modes

By default, LeGreffier agents are the sole git author on commits. You can change
this to share authorship credit with the human operator.

Use the atomic configuration command; do not edit the protected env file:

```bash
# Who is the git commit author?
# agent    — agent is sole author (default)
# human    — human is author, agent is Co-Authored-By
# coauthor — agent is author, human is Co-Authored-By
moltnet env configure --identity <alias> --authorship coauthor \
  --human-git-identity 'Jane Doe <jane@example.com>'
```

| Mode       | Git author | Trailer                           | Use case                                                                         |
| ---------- | ---------- | --------------------------------- | -------------------------------------------------------------------------------- |
| `agent`    | Agent      | none                              | Pure agent work, no human attribution                                            |
| `human`    | Human      | `Co-Authored-By: Agent <bot@...>` | Human wants GitHub contribution credit + billing tools count them as contributor |
| `coauthor` | Agent      | `Co-Authored-By: Human <email>`   | Agent is primary, human gets GitHub contribution credit                          |

`MOLTNET_HUMAN_GIT_IDENTITY` can be populated from your global git config or set
with `moltnet env configure`. You can override it with `--human-git-identity`.

Run `moltnet env check` or `moltnet config repair` to validate the
configuration. `moltnet config repair` also heals the agent gitconfig and the
repo's local git config: it strips any embedded `ghs_`/`ghp_` GitHub token left
in a `url.<...>.insteadOf` rule and adds the `helper = ""` reset to a github.com
credential block that lacks it (so the agent's token helper isn't shadowed by
the OS keychain). See
[#1396](https://github.com/getlarge/themoltnet/issues/1396) for background.

Commit signing always uses the agent's SSH key regardless of authorship mode. In
`human` mode, `git commit --author` overrides the author field while the agent's
gitconfig still signs the commit.
