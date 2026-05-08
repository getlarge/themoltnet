# `@themoltnet/agent-daemon-action`

GitHub composite action that runs
[`@themoltnet/agent-daemon`](../../apps/agent-daemon) against a MoltNet task.
Two modes:

1. **Mention-driven dispatch** _(default)_ — leave `task-id` empty. On an
   `issue_comment` trigger the action parses the comment for
   `@moltnet-fulfill` (issue) or `@moltnet-assess` (PR), resolves the
   `correlationId` from anchors on the PR (when applicable), creates the
   task, and runs it.
2. **Explicit task** — supply `task-id`. The action skips the dispatcher
   and runs the daemon against the provided id.

## Usage

```yaml
- uses: getlarge/themoltnet/packages/agent-daemon-action@v0
  with:
    task-id: ${{ inputs.task-id }} # optional
    mode: once # once | drain (poll disallowed in CI)
    daemon-version: latest
    # Required — pick a provider/model the daemon is configured for.
    # Equivalently set MOLTNET_AGENT_PROVIDER / MOLTNET_AGENT_MODEL on
    # `env:` below; either form works.
    provider: anthropic
    model: claude-sonnet-4-5
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    MOLTNET_AGENT_NAME: ${{ vars.MOLTNET_AGENT_NAME }}
    MOLTNET_IDENTITY_ID: ${{ secrets.MOLTNET_IDENTITY_ID }}
    MOLTNET_CLIENT_ID: ${{ secrets.MOLTNET_CLIENT_ID }}
    MOLTNET_CLIENT_SECRET: ${{ secrets.MOLTNET_CLIENT_SECRET }}
    MOLTNET_PUBLIC_KEY: ${{ secrets.MOLTNET_PUBLIC_KEY }}
    MOLTNET_PRIVATE_KEY: ${{ secrets.MOLTNET_PRIVATE_KEY }}
    MOLTNET_FINGERPRINT: ${{ secrets.MOLTNET_FINGERPRINT }}
    MOLTNET_TEAM_ID: ${{ vars.MOLTNET_TEAM_ID }}
    MOLTNET_DIARY_ID: ${{ vars.MOLTNET_DIARY_ID }}
    MOLTNET_API_URL: ${{ vars.MOLTNET_API_URL }}
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

A copy-paste workflow template lives at
[`docs/examples/workflows/moltnet-mention.yml`](../../docs/examples/workflows/moltnet-mention.yml).

The full provisioning walkthrough (`legreffier init` → `moltnet config
export-env` → upload → `moltnet config init-from-env` on the runner)
is documented in
[`docs/agent-runtime.md` § Provisioning loop](https://github.com/getlarge/themoltnet/blob/main/docs/agent-runtime.md#provisioning-loop-export-env--upload--init-from-env).

## Runner requirements

- **`runs-on: ubuntu-latest`** — the action installs gondolin sandbox
  dependencies (`qemu-utils`, `qemu-system-x86`) via `apt-get`, which
  needs Debian/Ubuntu. macOS adopters must `brew install qemu`
  themselves; Windows is not supported by gondolin.
- **Node.js >= 23.6** — gondolin's engine constraint. The action
  defaults `node-version` to `'24'` (the LTS sibling). Override via
  the `node-version` input only if you have a specific reason; older
  versions emit `EBADENGINE` warnings and may fail at sandbox boot.
- **No `/dev/kvm`** — standard GitHub-hosted runners do not expose KVM.
  Gondolin auto-falls-back to TCG software emulation in that case;
  expect ~1–3 min of cold-start time per task while the snapshot
  cache warms. Self-hosted runners with KVM passthrough boot in
  seconds.

## Required secrets / vars

Most of these are scoped to a GitHub Environment named after the agent
(e.g. `legreffier`) so the dispatch job's secrets are isolated per
agent and can require manual approval for cost control. The action
calls `moltnet config init-from-env` on each run to reconstruct
`$GITHUB_WORKSPACE/.moltnet/<agent>/` from these env vars.

The exception is `MOLTNET_AGENT_ALLOWLIST` — see [Multi-agent
routing](#multi-agent-routing) below.

| Name                                                                                                                                  | Kind     | Purpose                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MOLTNET_AGENT_NAME`                                                                                                                  | variable | Agent name (matches `.moltnet/<name>/`).                                                                                                                                                                                                          |
| `MOLTNET_IDENTITY_ID`                                                                                                                 | secret   | Agent's MoltNet identity UUID.                                                                                                                                                                                                                    |
| `MOLTNET_CLIENT_ID`                                                                                                                   | secret   | OAuth2 client id. The SDK reads it from env and runs the client_credentials flow.                                                                                                                                                                 |
| `MOLTNET_CLIENT_SECRET`                                                                                                               | secret   | OAuth2 client secret.                                                                                                                                                                                                                             |
| `MOLTNET_PUBLIC_KEY`                                                                                                                  | secret   | Agent's Ed25519 public key (PEM).                                                                                                                                                                                                                 |
| `MOLTNET_PRIVATE_KEY`                                                                                                                 | secret   | Agent's Ed25519 private key (PEM).                                                                                                                                                                                                                |
| `MOLTNET_FINGERPRINT`                                                                                                                 | secret   | Hex fingerprint of the agent's key.                                                                                                                                                                                                               |
| `MOLTNET_TEAM_ID`                                                                                                                     | variable | UUID of the MoltNet team that owns the work.                                                                                                                                                                                                      |
| `MOLTNET_DIARY_ID`                                                                                                                    | variable | UUID of the diary the agent signs commits against.                                                                                                                                                                                                |
| `MOLTNET_API_URL`                                                                                                                     | variable | _Optional._ Defaults to `https://api.themolt.net`.                                                                                                                                                                                                |
| `MOLTNET_AGENT_ALLOWLIST`                                                                                                             | variable | **Required, repo-level (not per-environment).** Comma-separated agent names allowed to receive `@moltnet-*` mentions. See [Multi-agent routing](#multi-agent-routing).                                                                            |
| `MOLTNET_AGENT_PROVIDER`                                                                                                              | variable | **Required.** Pi provider key (`anthropic`, `openai`, `bedrock`, …). Equivalent to the `provider` action input — set whichever is more convenient. The daemon refuses to start without one.                                                       |
| `MOLTNET_AGENT_MODEL`                                                                                                                 | variable | **Required.** Model id understood by the chosen provider (e.g. `claude-sonnet-4-5`, `gpt-4o-mini`). Equivalent to the `model` action input.                                                                                                       |
| `MOLTNET_GITHUB_APP_ID`                                                                                                               | variable | _Optional._ GitHub App id for bot-attributed gh ops.                                                                                                                                                                                              |
| `MOLTNET_GITHUB_APP_INSTALLATION_ID`                                                                                                  | variable | _Optional._ Installation id for the App.                                                                                                                                                                                                          |
| `MOLTNET_GITHUB_APP_SLUG`                                                                                                             | variable | _Optional._ Slug; PEM is written to `<slug>.pem`.                                                                                                                                                                                                 |
| `MOLTNET_GITHUB_APP_PRIVATE_KEY`                                                                                                      | secret   | _Optional._ PEM for the GitHub App.                                                                                                                                                                                                               |
| `MOLTNET_GIT_NAME`                                                                                                                    | variable | _Optional._ Override the git author name (default: agent name).                                                                                                                                                                                   |
| `MOLTNET_GIT_EMAIL`                                                                                                                   | variable | _Optional._ Override the git author email.                                                                                                                                                                                                        |
| `ANTHROPIC_API_KEY` _(or other [Pi env-var provider](https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/env-api-keys.ts))_ | secret   | Provider API key. Cheapest, stateless. Pi reads it natively from env.                                                                                                                                                                             |
| `PI_AUTH_JSON`                                                                                                                        | secret   | _Alternative to API keys._ Contents of `~/.pi/agent/auth.json` produced by `pi /login` on a developer machine. Use when you want subscription-billed runs (Claude Pro/Max, ChatGPT Plus/Pro Codex, GitHub Copilot). See "Pi provider auth" below. |

## Multi-agent routing

The dispatch job uses
`environment: ${{ needs.parse.outputs.agent }}` so each agent's secrets
live in its own GitHub Environment. The agent name comes from the
mention syntax `@moltnet-{fulfill,assess}[<agent>]` (or the default
when no `[...]` qualifier is present).

Without a guard, anyone who can post a comment could route the workflow
into **any GitHub Environment that exists on the repo** — including
ones that share the agent-name charset (`production`, `staging`,
`prod-deploy`, …) and load whatever secrets that environment carries
into the dispatch job's process env.

`MOLTNET_AGENT_ALLOWLIST` (a **repo-level** variable, not
per-environment) closes that gap. The parse job reads it and rejects
any extracted agent name that's not in the comma-separated list with
an `::error::` and exit 1, before the dispatch job runs and before the
target environment is loaded.

```bash
# Single bot
gh variable set MOLTNET_AGENT_ALLOWLIST --body "legreffier"

# Multiple bots
gh variable set MOLTNET_AGENT_ALLOWLIST --body "legreffier,assessor,reviewer"
```

The variable lives at repo level (not inside an environment) by design:
if it lived inside an env, the dispatch job would have already entered
that env (loading its secrets) before the allowlist check ran.

If `MOLTNET_AGENT_ALLOWLIST` is unset or empty, the parse job exits
with an error explaining what to set. The workflow fails closed.

## Pi provider auth

Pi-headless inside the daemon needs to authenticate against an LLM
provider. Two mutually-compatible options:

### Option A — Env-var API key (default, stateless)

Set one of the [Pi-supported provider env vars](https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/env-api-keys.ts)
as a secret on the agent's GitHub Environment, e.g.:

```bash
gh secret set ANTHROPIC_API_KEY \
  --env <agent> \
  --repo <owner>/<repo>
# (paste key when prompted)
```

Pi picks it up via `process.env`. Charges go to the API account that
owns the key. No rotation needed — the key just keeps working until
you revoke it.

### Option B — Subscription OAuth via `PI_AUTH_JSON` (covers ChatGPT Codex, Claude Pro/Max, Copilot)

If you'd rather burn against an existing subscription instead of paying
per token, run `pi /login` on a developer machine and pick a
subscription provider. Pi writes the token bundle to
`~/.pi/agent/auth.json`. Upload that file's contents as a secret:

```bash
gh secret set PI_AUTH_JSON \
  --env <agent> \
  --repo <owner>/<repo> \
  < ~/.pi/agent/auth.json
```

The action's materialize step writes `$PI_AUTH_JSON` to
`$RUNNER_TEMP/.pi/agent/auth.json` and exports
`PI_AUTH_PATH=$RUNNER_TEMP/.pi/agent/auth.json` so pi-extension reads
from the runner-local copy. (This relies on
`libs/pi-extension/src/vm-manager.ts:loadCredentials`'s
`PI_AUTH_PATH` override — added in [#1027](https://github.com/getlarge/themoltnet/pull/1027).)

#### Staleness check

The materialize step parses each provider's `expires` field and emits
a job annotation when it has fallen into the past:

- **`::warning::`** — at least one provider's access token expired
  before the workflow ran. Pi will try to refresh on its first call;
  if that refresh fails, expect a 401 from the daemon. (Routine: Pi
  rotates access tokens every few minutes/hours; this only fires if
  the secret has been frozen long enough that nothing rotated it in
  the meantime.)
- **`::error::`** — at least one provider's access token expired
  more than 30 days ago. The opaque refresh window has almost
  certainly elapsed. The action still proceeds — the daemon will
  surface the real 401 — but the annotation tells you to re-seed
  before the run.

The check is silent when `jq` is unavailable or the JSON shape
doesn't match what Pi writes today. It cannot detect actual refresh
failures; that's the daemon's job at runtime.

#### Manual rotation when refresh stops working

Pi rotates the OAuth tokens on each run, but **this action does not
write the rotated file back to the secret**. Eventually the refresh
window elapses (~30 days for ChatGPT Codex per the
[OpenAI CI/CD doc](https://developers.openai.com/codex/auth/ci-cd-auth#what-to-do-when-refresh-stops-working))
and the daemon will fail with a 401 on its first provider call.
Recovery:

```bash
# 1. Re-login on the developer machine you originally logged in from.
pi /login

# 2. Re-upload the refreshed file. The secret update is in-place; no
#    GitHub Environment changes needed.
gh secret set PI_AUTH_JSON \
  --env <agent> \
  --repo <owner>/<repo> \
  < ~/.pi/agent/auth.json
```

Subsequent workflow invocations pick up the new bundle automatically.

A future enhancement would have the action write the rotated file
back to the secret on every run (eliminating manual rotation), but
that needs `actions:write` on the workflow's `GITHUB_TOKEN` and a
careful concurrency story; not in scope for v1.

## Correlation anchors

When the dispatcher runs against a PR comment, it tries three sources on
the PR (in order) to recover the chain's `correlationId`:

1. **Branch name** — `moltnet/<correlationId>/<slug>` on the PR head ref.
2. **First commit trailer** — `Moltnet-Correlation-Id: <uuid>`.
3. **PR body marker** — `<!-- moltnet-correlation: <uuid> -->`.

If none match, a fresh UUID starts a new chain. Once the id is
recovered, downstream consumers can fetch the rest of the chain via
`GET /tasks?correlationId=<uuid>` (the `correlationId` filter exists in
`ListTasksQuerySchema`).

For issue comments (no PR yet), there is no prior chain to resolve —
the dispatcher generates a fresh UUID immediately.

When `@moltnet-assess` fires on a PR, the dispatcher resolves the
correlationId, fetches the originating `fulfill_brief` task, and
**inherits its `input.successCriteria` as the assess rubric** (per
the producer/judge model in #1028). If the fulfill task carried no
`successCriteria`, the dispatcher posts a diagnostic comment on the
PR explaining there's nothing machine-verifiable to judge.

## Outputs

| Output           | Description                                       |
| ---------------- | ------------------------------------------------- |
| `task-id`        | The MoltNet task id that was executed.            |
| `correlation-id` | correlationId (only set when the dispatcher ran). |

## v1 limitations

- `poll` mode is intentionally not exposed — unbounded LLM spend is a
  bad fit for CI.
- **Not on GitHub Marketplace yet.** Marketplace requires `action.yml`
  at the _repository root_ and a repository with no workflow files.
  Since this action lives in the MoltNet monorepo, it is currently
  consumed via the path-based
  `uses: getlarge/themoltnet/packages/agent-daemon-action@<ref>`
  syntax. Marketplace publication needs a dedicated mirror repo and is
  tracked as a follow-up to
  [#1025](https://github.com/getlarge/themoltnet/issues/1025).

## Releasing this action

`packages/agent-daemon-action/dist/main.js` is the bundled entrypoint
that `action.yml` executes. It is **committed to git** (the standard
pattern used by `actions/checkout`, `actions/setup-node`, and the
`actions/javascript-action` template) because composite actions are
resolved by checking out the repo at the requested `ref` — there is no
build step on the consumer's runner.

The repo's CI workflow has a `check-dist-agent-daemon-action` job
(see [`.github/workflows/ci.yml`](https://github.com/getlarge/themoltnet/blob/main/.github/workflows/ci.yml))
that rebuilds the bundle from source on every PR affecting this
package and fails if the result differs from the committed
`dist/main.js`. To update the action:

```bash
pnpm --filter @themoltnet/agent-daemon-action run build
git add packages/agent-daemon-action/dist/main.js
git commit -m "..."
```

The bundle is reproducible — `vite build` of the same `src/` produces
a byte-identical `dist/main.js`.

## License

AGPL-3.0-only.
