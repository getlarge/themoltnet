---
title: Keep Workflows Deterministic
impact: CRITICAL
impactDescription: Non-deterministic workflows cannot recover correctly
tags: workflow, determinism, recovery, reliability
---

## Keep Workflows Deterministic

Workflow functions must be deterministic: given the same inputs and step return values, they must invoke the same steps in the same order. Non-deterministic operations must be moved to steps.

**Incorrect (non-deterministic workflow):**

```typescript
async function exampleWorkflowFn() {
  // Random value in workflow breaks recovery!
  // On replay, Math.random() returns a different value,
  // so the workflow may take a different branch.
  const choice = Math.random() > 0.5 ? 1 : 0;
  if (choice === 0) {
    await stepOne();
  } else {
    await stepTwo();
  }
}
const exampleWorkflow = DBOS.registerWorkflow(exampleWorkflowFn);
```

**Correct (non-determinism in step):**

```typescript
async function exampleWorkflowFn() {
  // Step result is checkpointed - replay uses the saved value
  const choice = await DBOS.runStep(
    () => Promise.resolve(Math.random() > 0.5 ? 1 : 0),
    { name: "generateChoice" }
  );
  if (choice === 0) {
    await stepOne();
  } else {
    await stepTwo();
  }
}
const exampleWorkflow = DBOS.registerWorkflow(exampleWorkflowFn);
```

Non-deterministic operations that must be in steps:
- Random number generation (use `DBOS.randomUUID()` for UUIDs)
- Getting current time (use `DBOS.now()` for timestamps)
- Accessing external APIs
- Reading files
- Database queries (use transactions or steps)

## MoltNet rules

- Never call `Date.now()` or `new Date()` in a workflow body, including when
  constructing step or transaction arguments. Use `await DBOS.now()` for a
  recorded timestamp.
- `DBOS.sleep()` takes milliseconds. Prefer `DBOS.sleepSeconds()` when the
  intended unit is seconds.
- Put Postgres work in registered transactions. Put HTTP, Keto, Ory, storage,
  filesystem, and other external effects in retryable steps or child workflows.
- Keep DBOS operations in workflow bodies; do not call registered operations,
  `send`, `recv`, `resumeWorkflow`, `startWorkflow`, sleep, or event operations
  from inside a registered step.
- Use DBOS events as mutable workflow-published state and messages for ordered
  signals. Do not apply Absurd's first-emit-wins event rule to DBOS.
- Use stable workflow IDs and send idempotency keys. Competing terminal sends
  share one key; heartbeats remain distinct.
- Start independent single-step promises in deterministic order and await them
  with `Promise.allSettled`. Use child workflows for concurrent sequences.

Reference: [Workflow Determinism](https://docs.dbos.dev/typescript/tutorials/workflow-tutorial#determinism)
