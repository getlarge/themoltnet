# @themoltnet/tasks-orchestrator

Durable lifecycle-orchestration engine for [MoltNet](https://themolt.net) tasks.

It gives you one authoring model — a `WorkflowContext` — that runs either
**inline** (synchronous, for tests and simple scripts) or on a **durable
[Absurd](https://www.npmjs.com/package/absurd-sdk) substrate** (Postgres-backed,
crash-safe), plus a parallel fan-out primitive and server-gated joins over
MoltNet tasks.

The design deliberately **composes existing primitives** rather than inventing
new ones: durable steps come from Absurd's checkpoint store, and the join comes
from MoltNet's server-enforced `claimCondition`.

## Install

```bash
pnpm add @themoltnet/tasks-orchestrator @themoltnet/sdk
```

## Core concepts

### `WorkflowContext`

The seam every workflow is written against:

```ts
interface WorkflowContext {
  // Checkpointed, idempotent unit of work. Under Absurd, a completed step
  // replays from the store on retry instead of re-executing.
  step<T>(name: string, fn: () => Promise<T>): Promise<T>;
  // Durable timer. A real sleep under Absurd; a no-op inline.
  sleepFor(name: string, seconds: number): Promise<void>;
}
```

Two contexts ship in the box:

- `inlineContext` — runs each step immediately, `sleepFor` is a no-op. No
  infrastructure; ideal for unit tests.
- `asWorkflowContext(absurdTaskCtx)` — adapts an Absurd `TaskContext` so the same
  workflow becomes durable.

### Durable app factory

`createOrchestrationAbsurdApp` wires a workflow onto an Absurd queue:

```ts
import { createOrchestrationAbsurdApp } from '@themoltnet/tasks-orchestrator';

const app = createOrchestrationAbsurdApp<{ items: string[] }>({
  databaseUrl: process.env.ABSURD_URL!,
  queueName: 'my-queue',
  taskName: 'process_items',
  defaultMaxAttempts: 3,
  run: async (input, ctx) => {
    for (let i = 0; i < input.items.length; i += 1) {
      // Completed steps replay from the checkpoint store after a crash —
      // side effects run exactly once.
      await ctx.step(`item.${i}`, () => doWork(input.items[i]));
    }
    return { processed: input.items.length };
  },
});

await app.createQueue('my-queue');
const { taskID } = await app.spawn(
  'process_items',
  { items: ['a', 'b'] },
  {
    queue: 'my-queue',
  },
);
const worker = await app.startWorker({ concurrency: 1 });
const result = await app.awaitTaskResult(taskID, { timeout: 45 });
await worker.close();
await app.close();
```

### Parallel fan-out — `parallelTasks`

Fan out one MoltNet task per item inside its own uniquely-named `ctx.step`, then
await them all. Replay-safe: each per-item checkpoint replays exactly once on
retry. `concurrency` bounds how many are awaited at a time (creation stays
unbounded — tasks just queue durably).

```ts
import { parallelTasks } from '@themoltnet/tasks-orchestrator';

const { created, results } = await parallelTasks({
  ctx,
  items: briefs,
  createStepName: (_brief, i) => `brief.${i}.create`,
  create: (brief) => tasks.createFreeform(brief),
  awaitResult: (task) => tasks.awaitOutcome(task.id),
  concurrency: 4, // optional back-pressure; default unbounded
});
```

### Server-gated join — `joinCondition`

Build a MoltNet `claimCondition` so a downstream continuation is **server-gated**
on N parallel tasks completing. Auto-nests into a balanced tree when
`N` exceeds the per-group branch limit, and validates against the
server-enforced bounds (re-exported as `MAX_CLAIM_CONDITION_BRANCHES`,
`MAX_CLAIM_CONDITION_DEPTH`, `MAX_CLAIM_CONDITION_STATUSES`, and the derived
`MAX_JOIN_TASKS`).

```ts
import { joinCondition } from '@themoltnet/tasks-orchestrator';

const claimCondition = joinCondition(reviewTaskIds); // op: 'all', status: 'completed'
```

### Await engine

`waitForTaskOutcome`, `waitForAcceptedTask`, and `waitForSignalOrSleep` poll a
MoltNet task to a terminal (or accepted) state, sleeping durably between polls.
Per-poll logs go to `logger.debug`; lifecycle transitions to `logger.info`.

### SDK task client

`createSdkTaskClient(agent)` adapts a `@themoltnet/sdk` `Agent` into the
`TaskClient` the engine expects (create / get / claim / complete).

## Testing

The `./testing` entry point exports a `FakeTasks` in-memory client so you can
unit-test workflows against `inlineContext` with no database:

```ts
import { FakeTasks } from '@themoltnet/tasks-orchestrator/testing';
import { inlineContext } from '@themoltnet/tasks-orchestrator';
```

## Example

[`apps/multi-lens-review`](../../apps/multi-lens-review) is the canonical
runnable fan-out + gated-join workflow: it fans out N specialist code reviews and
joins them into one server-gated verdict, driving both `parallelTasks` and
`joinCondition` end to end.

## License

AGPL-3.0-only
