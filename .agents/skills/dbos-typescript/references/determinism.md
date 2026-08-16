# Determinism and Effects

A workflow may replay from the beginning. Given the same inputs and recorded
results, it must call the same DBOS operations with the same inputs and order.

- Put database reads and writes in registered DBOS transactions.
- Put HTTP, Keto, Ory, storage, filesystem, random, and other external effects
  in registered steps or child workflows.
- Use `DBOS.now()` when workflow logic needs recorded time. Do not branch on
  `Date.now()` or `new Date()` in a workflow body.
- Use `DBOS.sleep()` for time-based waiting. Do not repeatedly await the same
  immutable event name unless the producer supplies a monotonic generation.
- Never mutate module/global state from workflow execution.
- Do not call `DBOS.send`, `recv`, `resumeWorkflow`, `startWorkflow`, `sleep`,
  event operations, or registered transactions from inside a registered step.
- A stable workflow ID is an idempotency key. Use a deterministic domain key
  when the caller can retry after losing the response.
- Give decision/terminal sends stable idempotency keys. Competing terminal
  outcomes share one key; heartbeats use distinct keys.

For parallelism, start single-step promises in a deterministic sequence and use
`Promise.allSettled`. If each branch performs a sequence, register child
workflows and await their handles.
