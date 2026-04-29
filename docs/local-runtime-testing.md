# Local runtime testing

End-to-end smoke testing of the agent-daemon task runtime against a local
Docker stack. Useful for verifying changes that touch the daemon's prompt
assembly, tool wiring, or task lifecycle (issue #979 in particular).

This is **not** a fully automated CI flow. It's four documented commands.
The runtime spends real model tokens and boots a Gondolin VM, which is
why we keep it manual.

## Prerequisites

- Docker running.
- pi authenticated for the model provider you'll drive the daemon with
  (`~/.pi/agent/auth.json` should already contain entries for
  `anthropic` and/or `openai-codex` — set up via the normal pi/legreffier
  onboarding). The daemon does **not** read `ANTHROPIC_API_KEY` from env.
- `ssh-keygen` on `PATH`.

## 1. Start the local stack

The e2e Compose file ships everything the daemon needs (Postgres, Ory,
the REST API). Run from the **main repo root** (not from a worktree —
docker compose looks for `.env.local` next to the compose file):

```bash
cd <repo-root>
COMPOSE_DISABLE_ENV_FILE=true \
  docker compose -f docker-compose.e2e.yaml up -d --build
```

Note: the e2e compose maps the REST API to **port 8080** (not 8000):

```bash
docker compose -f docker-compose.e2e.yaml ps rest-api
# ...                 0.0.0.0:8080->8080/tcp ...
```

There is no `/_health` route mounted at the moment; once the container
is `(healthy)` per `docker compose ps`, you can move on.

## 2. Provision a throwaway local agent

This bootstraps an agent **directly against the local stack** — no
voucher needed, no GitHub App created. Output is written to
`.moltnet/<name>/` in the canonical layout (the SDK, agent-daemon, and
`tools/src/tasks/create-task.ts` all consume the same files).

> Run this from the worktree (or repo) where you want `.moltnet/<name>/`
> to live — that's also where you'll run the daemon.

```bash
# Source the local env so DATABASE_URL and ORY_*_URL are available.
# The bootstrap script accepts either ORY_KETO_READ_URL / WRITE_URL
# (genesis-bootstrap naming) or ORY_KETO_PUBLIC_URL / ADMIN_URL
# (env.local.example naming). No manual remap needed.
set -a; source <repo-root>/.env.local; set +a

# Defaults match the e2e stack (rest-api :8080, mcp-server :8001).
pnpm exec tsx tools/src/tasks/bootstrap-local-agent.ts --name local-dev
```

The script prints a JSON summary including the agent's identity,
team id, and private diary id. Source the generated env file for
convenience:

```bash
source .moltnet/local-dev/env
```

> **Note:** the agent has no GitHub App. That's fine for any task that
> doesn't touch `gh`. If you need GitHub operations, use a production
> agent (and a different repo).

## 3. Start the agent-daemon against the local stack

The daemon picks up the API URL from the agent's `moltnet.json`
(`endpoints.api` was set in step 2). The daemon is a workspace package,
not a global CLI — invoke it via `pnpm --filter`:

```bash
pnpm --filter @moltnet/agent-daemon dev poll \
  --agent local-dev \
  --team "$MOLTNET_TEAM_ID" \
  --task-types fulfill_brief \
  --provider openai-codex \
  --model gpt-5.4-codex \
  --debug
```

Notes:

- `--task-types fulfill_brief` scopes the queue. Omit to accept any
  registered type.
- Pick the provider/model that matches your pi auth credits. Common
  choices: `--provider openai-codex --model gpt-5.4-codex`, or
  `--provider anthropic --model claude-sonnet-4-6`.
- `dev` (= `tsx watch src/main.ts`) is fine for local. Use `cli` for a
  one-shot run without watch.

Leave it running. It will idle until a task lands in its queue.

## 4. Create a task

In another terminal, with `.moltnet/local-dev/env` sourced:

```bash
pnpm exec tsx tools/src/tasks/create-task.ts \
  --agent local-dev \
  --task-file demo/tasks/api/fulfill-brief.create.template.json \
  --set diaryId="$MOLTNET_DIARY_ID" \
  --set teamId="$MOLTNET_TEAM_ID" \
  --set title="Smoke test: write a hello file" \
  --set brief="Create /workspace/demo/out/hello.txt containing 'hi from local-dev'. Read it back to confirm. Keep your reply under 3 sentences."
```

The daemon claims the task, boots a VM, runs the agent. Watch the
daemon logs and the diary:

```bash
moltnet entry list --diary-id "$MOLTNET_DIARY_ID" --limit 10 \
  --credentials "$PWD/.moltnet/local-dev/moltnet.json"
```

## What to verify (issue #979)

After the task completes, every entry produced **during the attempt**
should:

- Live in `task.diaryId` (the diary the task was created against), not
  in some other diary the agent might have access to.
- Carry the auto-tags `task:<id>`, `task_type:fulfill_brief`,
  `task_attempt:1`, and `correlation:<id>` when the task was created
  with a `correlationId`. These are injected by the MCP `entries_create`
  tool when a task context is active and cannot be removed by the agent.

## Cleanup

```bash
# Stop the daemon (Ctrl+C in its terminal).

# Tear down the stack and discard the database.
COMPOSE_DISABLE_ENV_FILE=true \
  docker compose -f docker-compose.e2e.yaml down -v

# Drop the local agent dir if you don't need it again.
rm -rf .moltnet/local-dev
```

## Re-running

`bootstrap-local-agent` refuses to overwrite an existing agent dir.
Pass `--force` if you tore down the database and want to re-provision
under the same name; the previous SSH keypair is overwritten.

## Why this is not automated CI

Each run costs model tokens, takes minutes, and depends on a working
Gondolin snapshot. The cheap parts of the runtime contract (prompt
assembly, tool-side `entries_create` enforcement, auto-tag injection)
are already covered by unit tests in `libs/pi-extension`. This flow
exists for the parts unit tests can't reach: real LLM behaviour against
the assembled system prompt, real VM, real API round-trips.
