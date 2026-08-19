---
name: absurd
description: Author, test, debug, and operate Absurd durable workflows. Use when working with WorkflowContext, tasks-orchestrator, parallelTasks, issue-lifecycle, multi-lens-review, Absurd queues, checkpoints, events, retries, idempotency, worker recovery, absurd-sdk, or uvx absurdctl.
license: Apache-2.0
---

# Absurd

Use this skill when the project uses **Absurd**, the Postgres-native durable workflow engine, or when the user mentions **`uvx absurdctl`**, queues, durable tasks, runs, retries, sleeping tasks, or events.

For code changes, read [authoring and recovery](references/authoring-and-recovery.md)
before editing. It covers replay, decomposed checkpoints, immutable events,
external idempotency, fan-out, and process-recovery tests. The operational
playbook below remains the starting point for live task inspection.

## Tiny mental model

- A **queue** is a namespace of Absurd tables (`t_`, `r_`, `c_`, `e_`, `w_`).
- A **task** is the durable workflow instance.
- A **run** is one execution attempt of a task.
- A **step** is a checkpoint. Completed step results are stored as JSON.
- **Sleeping** tasks are usually waiting for time or an event.
- **Events** wake waiting tasks. Event payloads are cached; first emit wins.

Important distinction:

- `task_id` = the whole workflow across all attempts
- `run_id` = one specific execution attempt

## First: use the repository command form

Run the released CLI through `uvx absurdctl`; do not prepend the repository to
`PATH` or invoke a checkout-local binary.

Absurd connection precedence is:

```text
--database > ABSURD_DATABASE_URL > PGDATABASE > postgresql://localhost/absurd
```

For non-URI connections, `PGHOST`, `PGPORT`, `PGUSER`, and `PGPASSWORD` are also honored.

## Default debugging workflow

Prefer **`uvx absurdctl` state inspection before source inspection**. Usually you do **not** need to read application code first.

If the user explicitly asks you to use **`uvx absurdctl`** to inspect or fix a workflow, do that first instead of starting with `rg` / source browsing.

When the user wants to debug a task, start with these commands in order:

### 1) Discover queues

```bash
uvx absurdctl list-queues
```

### 2) Inspect recent activity in the likely queue

```bash
uvx absurdctl list-tasks --queue=default --limit=20
```

Notes:

- `list-tasks` defaults to 50 rows if `--limit` is omitted.
- Useful statuses: `pending`, `running`, `sleeping`, `completed`, `failed`, `cancelled`.

### 3) Focus on failures or sleepers

```bash
uvx absurdctl list-tasks --queue=default --status=failed --limit=20
uvx absurdctl list-tasks --queue=default --status=sleeping --limit=20
```

### 4) Inspect one workflow or one attempt in detail

```bash
uvx absurdctl dump-task --task-id=<task-id>
uvx absurdctl dump-task --run-id=<run-id>
```

`dump-task` is the most important inspection command. It shows things like:

- task name, params, and headers
- retry settings and attempts
- checkpointed step state
- waits / events / sleep state
- final result or failure

## How to reason about common states

### If a task is `failed`

1. `dump-task --task-id=<task-id>`
2. Read the failure and the last successful checkpoints.
3. If needed, inspect the most recent attempt with `--run-id`.
4. Search the code for the task implementation by task name.
5. Only then decide whether to retry.

### If a task is `sleeping`

1. `dump-task --task-id=<task-id>`
2. Look for the wait reason:
   - sleeping until a timestamp
   - waiting for an event name
3. If it is waiting for an event and the user wants it resumed, emit that event.

### If a task is `running`

1. `dump-task --task-id=<task-id>`
2. Look at existing checkpoints to see how far it got.
3. If the user suspects a stuck worker, inspect the worker process / application logs too.

### About workers

Do not assume you need to start or modify a worker.

- If a spawned task moves from `pending` to `sleeping`, `running`, or `completed`, a worker is already active.
- If tasks remain `pending`, then investigate whether a worker for that queue is actually running.
- Only inspect Python / TypeScript runtime details when the task state suggests a worker problem or the user asks for code changes.

