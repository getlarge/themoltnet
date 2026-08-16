# Authoring and Recovery

## Replay model

An Absurd task handler may restart from the beginning after a retry or worker
replacement. Only completed checkpoints, sleeps, waits, events, and terminal
results are durable. Ordinary local variables and code outside checkpoints may
run again.

Keep workflow logic deterministic around checkpoint results. Put retryable
external effects in stable, semantically named `ctx.step` checkpoints. A step
name identifies a numbered checkpoint slot; changing names or call order can
change replay behavior.

## WorkflowContext boundary

MoltNet workflows depend on the transport-neutral `WorkflowContext`:

- `executionId` is the stable Absurd task ID.
- `step(name, fn)` owns a normal effect checkpoint.
- `beginStep(name)` / `completeStep(handle, value)` own decomposed checkpoints.
- `sleepFor(name, seconds)` is a durable timer.
- events are optional and must be used only with safe generation semantics.

Keep inline/test contexts and the Absurd adapter aligned when this interface
changes.

## Decomposed checkpoints

Use `beginStep` and `completeStep` when a logical gate spans multiple reads or
waits. If the handle is already done, return its state without repeating the
effect. Complete only a terminal decision, not intermediate snapshots.

Approval arming uses two checkpoints: label removal observed, then label
addition observed. They require distinct durable wait names so a stale approval
cannot satisfy a new prompt after recovery.

Persist a deadline once, perform fresh reads on every retry, and checkpoint only
the terminal outcome. Never recalculate a retry budget from process start time.

## Immutable events and waits

Absurd event payloads are immutable and first emit wins. Repeatedly waiting on
one event name does not provide a stream of fresh generations. Use durable sleep
and a fresh external read for polling unless the producer supplies a monotonic
generation in the event name.

## External idempotency

Derive child-task creation keys from `executionId` plus the stable semantic
create-step name. MoltNet uses a SHA-256-derived `absurd:` key. The same key and
canonical request returns the existing task; a changed request conflicts.

A checkpoint alone cannot close the crash gap between an external mutation and
checkpoint persistence. Also pass the stable key to the external API or combine
fresh lookup and conditional create/update in one retry-safe reconciliation
step.

## Fan-out

Each creation branch needs a unique stable step name and its derived idempotency
key. Start all independent creates, wait with `Promise.allSettled`, then surface
an `AggregateError` so a fast failure does not abandon siblings. Do not begin
awaiting task results until all creates have settled.

## Recovery tests

Unit tests should use a memoizing context and replay the workflow with the same
context. Add crash-gap tests after external mutation but before checkpoint
persistence.

Real durability tests use Absurd Postgres. Process-recovery coverage must start
a worker, observe a completed checkpoint, kill the OS process, wait for the
lease, start a replacement worker, and assert the effect executed once. Exercise
real app factories in addition to the generic adapter. Keep the target
non-cacheable and use unique queues with cleanup.
