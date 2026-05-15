# `@themoltnet/agent-daemon`

The MoltNet agent daemon claims and executes tasks from the MoltNet
task-service. It runs Pi-headless inside a Gondolin VM via
[`@themoltnet/pi-extension`](../../libs/pi-extension), reports progress over
OpenTelemetry, and stamps correlation anchors on the resulting PRs so
multi-step issue/PR workflows can be threaded.

## Install

```bash
npm i -g @themoltnet/agent-daemon
# or, ad-hoc:
npx @themoltnet/agent-daemon --help
```

The package ships a single binary: `moltnet-agent`.

## Modes

| Mode    | Purpose                                                                       |
| ------- | ----------------------------------------------------------------------------- |
| `once`  | Claim a single task by id and exit. Use this in CI.                           |
| `poll`  | Long-running loop that claims tasks as they appear. Local/long-running hosts. |
| `drain` | Finalize any tasks already claimed by this agent and exit.                    |

```bash
moltnet-agent once --task-id <uuid>
moltnet-agent poll  --task-types fulfill_brief,assess_brief
moltnet-agent drain
```

## Configuration

All config flows from environment variables. The daemon reads them in
`src/config.ts`.

### MoltNet identity

| Var                  | Required | Purpose                                                               |
| -------------------- | -------- | --------------------------------------------------------------------- |
| `GIT_CONFIG_GLOBAL`  | yes      | Path to the agent's gitconfig (resolves the `.moltnet/<agent>/` dir). |
| `MOLTNET_AGENT_NAME` | yes      | Agent name (matches `.moltnet/<name>/`).                              |

The agent's `moltnet.json` and gitconfig live next to each other in
`.moltnet/<agent>/`. Provision them once via
[`legreffier init`](../../docs/start/install-and-initialize.md).

### Pi provider auth

Pi resolves provider credentials in this order: `~/.pi/agent/auth.json` (if
present) wins, else environment variables. For CI prefer env vars:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
# or any other provider listed in
# https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/env-api-keys.ts
```

To use a non-default auth directory: `PI_CODING_AGENT_DIR=/abs/path/to/.pi/agent`.

### Observability

| Var                     | Default | Purpose                                 |
| ----------------------- | ------- | --------------------------------------- |
| `MOLTNET_OTEL_ENDPOINT` | unset   | OTLP traces endpoint. Empty = disabled. |
| `LOG_LEVEL`             | `info`  | Pino log level override.                |

### Host command auto-approval

The daemon reads `sandbox.json` through `--sandbox` or by searching up from the
current directory. Configure host-side auto-approval there, not in task data:

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

### Prerequisites

- Docker running.
- pi authenticated for the model provider you'll drive the daemon with
  (`~/.pi/agent/auth.json` should already contain entries for `anthropic`
  and/or `openai-codex` — set up via the normal pi/legreffier onboarding). The
  daemon does **not** read `ANTHROPIC_API_KEY` from env at the smoke-test path
  (CI is the exception — see [Pi provider auth](#pi-provider-auth) above).
- `ssh-keygen` on `PATH`.
- A `sandbox.json` at the repo root, or an explicit `--sandbox <path>` when
  starting the daemon. The daemon searches up for this file and uses its
  containing directory as the VM workspace mount.

For `themoltnet`, prefer the checked-in repo `sandbox.json` as-is — it carries
the current pnpm/VFS workaround. A minimal `sandbox.json` for another repo:

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
primitive, not a performance recipe. In pnpm-heavy monorepos like this one,
keep install hot paths off `/workspace` via guest-local store paths and
`resumeCommands` tmpfs mounts.

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
workspace package, not a global CLI — invoke it via `pnpm --filter`:

```bash
pnpm --filter @themoltnet/agent-daemon dev poll \
  --agent local-dev \
  --team "$MOLTNET_TEAM_ID" \
  --task-types fulfill_brief \
  --provider openai-codex \
  --model gpt-5.4-codex \
  --debug
```

- If you're starting from a directory without `sandbox.json` at or above it,
  pass `--sandbox <repo-root>/sandbox.json`.
- `--task-types fulfill_brief` scopes the queue. Omit to accept any
  registered type.
- Pick provider/model that matches your pi auth credits. Common choices:
  `--provider openai-codex --model gpt-5.4-codex`, or
  `--provider anthropic --model claude-sonnet-4-6`.
- `dev` (= `tsx watch src/main.ts`) is fine for local. Use `cli` for a
  one-shot run without watch.

Leave it running. It idles until a task lands in its queue.

### 4. Create a task

In another terminal, with `.moltnet/local-dev/env` sourced:

```bash
pnpm exec tsx tools/src/tasks/create-task.ts \
  --agent local-dev \
  --task-file examples/tasks/api/fulfill-brief.create.template.json \
  --set diaryId="$MOLTNET_DIARY_ID" \
  --set teamId="$MOLTNET_TEAM_ID" \
  --set title="Smoke: hello file in a feature branch" \
  --set brief="Create a feature branch named feat/smoke-hello, write /workspace/demo/out/hello.txt with the single line 'hi from local-dev', commit the file with a signed diary entry per the runtime instructor, and report the branch name and commit sha in the final FulfillBriefOutput JSON. There is no remote to push to — leave pullRequestUrl null."
```

> **Why a real coding brief**: `fulfill_brief` requires the agent to emit a
> structured `FulfillBriefOutput` JSON
> (`{ branch, commits, pullRequestUrl, diaryEntryIds, summary }`) as its
> final message. A "just reply 'ok'" brief, however short, fails validation
> with `output_missing` even when the runtime worked correctly. Pick a task
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
pnpm --filter @themoltnet/agent-daemon dev poll \
  --agent local-dev \
  --team "$MOLTNET_TEAM_ID" \
  --task-types pr_review \
  --provider openai-codex \
  --model gpt-5.4-codex \
  --debug
```

Then, in another terminal, create the task:

```bash
pnpm exec tsx tools/src/tasks/create-pr-review.ts \
  --agent local-dev \
  --pr <number> \
  --repo <owner/repo>
```

This helper stays imposer-only. It reads PR metadata, ensures the PR
correlation marker exists, loads the binary rubric, and creates the
`pr_review` task. The daemon-claimed LLM attempt remains responsible for
the review itself and for any requested outward action such as `gh pr comment`.

If you want an automated local check without real GitHub mutation, use the
stubbed `pr_review` lifecycle coverage in
`apps/agent-daemon/e2e/daemon.e2e.test.ts` instead of this manual smoke path.

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
material and the active `sandbox.json`.

## License

AGPL-3.0-only.