### If you need the implementation

After you know the task name, search the codebase for its registration.

TypeScript / JavaScript:

```bash
rg -n "registerTask\(|name:\s*['\"]<task-name>['\"]" .
```

Python:

```bash
rg -n "register_task\(|@.*register_task|['\"]<task-name>['\"]" .
```

If the task is waiting for an event, also search for the event name.

## Common actions

### Spawn work

Use `-P key=value` for strings and `-P key:=json` for typed JSON values.

```bash
uvx absurdctl spawn-task my-task -q default -P foo=bar
uvx absurdctl spawn-task my-task -q default -P count:=42 -P enabled:=true
uvx absurdctl spawn-task my-task -q default -P user.name=Alice -P user.age:=30
```

Use `--params` when the user already has a JSON object:

```bash
uvx absurdctl spawn-task my-task -q default --params '{"foo":"bar","count":42}'
```

### Retry failed work

```bash
uvx absurdctl retry-task <task-id>
uvx absurdctl retry-task <task-id> --max-attempts 5
uvx absurdctl retry-task -q default <task-id> --spawn-new
```

Guidance:

- plain `retry-task` retries the existing task
- `--spawn-new` creates a brand-new task with the original inputs
- prefer understanding the failure before retrying

### Cancel work

```bash
uvx absurdctl cancel-task <task-id>
uvx absurdctl cancel-task -q default <task-id>
```

### Wake waiting tasks by emitting an event

```bash
uvx absurdctl emit-event order.completed -q default -P orderId=123
uvx absurdctl emit-event approval.granted:42 -q default -P approved:=true
```

If the event payload should be structured JSON:

```bash
uvx absurdctl emit-event shipment.packed:42 -q default --payload '{"trackingNumber":"XYZ"}'
```

### Schema setup / migrations

Use these on a blank or controlled database, or when the user explicitly asks:

```bash
uvx absurdctl init --ref 0.4.0
uvx absurdctl schema-version
uvx absurdctl migrate --to 0.4.0
uvx absurdctl create-queue default
```

The schema version is pinned by repository policy. Do not run unversioned
`init` or `migrate` against a MoltNet database.

## Safe operating rules

Be careful with state-changing commands. Unless the user clearly wants them, avoid running these blindly on a shared or production database:

- `init`
- `migrate`
- `create-queue`
- `drop-queue`
- `cleanup`
- `cancel-task`
- `retry-task`
- `emit-event`
- `spawn-task`

If the environment is ambiguous, ask which database / queue is safe to operate on.

## Good copy-paste playbooks

### Debug the latest failures in `default`

```bash
uvx absurdctl list-queues
uvx absurdctl list-tasks --queue=default --status=failed --limit=20
uvx absurdctl dump-task --task-id=<task-id>
```

### Find sleepers and wake one

```bash
uvx absurdctl list-tasks --queue=default --status=sleeping --limit=20
uvx absurdctl dump-task --task-id=<task-id>
uvx absurdctl emit-event <event-name> -q default -P key=value
```

### Reproduce by spawning a task, then inspect it

```bash
uvx absurdctl spawn-task my-task -q default -P foo=bar
uvx absurdctl list-tasks --queue=default --task-name=my-task --limit=5
uvx absurdctl dump-task --task-id=<task-id>
```

Fast path when the user says “spawn a task and debug it”:

```bash
uvx absurdctl spawn-task my-task -q default -P foo=bar
uvx absurdctl list-tasks --queue=default --task-name=my-task --limit=5
uvx absurdctl dump-task --task-id=<task-id>
# then either:
uvx absurdctl emit-event <event-name> -q default -P key=value
# or:
uvx absurdctl retry-task <task-id>
```

## Extra reference

- Use `uvx absurdctl <command> --help` for full options.
- `dump-task --task-id` is usually the best starting point once you know the task.
- Checkpointed step results are durable JSON state; code outside steps may execute multiple times across retries.
