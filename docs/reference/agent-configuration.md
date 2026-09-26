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

## Store selection and keyring namespaces

The CLI, SDK, Agent Server, and Desktop select an explicit store option first,
then `MOLTNET_HOME` or its full-store alias `MOLTNET_AGENT_SERVER_ROOT`, then
`~/.config/moltnet`. Each variable names the store itself; no extra
`.config/moltnet` suffix is appended. An explicitly empty, blank,
NUL-containing, inaccessible, or non-directory path is an error, including an
empty environment variable. Unset the variable to select the default.

The default config/display path retains its established lexical spelling without
filesystem access. Explicit and environment roots return absolute canonical
paths; relative paths start at the caller's working directory. Use absolute
paths in Desktop: it rejects relative store and installation environment paths
because graphical launchers do not provide a predictable working directory.
Existing symlinks and filesystem case aliases are resolved before parent (`..`)
segments; missing directories are not created. Secret namespaces use canonical
paths. File locks use the lock file's filesystem identity, so aliases to the
same file share a lock. An unavailable default directory does not prevent access
to an isolated store.

The Node SDK exports `resolveStoreRoot`, `canonicalStoreRoot`, `isDefaultStore`,
`defaultStoreRoot`, and `storeSecretService` from `@themoltnet/sdk/node`. Their
namespace format is a persisted compatibility contract: the canonical default
store uses `themolt.net`; other stores use `themolt.net/store/<digest>`, with
the lowercase SHA-256 hex digest of the canonical absolute path's UTF-8 bytes.
Account keys starting with `store/` are reserved so Windows service/account
targets cannot overlap. Moving a store changes its namespace; copying its files
does not copy keyring secrets. Re-enroll credentials in the destination store.
Symlinks to the same existing directory retain its namespace.

Keyring providers resolve their namespace on first keyring access and retain it
for their lifetime. Environment and file providers do not require a valid
keyring store. Create a new registry when switching stores.

