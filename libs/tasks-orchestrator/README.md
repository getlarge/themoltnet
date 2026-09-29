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

Task **attempt retries** and post-acceptance **domain repair** solve different
problems. A task's attempt budget handles execution failures before the server
accepts an attempt. `waitForValidatedTask` leaves that completed status intact,
parses the accepted output, and—only when parsing rejects it—can create a bounded
chain of caller-owned repair tasks. It returns the full chain and cumulative
usage, so parser evidence and the cost of every attempt remain inspectable.

The repair budget is always explicit. This freeform example resumes the
immediately preceding invalid attempt with `mode: 'extend'`, embeds the exact
parser feedback in the new brief and constraints, and forwards the supplied
idempotency key to task creation:

```ts
import { waitForValidatedTask } from '@themoltnet/tasks-orchestrator';

const outcome = await waitForValidatedTask(initialTask, {
  tasks,
  ctx,
  pollIntervalSec: 5,
  maxRepairs: 2,
  parse: parseDomainState,
  createRepairTask: ({ task, attempt, reason, repairN, idempotencyKey }) =>
    tasks.createTask(
      {
        taskType: 'freeform',
        teamId: task.teamId,
        diaryId: task.diaryId,
        title: `Repair domain output (${repairN})`,
        input: {
          brief: [
            'Repair the prior result so it satisfies the domain contract.',
            `Parser feedback: ${reason}`,
          ].join('\n'),
          constraints: [`Resolve this exact parser error: ${reason}`],
          continueFrom: {
            taskId: task.id,
            attemptN: attempt.attemptN,
            mode: 'extend',
          },
        },
      },
      // Mandatory for durable callers: this closes the external-create crash gap.
      { idempotencyKey },
    ),
});
```

`createRepairTask` owns the entire repair request; the orchestrator injects no
freeform schema or prompt policy. Callback and transport failures propagate,
and failed or cancelled tasks return `failed` without consuming repair budget.

### Recovering a terminally failed stage

`maxAttempts` retries execution on **one task ID** while its task-level budget
remains. `waitForRecoverableTask` is an opt-in workflow decision made **after** a
task becomes terminally failed: it creates a new task ID for the same frozen
request. Its `maxReplacements` budget is independent of task attempts and
`waitForValidatedTask`'s semantic-repair budget. A cancelled task is not
restarted unless `recoverCancelled: true` is explicit.

```ts
import {
  createTaskStep,
  waitForRecoverableTask,
} from '@themoltnet/tasks-orchestrator';

// Keep this exact request in the workflow's durable input or a prior checkpoint.
const frozenRequest = {
  taskType: 'freeform' as const,
  teamId,
  diaryId,
  correlationId,
  input: { brief: 'Extract the document from the accepted source.' },
  maxAttempts: 1,
};
const initialTask = await createTaskStep(
  ctx,
  'extract.2.create',
  ({ idempotencyKey }) => tasks.createTask(frozenRequest, { idempotencyKey }),
);

const outcome = await waitForRecoverableTask(initialTask, {
  tasks,
  ctx,
  pollIntervalSec: 5,
  parse: parseExtraction,
  frozenRequest,
  maxReplacements: 1,
  checkpointPrefix: 'extract.2',
  gateTimeoutMs: 5_000,
  recoveryGate: {
    identity: { name: 'my-recovery-policy', version: '1' },
    decide: async ({ candidate, failure, idempotencyKey, signal }) => {
      // This could call a rule service, supervisor task, or other decision engine.
      // Give an external service the stable key for its own idempotency.
      return recoveryPolicy.decide(candidate, failure, {
        idempotencyKey,
        signal,
      });
    },
  },
  summarizeFailure: ({ attempts }) => ({
    code: classifyFailure(attempts), // caller-sanitized, short and secret-free
  }),
});
```

The gate receives one candidate and a bounded, caller-sanitized failure
summary. It receives no task client or checkpoint context. A callback can
still capture its own capabilities; run an untrusted decision engine in a
separate service or process. Only a validated `approve` verdict creates a replacement. Denial, abstention, malformed output,
timeout, or hook failure returns `blocked` with a reason code; a creation error
returns `replacement_create_failed`. The result retains each task outcome,
all attempts, decision metadata, replacement task ID, and cumulative usage.
With a logger, gate and creation errors emit bounded diagnostic categories
and allowlisted status or transport codes; raw adapter errors and response
details are excluded. Durable results contain only reason codes. If creation
returns a mismatched task, the result includes its ID and mismatched field names.
For an explicit `expiresInSec`, the returned expiry and queue timestamp must
reconcile to that whole-second lifetime. If the request omits it but the initial
task has an expiry, the replacement uses the initial effective lifetime instead
of a possibly changed server default. A long delay between expiry calculation
and database insertion can fail closed because the API does not expose the
original relative lifetime directly.

Decision and task creation have separate stable checkpoints. Replay after a
completed decision checkpoint reuses the verdict; replay after a completed
creation checkpoint reuses the task. The decision checkpoint is bound to the
gate name and version; changing either for an in-flight execution fails closed.
An external gate can still be called again
if the worker dies **after the service answers but before the decision checkpoint
completes**. Its adapter should use the supplied idempotency key and return the
same verdict for that key. The replacement create uses the existing
`createTaskStep` key to reconcile the equivalent task-create gap.

For a failed semantic-repair task, pass its original frozen repair request and
its last **completed** continuation parent as `parentTaskId`. The orchestrator
reuses the exact repair input, including validation feedback, instead of using
the failed attempt as a continuation source. Domain-invalid accepted output
remains an `invalid_output` result for the caller's semantic-repair policy.

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
