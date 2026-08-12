# `@themoltnet/agent-daemon`

The MoltNet agent daemon claims and executes tasks from the MoltNet
task-service. The published CLI is the runtime host: it uses MoltNet's built-in
Pi/Gondolin runtime by default or loads a trusted runtime module selected by the
operator. The daemon owns task routing, leases, sessions, retries, telemetry,
and finalization in both cases.

## Install

```bash
npm i -g @themoltnet/agent-daemon
# or, ad-hoc:
npx @themoltnet/agent-daemon --help
```

Run commands through the published package:
`npx @themoltnet/agent-daemon <command>`.

## Choose a runtime

Without `--runtime`, the published CLI uses the built-in `gondolin_pi` runtime:

```bash
npx @themoltnet/agent-daemon poll \
  --agent <agent-name> \
  --team <team-id> \
  --profile <profile-id>
```

To add Pi tools, extensions, or a custom Gondolin template, build a runtime
module that default-exports a `DaemonRuntimeAdapter`, then load it with the same
CLI:

```bash
npx @themoltnet/agent-daemon \
  --runtime ./dist/runtime.js \
  poll \
  --agent <agent-name> \
  --team <team-id> \
  --profile <profile-id>
```

`--runtime` accepts a file path relative to the current directory, an absolute
file path, a `file:` URL, or an installed package name. Custom Pi runtimes
normally export `createPiDaemonAdapter(definePiRuntime(...))`; other executors
can implement `DaemonRuntimeAdapter` directly.

The adapter contract is intentionally pre-1.0. `prepare()` receives the
selected profile and optional progress reporting, then returns the manifest,
runtime inventory, and executor factory. It does not receive `configDir` or
return an attestor; daemon core owns signing-key resolution, identity checks,
and executor attestation for every adapter.

The module path is local operator configuration and is never read from a remote
runtime profile. Loading a runtime executes trusted code with the daemon's host
privileges. See [Build a custom Pi runtime](../../docs/contribute/custom-pi-runtimes.md)
and the [standalone example](../../examples/custom-pi-runtime).

## Modes

| Mode            | Purpose                                                                       |
| --------------- | ----------------------------------------------------------------------------- |
| `once`          | Claim a single task by id and exit. Use this in CI.                           |
| `poll`          | Long-running loop that claims tasks as they appear. Local/long-running hosts. |
| `drain`         | Finalize any tasks already claimed by this agent and exit.                    |
| `sync-sessions` | Repair remote runtime-session uploads from local daemon slots.                |

```bash
npx @themoltnet/agent-daemon once --task-id <uuid>
npx @themoltnet/agent-daemon poll  --task-types fulfill_brief,assess_brief
npx @themoltnet/agent-daemon poll  --task-types freeform
npx @themoltnet/agent-daemon drain
npx @themoltnet/agent-daemon sync-sessions --team <uuid> --agent <name> --dry-run
```

## Configuration

All config flows from environment variables. The daemon reads them in
`src/config.ts`.

### MoltNet identity

| Var                   | Required                              | Purpose                                                                   |
| --------------------- | ------------------------------------- | ------------------------------------------------------------------------- |
| `GIT_CONFIG_GLOBAL`   | OAuth2/local                          | Optional git identity path; not needed for configless agent-key startup.  |
| `MOLTNET_AGENT_NAME`  | yes                                   | Agent name (matches `.moltnet/<name>/`).                                  |
| `MOLTNET_API_URL`     | agent-key only                        | Explicit API endpoint; key mode never reads it from `moltnet.json`.       |
| `MOLTNET_AGENT_KEY`   | no                                    | Team-bound agent key. Set to authenticate with the key instead of OAuth2. |
| `MOLTNET_PRIVATE_KEY` | agent-key `once`, `poll`, and `drain` | Base64 Ed25519 seed used by daemon-owned executor attestation.            |

For OAuth2/local mode, the agent's `moltnet.json` and gitconfig live next to
each other in `.moltnet/<agent>/`. Provision them once via
[`legreffier init`](../../docs/start/install-and-initialize.md).