`--credentials`, `MOLTNET_CREDENTIALS_PATH`, and an SDK `configDir` select a
credentials document, not a keyring namespace. Set `MOLTNET_HOME` (or the Node
registry's explicit store option) to read that document's isolated secrets.
Explicit document paths do not seed the selected store's identity selector.

`MOLTNET_AGENT_SERVER_ROOT` selects the entire store, including identities,
keyring namespaces, bindings, providers, presets, and run state. If both
environment variables are set, their canonical roots must agree. An explicit
store option takes precedence over both variables. The default does not consult
`XDG_CONFIG_HOME`.

```bash
export MOLTNET_HOME="$HOME/.local/share/moltnet/development/personal"
moltnet agents list
```

Each store has one Agent Server singleton. Standalone servers use loopback HTTP:
the default store uses port 17374, while isolated stores receive an available
port unless `--port` or `MOLTNET_AGENT_SERVER_PORT` is supplied. `--port 0`
explicitly requests an available port. `agent-server-endpoint.json` contains
public connection metadata, with an `http:`-only loopback origin and UUID
instance ID. Standalone clients reject HTTPS discovery records.

Desktop starts its managed child on a private Unix socket on macOS and Linux.
The native client verifies the peer UID and child PID before sending its
process-scoped grant. It does not use TCP discovery, CA certificates, or OS
trust installation. Every store requires the socket-capable Agent CLI version
pinned by Desktop's build; there is no fallback to an older TCP transport.

Desktop connection environments remain separate beneath the selected store.
Presets use the effective environment's storage scope. `moltnet start` and
managed workers pass an absolute `MOLTNET_HOME` to children so changing their
working directory or `HOME` does not change their store. Managed workers also
inherit `MOLTNET_DEFAULT_STORE_ROOT`, an internal absolute comparison hint that
preserves the original default keyring namespace across `HOME` changes. It does
not select a store and should not be set in launch profiles. It is not a
security control: same-user processes can change their store environment.
Desktop runs under the actual user HOME and its Rust default-store comparison
does not consume this worker-only hint. Desktop's `MOLTNET_AGENT_HOME` selects
its installation directory independently.

For the default store, Go CLI caches still follow the process's operating-system
cache directory. A managed worker with an isolated `HOME` therefore keeps its
resource locks and recovery files in that worker's cache;
`MOLTNET_DEFAULT_STORE_ROOT` preserves store/keyring identity, not the
supervisor's cache location. An isolated store selected with `MOLTNET_HOME`
instead keeps its cache under `<store>/cache`.

## Upgrading from MOLTNET_AGENT_SERVER_ROOT

The old variable name is deprecated. Replace it with `MOLTNET_HOME` and unset
the old name. Both now select the **entire store**, including CLI/SDK
identities, keyring namespaces, project bindings, providers, Desktop presets and
run state. The old daemon-only behavior is not retained, and no files or keyring
entries are migrated automatically.

- If you want the established default identities and keyring entries, unset both
  variables. Merely renaming a non-default legacy root does not restore them.
- If you want isolation, select that root consistently in CLI, SDK and Desktop,
  then enroll credentials there. Non-default roots use their own keyring
  service; references created under the old shared `themolt.net` service need
  new credentials in the selected store.
- Empty values now fail. Two set aliases must resolve to the same directory;
  conflicting roots fail. An explicit store option overrides both.
- Custom stores use an available daemon port by default. Standalone clients must
  use discovery or an explicit URL rather than assume port 17374.
- Desktop presets are now scoped by store and effective API/issuer. Existing
  presets for a default store with customized connection settings remain in the
  old browser storage key but do not appear in the new scope. Recreate the
  presets for that connection; there is no automatic copy.
- Custom installation roots use their own `bin` directory unless
  `MOLTNET_AGENT_BIN_DIR` is explicit. Update PATH accordingly. Install/upgrade
  removes a login service only when it points into that installation; the daemon
  no longer starts automatically at login through that old service.

The default store path, its `themolt.net` keyring namespace, and port 17374
remain unchanged. Moving an isolated store changes its keyring namespace; using
a symlink to the same canonical directory does not.

## Which credentials file a command uses

The paths below use the default store; substitute `MOLTNET_HOME` when selected.

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

Once a file is selected it is used as-is. A selected file that is unreadable or
malformed is an error when authentication depends on that file, never a reason
to fall back to another identity. `endpoints.api` comes from that same file, so
an agent registered against a non-default API does not need `--api-url` on every
invocation. `MOLTNET_AGENT_KEY` or `MOLTNET_AGENT_KEY_REF` explicitly selects
key authentication for the process; API-only commands can use that path without
a credentials document. See
[Agent keys](../operate/agent-keys.md#use-an-agent-key-with-the-cli).

Rungs 3 and 4 name an identity rather than a path, so one variable selects the
whole identity and a session cannot authenticate as one agent while signing as
another (issue #2129).

## Team credential storage contract

An identity can retain a compatibility fallback and references for individual
teams. References contain provider identifiers, never secret values:

```json
{
  "agent_key_ref": {
    "key": "agent-key/<subjectId>",
    "provider": "os-keyring"
  },
  "agent_key_refs": {
    "<teamId>": {
      "key": "agent-key/<subjectId>/<teamId>",
      "provider": "os-keyring"
    }
  }
}
```

The shared Go and Node selection primitives choose the selected team's entry
first. Only an absent entry permits the fallback. A configured entry with an
invalid binding or a failed provider lookup is terminal. With no selected team,
the fallback wins; a single map entry can be selected automatically, while
multiple map entries require an explicit team. A map-only document is valid.
Explicit credential overrides and interactive OAuth precedence are unchanged.

Writers reload the document under an exclusive directory lock at
`<canonical-parent>/moltnet.json.writer-lock`, then replace it atomically. Go
also retains its existing OS file lock for compatibility with older CLI writers.
Section updates preserve unrelated JSON fields and other team entries. Readers
need no lock. A writer waits up to five seconds for the shared directory lock;
it never steals an old lock because its owner might only be paused. After a
crashed writer, confirm that no writer is running before removing the lock
directory named in the error. The last committed config remains readable.

Release both Go and Node readers before enabling enrollment, migration, or
lifecycle writers that create team-map entries. The minimum release versions
must be recorded when those reader releases are published; this unreleased
contract does not establish a supported version floor. Keep the original
fallback during migration rollout. Older credentials do not acquire new scopes
automatically: refresh OAuth authorization or reissue a key with `team:join`
before enrolling another team.

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

The identity does not need an existing OAuth2 client. An agent that holds an
agent key only, such as a managed agent created from the Console, receives a
newly minted client on its first recovery; later recoveries rotate that client.
This is how a daemon-only identity gains CLI access.

```bash
# Required only when oauth2.client_secret is still plaintext.
moltnet agents credentials recover --yes --destination os-keyring

# An existing writable client_secret_ref is reused when --destination is
# omitted. An identity with no OAuth2 client yet uses the provider of its
# agent_key_ref, or the OS keyring.
moltnet agents credentials recover --yes
```

`--destination` must name a registered writable provider. `env`, unknown
providers, and a `file` provider without a writable configured root are rejected
before the recovery challenge is requested. The replacement is stored under
`oauth2/<subject_id>/<resolved_client_id>`, read back while the provider lock is
held, and `moltnet.json` is then atomically rewritten with both the
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

The CLI resolves the installation for the target repository through GitHub, then
mints a token restricted to that repository. The token inherits the
installation's permissions rather than being narrowed to the classified write:
`gh` writes such as `pr create` read the default branch and the head ref first,
and a single-permission token fails those reads. Tokens and permission evidence
are written atomically under
`~/.config/moltnet/identities/<alias>/gh-token-cache/`, keyed by App and
repository; the repository's installation is resolved on a cache miss and cached
separately. A configured installation ID is only a compatibility hint for legacy
calls made outside a repository. Refresh failures are cached for 30 seconds to
avoid retry storms. Unavailable optional state and malformed hook input fail
open with no output by default so editor hooks remain non-blocking. Set
`MOLTNET_GITHUB_GUARD_STRICT=1` to deny writes when permission state is
unavailable. Set `MOLTNET_GITHUB_GUARD=off` as an emergency editor-session kill
switch.

For writes supported by the App, scope its token to the single command:

```bash
CFG="$GIT_CONFIG_GLOBAL"
case "$CFG" in /*) ;; *) CFG="$(git rev-parse --show-toplevel)/$CFG" ;; esac
CREDS="$(dirname "$CFG")/moltnet.json"
[ -f "$CREDS" ] || { echo "FATAL: moltnet.json not found at $CREDS" >&2; exit 1; }
GH_TOKEN=$(moltnet github token --credentials "$CREDS" -R owner/repo) gh <command>
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

Plain CLI help calls such as `moltnet register --help` and
`moltnet agents keys create --help` are allowed because they cannot execute the
credential operation. A help flag combined with other options is still
classified as the underlying operation. `moltnet help register` remains a
read-only way to inspect the command without invoking it.

## Identity files and network alias

`moltnet register` and `moltnet agents init` store the identity locally:

```
~/.config/moltnet/
├── identity-selector.json     # Persisted default alias
├── projects.json              # Machine-local project bindings
└── identities/<agent-name>/
│   ├── moltnet.json            # Identity, keys, OAuth2 keyring ref, endpoints
│   ├── gitconfig               # Git identity + SSH signing config
│   ├── env                     # Non-secret activation values
│   ├── activation-caches/      # Hash-bound activation status, one per location
│   └── ssh/
│       ├── id_ed25519          # SSH private key (mode 0600)
│       └── id_ed25519.pub      # SSH public key
```

`moltnet.json` holds opaque keyring references rather than secret values. The
directory name is a local identity alias. `register --name` and the first
successful `agents init --name` also attempt to publish that alias as the
agent's network alias after credentials are safely stored. A publication failure
does not discard or recreate the identity; the warning says whether retrying
makes sense. Re-running `agents init` on an initialized identity does not
publish again.

Publish the active local alias, or an explicit one, at any time:

```bash
moltnet config identity publish
moltnet config identity publish <alias>
```

Publishing sets a case-preserving network alias on the agent record. It does not
rename the local identity alias, change the canonical fingerprint or agent ID,
or affect authorization: team member lists still identify agents by fingerprint
and carry the alias as a separate field, and it is never unique. Only the
identity's primary credential can publish; agent keys are refused. JSON-only
registration and imported or migrated identities do not publish automatically.
If multiple machines publish for the same identity, the last explicit
publication wins, and the API records each change. To withdraw the alias, call
`DELETE /agents/whoami/alias` with the primary credential (the SDK exposes it as
`deleteWhoamiAlias`).

For a legacy repository bundle, import it explicitly with
`moltnet config migrate --credentials <path>`; the CLI derives the alias from a
legacy bundle path when possible. Run `moltnet config identity publish <alias>`
afterward if that local alias should also be visible on the network.

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

### Project activation

[Projects and Workspaces](../use/projects-and-workspaces.md) explains the model
and the personal, CI, and long-lived machine journeys. This section is the exact
command and file contract.

Projects are shared team resources. Team members can discover them; team
managers create, update, and archive them in Console or through the CLI and SDK.
A project's team never changes. Its optional default diary belongs to that team.
Archiving hides the project from new-work selection and leaves existing tasks
intact.

```bash
moltnet projects create --team-id <team-id> --name research --diary-id <diary-id>
moltnet projects list --team-id <team-id>
moltnet projects get <project-id> --team-id <team-id>
moltnet projects archive <project-id> --team-id <team-id>
```

Register each local folder separately in `~/.config/moltnet/projects.json`.
Choose whether work should use the source folder (`existing`) or prepare an
isolated workspace (`git-worktree` or `isolated-directory`). The choice is a
reusable default. `none` declares no workspace and has no source folder.

```bash
moltnet projects bindings set laptop \
  --api-url https://api.themolt.net \
  --team-id <team-id> --project-id <project-id> \
  --source ./research --strategy existing --default
moltnet projects bindings list
moltnet projects bindings resolve --binding laptop
moltnet start codex --binding laptop
```

Without `--binding`, native activation uses the most specific registered
ancestor of the caller's directory. Paths are canonicalized, including symlinks.
Equally specific bindings require an explicit choice. Git remotes do not
register other clones or worktrees. With no matching registration, the
identity's default team and diary still apply in noninteractive launches. In a
terminal, `moltnet start` prompts to register the folder: choose a team and
diary, select or create a shared project, name the local binding, and choose
**Work here** or **Prepare an isolated workspace**. The selection is saved for
subsequent launches. Cancellation stops launch. Run
`moltnet projects setup --identity <alias>` to open the same prompt explicitly.

`moltnet start` selects the identity, project environment, and source CWD, then
launches the native provider. It does not prepare isolated workspaces or run
setup hooks, even when those are saved in the binding. `--dry-run` prints the
selection without launching or writing.

Use `--config-file <path>` on `projects bindings` or `start` for an explicit
alternative, including CI. Only use configuration files you trust: their
bindings select the source folder. No configuration is discovered from
repository files. Native selection filters bindings by the identity's resolved
API endpoint and rejects an explicit binding for a different endpoint. `start`
exports `MOLTNET_PROJECT_CONFIG` and `MOLTNET_PROJECT_BINDING` so activation
uses the same selection for that identity. `agents activation validate`,
`agents activation refresh`, and `env check` accept `--config-file` and
`--binding` to override the launched session. `agents activation clear` clears
all location caches for the selected identity without reading project
registrations. Treat `MOLTNET_CONTEXT_KEY` as an opaque cache identity; do not
parse its components. `projects bindings resolve` uses native ancestor lookup by
default; pass `--native=false` for project/default selection without a CWD
match. Relative paths written by the CLI resolve from the caller's CWD; relative
paths inside JSON resolve from the configuration file's directory.

A minimal configuration is:

```json
{
  "bindings": [
    {
      "apiUrl": "https://api.themolt.net",
      "default": true,
      "name": "laptop",
      "projectId": "<project-id>",
      "source": "./research",
      "strategy": "existing",
      "teamId": "<team-id>"
    }
  ],
  "version": 1
}
```

Multiple bindings may serve a project. Outside native ancestor selection, a
default can select among that project's bindings; it never silently chooses
between different projects. The file holds no credentials. Credential lookup and
remote validation happen separately.

After the first successful activation, LeGreffier keeps one cache per location
under `~/.config/moltnet/identities/<alias>/activation-caches/`. Warm activation
validates local inputs offline. Refresh verifies the selected identity and, when
a team and diary are set, confirms online that the diary belongs to that team.
Binding one location does not invalidate another location's cache. A cache
copied from another location is rejected as `repo_mismatch`. Transport remains
session-local and is not stored in the cache.

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
- User-managed keys are preserved: `MOLTNET_TEAM_ID` and `MOLTNET_DIARY_ID` (the
  identity default used wherever no location is bound), custom vars
- `moltnet env configure` updates the identity default team/diary and authorship
  values atomically; project folders are managed with
  `moltnet projects bindings`

Team onboarding flow:

1. Human tech lead creates a team and shared diary.
2. Team ID and diary ID are shared with collaborators.
3. A manager creates the shared project. Each developer registers a local folder
   with `moltnet projects bindings set`, choosing its workspace strategy
   explicitly.
4. Each dev runs `moltnet start claude` or `moltnet start codex`.

For the full ordering, including human ownership, agent onboarding, Tasks, and
`agent-daemon`, see [Get started](../start/getting-started.md).

Solo flow:

1. `moltnet agents init --name <agent>`
2. `moltnet env check`
3. `moltnet start claude` — the first run in each location asks which team and
   diary to use

To use one team and diary everywhere, set them once as the identity default with
`moltnet env configure --team-id <id> --diary-id <id>`; each new location then
pre-selects them.

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

It is also separate from Pi model/auth config, which comes from the
`moltnet-agent providers` store and repo-local `.pi`. See
[Running Agents: Repository Pi config](../operate/running-agents.md#repository-pi-config).

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

## Move credentials between secret providers

A credential that already resolves through a reference can switch providers
without editing `moltnet.json` by hand:

```bash
# Resolve the identity seed from a local file root instead of the OS keyring
MOLTNET_SECRET_ROOT=$HOME/.moltnet-secrets MOLTNET_SECRET_ROOT_WRITABLE=1 \
  moltnet config credentials copy --kind identity-seed --to file

# Switch back
MOLTNET_SECRET_ROOT=$HOME/.moltnet-secrets \
  moltnet config credentials copy --kind identity-seed --to os-keyring
```

`--kind` is one of `oauth2-client-secret`, `identity-seed`,
`github-app-private-key`, or `agent-key`. For an agent key, `--team <id>` picks
the team key when more than one is configured. `--to` accepts only a writable
provider (`os-keyring`, or `file` with `MOLTNET_SECRET_ROOT_WRITABLE=1`). A
read-only destination fails with `destination_read_only` before anything is
read.

The command resolves the source through the normal resolver, so the reference
must be bound to this identity and the value must have the right shape. It then
stores the value under the credential's canonical key in the destination, reads
it back, and rewrites the reference in `moltnet.json`. The key never changes;
only the provider does. A destination that already holds a different value is a
conflict and nothing is changed. A destination that already holds the same value
is reused, so running the command again after an interruption is safe. If the
config rewrite fails, the destination copy is removed again.

`copy` is enough to switch providers: after it, readers use the destination and
the source entry is simply unused. `move` also deletes the source once the
config points at the destination. If that deletion fails, the config already
points at the destination and the command reports `manualRecoveryRequired`. A
value-free recovery artifact records both references. `move` needs a source it
can delete: an `env` source or a read-only file root is rejected before anything
changes; copy it instead.

The secret is never printed. Output is a JSON document with the source and
destination references and what was written, updated, or deleted. The rewrite
changes `moltnet.json`, which invalidates the activation cache; run
`moltnet agents activation refresh` and restart running agent processes.

A common use is a development machine where Node processes reading the OS
keyring trigger an access prompt on every read. Copy the credentials into a file
root, then start the Node processes with `MOLTNET_SECRET_ROOT` set. Reading does
not need `MOLTNET_SECRET_ROOT_WRITABLE`. File-root secrets are stored
unencrypted and are protected only by the directory's permissions (files are
written with mode `0600`), so keep the root private to your user.

Inside an activated agent session the secrets guard allows only
`--to os-keyring`. A `file` destination, a non-static `--to` value, or any
`MOLTNET_SECRET_ROOT` mention on the command is denied, for the same reason as
`config migrate`. Run file-root copies from a human-controlled terminal.

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

Upgrade the CLI, daemon, and daemon action together. Run
`moltnet config migrate` before exporting or reconstructing configuration with
the new subject-based variables.

Required variables:

| Variable                | Source                                                        |
| ----------------------- | ------------------------------------------------------------- |
| `MOLTNET_SUBJECT_ID`    | `moltnet.json` → `subject_id`                                 |
| `MOLTNET_SUBJECT_TYPE`  | Must be `agent`                                               |
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
`MOLTNET_SUBJECT_ID` and `MOLTNET_SUBJECT_TYPE=agent` are set in the project's
environment:

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
in a `url.<...>.insteadOf` rule, adds the `helper = ""` reset to a github.com
credential block that lacks it (so the agent's token helper isn't shadowed by
the OS keychain), and enables `credential.https://github.com.useHttpPath` where
the MoltNet helper is configured, so Git passes the repository path and each
token is scoped to the repository being pushed. It inspects both the gitconfig
named in `moltnet.json` and the gitconfig beside it, which covers identities
whose `moltnet.json` still names a location from before the central identity
store. When the identity's `env` points `GIT_CONFIG_GLOBAL` at that sibling
gitconfig, repair also rewrites `git.config_path` to match it. Without
`--credentials`, repair acts on the selected identity. When the current
repository's own config binds the MoltNet helper to another copy of the same
identity (the same public key), such as a bundle the checkout used before the
central identity store, repair rebinds it to the identity; a helper bound to
another agent is reported and left unchanged. See
[#1396](https://github.com/getlarge/themoltnet/issues/1396) for background.

Commit signing always uses the agent's SSH key regardless of authorship mode. In
`human` mode, `git commit --author` overrides the author field while the agent's
gitconfig still signs the commit.

The file provider keeps logical team references as
`agent-key/<subjectId>/<teamId>`, but stores their values at
`<secret-root>/agent-key-teams/<subjectId>/<teamId>`. The sibling directory lets
team slots coexist with an existing fallback file at
`<secret-root>/agent-key/<subjectId>`. Go and Node use this same layout;
projected team credentials must follow it. Existing fallback paths stay valid.

### Selecting and migrating team credentials

CLI commands with a team argument use that team's map entry. Commands without
one use `MOLTNET_TEAM_ID`, then the selected project binding or identity
default. A single map entry can be selected automatically; multiple entries
without a fallback require an explicit team or project binding. A selected entry
that cannot be resolved fails immediately. Explicit agent-key environment
overrides and interactive OAuth2 precedence remain unchanged.

`moltnet config migrate --destination <provider>` authenticates the exact legacy
`agent_key_ref` to discover its subject and binding. It copies and reads back a
team-bound credential before updating `agent_key_refs`, retaining the original
fallback during rollout. Existing destination values must match; conflicts stop
the migration. Identity-scoped credentials stay fallbacks and require enrollment
to obtain a narrower team grant.

The non-secret `agent_key_ref_verified` migration checkpoint records the source
reference, subject, key ID, and binding. It makes repeated migration a no-op,
including for identity-scoped fallbacks. Changing the source reference or
removing the indexed slot causes migration to verify it again. Plans are bound
to the original document; regenerate a plan after another writer changes it.
Activation refresh verifies the selected key's subject and team binding, and
older activation caches require refresh after upgrading these readers.

## Project binding format compatibility

`~/.config/moltnet/projects.json` contains machine-local project registrations.
An explicit alternative file supports CI and cloud workers. The format uses
`version: 1` and a `bindings` array; it contains no credentials. Readers reject
unknown or mis-cased fields at every level. A format change, including adding an
optional field, requires a new version. Writers must not upgrade an existing
file automatically. Upgrade the CLI and daemon/SDK together before an explicit
format migration, or use separate configuration files during a transition. Older
readers report a newer-version error with upgrade guidance and leave the file
untouched. Invalid versions and malformed configuration are separate errors.

API endpoints use an explicit portable syntax: lowercase HTTP(S) scheme and
host, canonical IP addresses, no credentials/query/fragment, no dot path
segments, and no default or zero-padded ports. Omit `:443` for HTTPS and `:80`
for HTTP. Path segments use ASCII letters, digits, `.`, `_`, `~`, and `-`; a
single trailing slash is ignored for selection. HTTP is restricted to
`localhost`, IPv4 loopback addresses, and `[::1]`. Use HTTPS for remote hosts.

The same endpoint syntax applies to selection options, including CLI
`--api-url`; use `https://api.themolt.net`, not `https://API.themolt.net:443`.

On POSIX systems the file must belong to root or the current user and must not
be writable by group or others. Both readers reject symbolic links, non-regular
files, and files larger than 1 MiB. Windows uses filesystem ACLs rather than
POSIX ownership/mode checks; readers do not inspect Windows ACLs. Store the file
in an operator-controlled directory (parent-directory ownership is not checked).
Read-only root-owned configuration supports non-root container workers. Both
writers refuse updates to a file owned by another user, including root; change
admin-provisioned configuration as its owner. Both writers sync the file before
replacement. The TypeScript writer also syncs the parent directory afterward on
POSIX; the Go writer does not currently guarantee that directory sync. The
Go/TypeScript writer-lock test needs Node.js and installed `tsx`.

The reserved hook phases are `afterCreate` and `beforeRun`. Each command uses an
absolute executable path or a bare PATH name, an explicit string `args` array,
and an integer `timeoutMs` from 1 through 600000. Relative executable paths such
as `./setup` are rejected. Supporting the format does not imply a runtime can
execute hooks: a runtime must reject unsupported preparation before claiming
work. Hook execution is provided by the workspace lifecycle layer.

Resolution errors identify ambiguous candidates. Validation errors identify the
binding index and name where available; file reads include the configuration
path. Programmatic error categories are `version`, `validation`, `selection`,
and `io`. Selection returns a copy and accepts only `source`, `strategy`, and
`diaryId` overrides; an omitted or undefined override preserves the saved value.
Only own override properties apply; inherited properties are ignored. Malformed
Unicode strings are rejected by both readers. Missing source registrations fail
native selection even when other bindings exist; remove stale registrations or
select an available binding explicitly. Empty diary IDs are invalid. A `none`
override clears source and hooks.

Path canonicalization follows the local filesystem, including macOS case and
Unicode normalization aliases. Both runtimes test case aliases and traverse-only
ancestors; Go additionally tests normalization aliases. Resolvers validate each
public input even if it was previously read: callers can mutate configuration
objects between calls. Filesystem results are never cached across selections.

### Shared project catalogue

Projects have stable IDs. Names are trimmed and unique within a team ignoring
case, including archived projects: archiving preserves a project's name for
unambiguous historical references. Unarchive the same project or choose a new
name instead of reusing an archived name. `POST /projects` and
`PATCH /projects/:projectId` return 409 for a reserved name, including one
belonging to an archived project. Creator agent/human IDs are returned by the
API. Catalogue listing accepts `limit` (1–100, default 50) and `offset`, and
returns `nextOffset` until all pages have been read.

Task listing uses one project filter: omit `projectId` for all projects, pass a
project UUID for that project, or `projectId=none` for General tasks. Claims use
a UUID or JSON `null`; an omitted claim declaration means General. A mismatched
claim returns `409 PROJECT_MISMATCH` before any task state change. Polling
workers log that condition as a warning separately from ordinary claim races.
Claim permission is checked before task-state conflicts: callers without claim
permission receive 403 even for a terminal task; authorized callers receive 409
for the terminal-state conflict.

Project catalogue requests use `/projects` and `/projects/:projectId`. Select
the team with `x-moltnet-team-id`; an agent credential bound to one team may
omit the header and use its bound team. Unbound credentials must select a team.
The SDK accepts the same per-call team options as other resources:

```typescript
await agent.projects.create({ name: 'Research' }, { teamId });
await agent.projects.list({ limit: 50 }, { teamId });
await agent.projects.get(projectId, { teamId });
await agent.projects.update(projectId, { name: 'Renamed' }, { teamId });
await agent.projects.archive(projectId, { teamId });
```
