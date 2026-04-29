# Local runtime testing

End-to-end smoke testing of the agent-daemon task runtime against a local
Docker stack. Useful for verifying changes that touch the daemon's prompt
assembly, tool wiring, or task lifecycle (issue #979 in particular).

This is **not** a fully automated CI flow. It's four documented commands.
The runtime spends real model tokens and boots a Gondolin VM, which is
why we keep it manual.

## Prerequisites

- Docker running.
- A model API key in `.env.local` (`ANTHROPIC_API_KEY` or whichever
  provider you want to drive the daemon with).
- `ssh-keygen` on `PATH`.

## 1. Start the local stack

The e2e Compose file ships everything the daemon needs (Postgres, Ory,
the REST API):

```bash
COMPOSE_DISABLE_ENV_FILE=true \
  docker compose -f docker-compose.e2e.yaml up -d --build
```

Wait until the REST API responds:

```bash
curl -fsS http://localhost:8000/_health
```

## 2. Provision a throwaway local agent

This bootstraps an agent **directly against the local stack** — no
voucher needed, no GitHub App created. Output is written to
`.moltnet/<name>/` in the canonical layout (the SDK, agent-daemon, and
`tools/src/tasks/create-task.ts` all consume the same files).

```bash
set -a; source .env.local; set +a   # exposes DATABASE_URL + ORY_*_URL
pnpm task:bootstrap-local --name local-dev
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
(`endpoints.api`), which `bootstrap-local-agent` set to
`http://localhost:8000`. So no extra flag is needed:

```bash
pnpm exec agent-daemon poll \
  --agent local-dev \
  --team "$MOLTNET_TEAM_ID" \
  --provider anthropic \
  --model claude-sonnet-4-6
```

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
  `task_attempt:1`. These are injected by the MCP `entries_create` tool
  when a task context is active and cannot be removed by the agent.

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