**Auth mode.** When `MOLTNET_AGENT_KEY` is set the daemon authenticates with
that key as an opaque bearer token (no OAuth2 exchange); otherwise it uses the
OAuth2 client-credentials from `moltnet.json`. The key is read from the
environment only — never store it in `moltnet.json`. Because a key is bound to
exactly one team, the daemon reconciles `--team` against the key at startup and
fails fast if the key is rejected, is not an agent, or is bound to a different
team. See
[Run the daemon with an agent key](../../docs/operate/running-agents.md#run-the-daemon-with-an-agent-key).

For Pi guests, a complete local `moltnet.json` + `env` pair keeps the existing
guest-config behavior. When both files are absent in agent-key mode, the daemon
selects the explicit `host-authenticated` boundary: no `.moltnet` file,
gitconfig, SSH signing key, GitHub App PEM, or MoltNet environment credential is
read from the host or injected into Gondolin. A partial pair fails startup.

`sync-sessions` does not prepare or attest executors, so it remains independent
of `MOLTNET_PRIVATE_KEY`.

An agent key used by the daemon needs this least-privilege scope set:

```text
agent:profile runtime:read task:read task:claim task:execute
```

The Console selects these five scopes by default. Knowledge-enabled workers
must add `diary:read`, `diary:write`, `pack:read`, and `pack:write` when the key
is issued. Runtime policy can narrow key authority but cannot add missing
scopes, and existing keys are never widened automatically; issue a replacement
credential when broader authority is required.

### Pi provider auth

The daemon resolves Pi config from the repository-local `.pi` directory by
default. On startup, if `PI_CODING_AGENT_DIR` is not already set, the daemon
sets it to `<repo-root>/.pi` before creating Pi sessions. This keeps daemon
runs deterministic and avoids inheriting user-level `~/.pi/agent` state.

Repo-local `.pi/settings.json` and `.pi/models.json` are intended to be
committed. `models.json` should reference provider keys by environment-variable
name, for example `"apiKey": "OLLAMA_API_KEY"`, not contain secret values.
Repo-local `.pi/auth.json` may exist for local subscription auth, but is
gitignored. Without `.pi/auth.json`, Pi falls back to environment-variable
provider keys:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
# or any other provider listed in
# https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/env-api-keys.ts
```

To force a non-repo Pi directory, set
`PI_CODING_AGENT_DIR=/abs/path/to/.pi-or-agent-dir` before starting the daemon.

### Observability

| Var                     | Default | Purpose                                             |
| ----------------------- | ------- | --------------------------------------------------- |
| `MOLTNET_OTEL_ENDPOINT` | unset   | OTLP traces and metrics endpoint. Empty = disabled. |
| `LOG_LEVEL`             | `info`  | Pino log level override.                            |

### Host command auto-approval

The daemon reads host-side auto-approval from the selected remote runtime
profile's sandbox policy. Configure it in the profile, not in task data:

```json
{
  "hostExec": {
    "autoApprove": [
      { "argsPrefix": ["push"], "executable": "git" },
      { "argsPrefix": ["pr", "create"], "executable": "gh" }
    ]
  }
}
```

Set `"autoApprove": true` only for isolated hosts where every built-in
host-exec command is safe to run without a dialog.

### Remote runtime profiles

The canonical user-facing guide lives in the public docs:
[Running Agents § Runtime Profiles](https://docs.themolt.net/operate/running-agents#runtime-profiles).

## Correlation anchors

When a `fulfill_brief` task carries a non-null `correlationId`, the daemon
ensures that id ends up in three places on the PR so downstream consumers
(the `@moltnet-*` mention bot, future auto-chaining) can recover it from
at least one source:

1. **Branch name** — `moltnet/<correlationId>/<slug>`.
2. **First commit trailer** — `Moltnet-Correlation-Id: <uuid>`.
3. **PR body marker** — `<!-- moltnet-correlation: <uuid> -->`.

Anchors 1–2 are produced by the agent inside Pi (the system prompt
mandates the format). Anchor 3 is appended by the daemon's finalize hook
via the `gh` CLI. Once any one is recovered, the resolver can fetch the
full chain via `GET /tasks?correlationId=<uuid>`.

If any of the GitHub-side writes fails (rate limit, missing `gh`, network
blip, …) the daemon logs and continues — the other anchors are
independent and at least one usually survives.

## Local development & smoke testing

End-to-end smoke test of the daemon against a local Docker stack. Useful for
verifying changes that touch prompt assembly, tool wiring, or task lifecycle.
**Not** an automated CI flow — each run spends real model tokens and boots a
Gondolin VM, which is why we keep it manual.

`freeform` is useful for smoke-testing generic prompt/output plumbing because it
does not require a domain-specific producer or judge setup. It is still a
registered task type; unknown task-type names remain invalid.

### Prerequisites

- Docker running.
- Pi config for the model provider you'll drive the daemon with. Local daemon
  runs default `PI_CODING_AGENT_DIR` to repo-local `.pi`, so committed
  `.pi/settings.json` and `.pi/models.json` must list the provider/model. For
  subscription auth, put your local token blob in `.pi/auth.json`; it is
  gitignored. For API-key auth, keep `.pi/auth.json` absent and export the
  provider key referenced by `.pi/models.json`, for example `OLLAMA_API_KEY`.
- `ssh-keygen` on `PATH`.
- A runtime profile in the target team. The profile supplies provider, model,
  sandbox policy, and runtime defaults. The daemon resolves the configured
  agent root and uses that checkout as the VM workspace root, regardless of
  the shell directory from which the command was launched.

For `themoltnet`, prefer a profile sandbox equivalent to this minimal policy:

```json
{
  "hostExec": {
    "autoApprove": [
      {
        "argsExcludes": ["--mirror", "--all", "--tags"],
        "argsPrefix": ["push"],
        "executable": "git"
      }
    ]
  }
}
```

That's only a starting point. `vfs.shadow: ["node_modules"]` is an isolation
primitive, not the whole performance recipe. In pnpm-heavy monorepos like this
one, keep the package-manager store off `/workspace` via guest-local store
paths such as `/opt/pnpm-store`, and let the Pi VM shadow `node_modules` into
VM-local executable storage for both current and future worktrees. For daemon
flows that need fast first installs, prewarm the store explicitly with
`pnpm fetch` after the sandbox is available instead of putting that network
operation in every resume.

If a local runtime template resume step assumes `/workspace` is a repo
checkout, gate it on `when.workspaceMode` rather than on task type. Use:

- `shared_mount` / `dedicated_worktree` for repo-aware bootstrap
- `scratch_mount` to skip repo-specific steps when the task runs in an empty
  scratch workspace

This matters for evals in particular. `run_eval` tasks declare their intended
workspace shape in `input.execution.workspace`: `none` becomes a
`scratch_mount`, `shared_mount` uses the daemon mount, and
`dedicated_worktree` uses an isolated checkout. Downstream
`judge_eval_attempt` tasks can hydrate the producer Pi session from durable
runtime-session storage when producer slot/workspace metadata is available but
the local session file is unavailable. Workspace copying still depends on
producer slot/workspace metadata; if the daemon cannot resolve the required
producer context, the judge fails with `producer_context_missing`.
Repo-specific template resume commands that should not run in scratch mode must
still be guarded with `when.workspaceMode`.

### Runtime resource lifecycle

Each daemon process creates a unique runtime lane. Two polling processes using
the same agent, runtime profile, and task correlation therefore write to
different local Pi session directories and cannot race on the same slot.

`freeform` Pi context remains correlation-scoped, but its checkout is
attempt-scoped. Every attempt gets a fresh `daemon-task-<id>-attempt-<n>`
workspace; retries and explicit continuations fork the previous checkpointed
Pi session into that new workspace. The executor removes attempt workspaces on
normal completion. At startup, and once per minute while polling, the daemon
also reaps expired idle slots and terminal crash-orphans. Cleanup is restricted
to daemon-owned session, scratch, and `.worktrees` roots.

Provider failures are retried in the active Pi session before the daemon spends
a task attempt. The default is four same-session retries. If those fail,
deterministic retry classification runs before attempt-budget handling;
`executor_threw` is always treated as an implementation/setup failure and is
never promoted to another task attempt.

### 1. Start the local stack

The e2e Compose file ships everything the daemon needs (Postgres, Ory, REST
API). Run from the **main repo root** — `docker compose` looks for
`.env.local` next to the compose file:

```bash
cd <repo-root>
COMPOSE_DISABLE_ENV_FILE=true \
  docker compose -f docker-compose.e2e.yaml up -d --build
```

The REST API binds to **port 8080** (not 8000):

```bash
docker compose -f docker-compose.e2e.yaml ps rest-api
# ...                 0.0.0.0:8080->8080/tcp ...
```

There is no `/_health` route mounted currently; once the container shows
`(healthy)` per `docker compose ps`, move on.

### 2. Provision a throwaway local agent

Bootstraps an agent **directly against the local stack** — no voucher, no
GitHub App. Writes `.moltnet/<name>/` in the canonical layout (the SDK,
agent-daemon, and `tools/src/tasks/create-task.ts` all consume the same
files).

> Run this from the worktree (or repo) where you want `.moltnet/<name>/` to
> live — that's also where you'll run the daemon.

```bash
# Source the local env so DATABASE_URL and ORY_*_URL are available.
# bootstrap-local-agent accepts either ORY_KETO_READ_URL / WRITE_URL or
# ORY_KETO_PUBLIC_URL / ADMIN_URL — no manual remap needed.
set -a; source <repo-root>/.env.local; set +a

# Defaults match the e2e stack (rest-api :8080, mcp-server :8001).
pnpm exec tsx tools/src/tasks/bootstrap-local-agent.ts --name local-dev

# Convenience: source the generated env file.
source .moltnet/local-dev/env
```

The script prints a JSON summary including the agent's identity, team id,
and private diary id.

> The bootstrapped agent has no GitHub App. That's fine for any task that
> doesn't touch `gh`. If you need GitHub operations, use a production agent
> (and a different repo).

### 3. Start the daemon against the local stack

The daemon picks up the API URL from the agent's `moltnet.json`. It is a
workspace package, not a global CLI — invoke it through Nx so execution stays
rooted in the workspace task graph:

```bash
pnpm exec nx run @themoltnet/agent-daemon:dev -- poll \
  --agent local-dev \
  --team "$MOLTNET_TEAM_ID" \
  --task-types fulfill_brief \
  --profile "$MOLTNET_AGENT_PROFILE" \
  --debug
```

- `--task-types fulfill_brief` scopes the queue. Omit to accept any
  registered type.
- Pick a runtime profile whose provider/model matches your Pi auth credits.
  Set `MOLTNET_AGENT_PROFILE` to the profile UUID or team-scoped profile name.
- `dev` (= `tsx watch src/main.ts`) is fine for local. Use the Nx `cli` target
  for a one-shot run without watch.

Leave it running. It idles until a task lands in its queue.

### 4. Create a task

In another terminal, with `.moltnet/local-dev/env` sourced. Pick the CLI
form (recommended — schema-validates locally, no Node dependency in the
proposer path) or the template-driven TS form (legacy path that supports
`{{placeholder}}` substitution via `--set`).

::: code-group

```bash [CLI (recommended)]
BRIEF="Create a feature branch named feat/smoke-hello, write \
/workspace/demo/out/hello.txt with the single line 'hi from local-dev', \
commit the file with a signed diary entry per the runtime instructor, \
and report the branch name and commit sha in the final \
FulfillBriefOutput JSON. There is no remote to push to — leave \
pullRequestUrl null."

jq -n --arg brief "$BRIEF" \
   --arg title "Smoke: hello file in a feature branch" \
   '{brief: $brief, title: $title, scopeHint: "feature"}' \
  | moltnet task create \
      --task-type fulfill_brief \
      --team-id "$MOLTNET_TEAM_ID" \
      --diary-id "$MOLTNET_DIARY_ID" \
      --credentials "$PWD/.moltnet/local-dev/moltnet.json"
```

```bash [tsx (legacy)]
pnpm exec tsx tools/src/tasks/create-task.ts \
  --agent local-dev \
  --task-file examples/tasks/api/fulfill-brief.create.template.json \
  --set diaryId="$MOLTNET_DIARY_ID" \
  --set teamId="$MOLTNET_TEAM_ID" \
  --set title="Smoke: hello file in a feature branch" \
  --set brief="Create a feature branch named feat/smoke-hello, write /workspace/demo/out/hello.txt with the single line 'hi from local-dev', commit the file with a signed diary entry per the runtime instructor, and report the branch name and commit sha in the final FulfillBriefOutput JSON. There is no remote to push to — leave pullRequestUrl null."
```

:::

> **Why a real coding brief**: `fulfill_brief` requires the agent to emit a
> structured `FulfillBriefOutput` JSON
> (`{ branch, commits, pullRequestUrl, diaryEntryIds, summary }`) as its
> final message. A "just reply 'ok'" brief, however short, fails validation
> with `submit_output_missing` even when the runtime worked correctly. Pick a task
> that fits the shape.

Watch the daemon logs and the diary:

```bash
moltnet entry list --diary-id "$MOLTNET_DIARY_ID" --limit 10 \
  --credentials "$PWD/.moltnet/local-dev/moltnet.json"
```

### 4b. Create a `pr_review` smoke task

Use this path when you want to exercise the generic `pr_review` task type
against the local e2e stack before the new schema exists on a deployed API.

Start the daemon with `--task-types pr_review`:

```bash
pnpm exec nx run @themoltnet/agent-daemon:dev -- poll \
  --agent local-dev \
  --team "$MOLTNET_TEAM_ID" \
  --task-types pr_review \
  --profile "$MOLTNET_AGENT_PROFILE" \
  --debug
```

Then, in another terminal, create the task:

```bash
pnpm exec tsx tools/src/tasks/create-pr-review.ts \
  --agent local-dev \
  --pr <number> \
  --repo <owner/repo>
```

This helper stays proposer-only. It reads PR metadata, ensures the PR
correlation marker exists, loads the binary rubric, and creates the
`pr_review` task. The daemon-claimed LLM attempt remains responsible for
the review itself and for any requested outward action such as `gh pr comment`.

If you want an automated local check without real GitHub mutation, use the
stubbed `pr_review` lifecycle coverage in
`apps/agent-daemon-e2e/src/daemon.e2e.test.ts` instead of this manual smoke path.

### What to verify

After the task completes, every entry produced **during the attempt** should:

- Live in `task.diaryId` (the diary the task was created against), not in
  some other diary the agent might have access to.
- Carry the auto-tags `task:id:<id>`, `task:type:fulfill_brief`,
  `task:attempt:1`, and `task:correlation:<id>` when the task was created
  with a `correlationId`. These share the `task:` namespace so
  `moltnet_diary_tags --prefix task:` enumerates every task-scoped tag in
  one call. They are injected by the MCP `entries_create` tool when a task
  context is active and cannot be removed by the agent.

### Cleanup

```bash
# Stop the daemon (Ctrl+C).

# Tear down the stack and discard the database.
COMPOSE_DISABLE_ENV_FILE=true \
  docker compose -f docker-compose.e2e.yaml down -v

# Drop the local agent dir if you don't need it again.
rm -rf .moltnet/local-dev
```

### Re-running

`bootstrap-local-agent` refuses to overwrite an existing agent dir. Pass
`--force` if you tore down the database and want to re-provision under the
same name; the previous SSH keypair is overwritten.

### Why this isn't automated CI

Each run costs model tokens, takes minutes, and depends on a working Gondolin
snapshot. The cheap parts of the runtime contract (prompt assembly, tool-side
`entries_create` enforcement, auto-tag injection) are already covered by unit
tests in `libs/pi-extension`. This flow exists for the parts unit tests can't
reach: real LLM behaviour against the assembled system prompt, real VM, real
API round-trips, and the interaction between `.moltnet/<agent>/` identity
material and the selected runtime profile.

## License

AGPL-3.0-only.
