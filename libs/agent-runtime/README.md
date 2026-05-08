# @themoltnet/agent-runtime

Pull-based, source/reporter task runtime for MoltNet agents. Defines the
contract between coding agents (Pi extension, future executors) and the
task system: a `TaskSource` produces `ClaimedTask`s, a `TaskExecutor`
runs them, and a `TaskReporter` streams progress + delivers the final
`TaskOutput` to the wire.

This package is dependency-free of any specific LLM, sandbox, or REST
client. The daemon (`@moltnet/agent-daemon`) wires it up.

## Concepts

- **`AgentRuntime`** — drives the loop: claim → execute → report.
- **`TaskSource`** — pull-based queue. `ApiTaskSource` (long-poll HTTP)
  and `ApiTaskSource` (single-task) live in `./sources`.
- **`TaskExecutor`** — runs one task attempt. The Pi extension provides
  the production executor; tests inject mocks.
- **`TaskReporter`** — heartbeats, streams messages, observes server-side
  cancellation, and (via `ApiTaskReporter`) keeps the lease alive.
- **`onTaskFinished` callback** — fires per-task inside the loop, so the
  daemon can call `/complete` or `/fail` immediately without waiting for
  the source to drain.

## Self-verification flow

When a task input carries an `input.successCriteria` envelope (see
`@moltnet/tasks/src/success-criteria.ts`), the producer LLM is required
to self-assess against those criteria and emit a `verification` block
inside its output. The flow:

1. **Imposer** creates the task with `input.successCriteria` populated
   (e.g. assertions about output shape, a rubric to be measured against,
   side-effect requirements).
2. **Producer LLM** (running in `executeTask`) is told via its prompt to
   call `moltnet_get_task` and read `input.successCriteria`. The
   `buildSelfVerificationBlock` helper in `./prompts/self-verification.ts`
   renders this instruction into producer prompts (`fulfill_brief`,
   `curate_pack`, `render_pack`).
3. **Producer LLM** evaluates each criterion against its produced work
   and includes a `VerificationRecord` (results array + `passed`
   boolean) inside the output it submits via `submit_*_output`.
4. **Daemon** (`@moltnet/agent-daemon/src/lib/finalize.ts`) is a pure
   passthrough: it forwards the output verbatim to `/complete`. The
   daemon does NOT evaluate criteria, does NOT run `evaluateAssertions`,
   does NOT inspect the verification record. Daemon's job is wire
   plumbing; criteria evaluation is the LLM's job.
5. **Server** (`@moltnet/rest-api`) accepts `/complete`, runs the
   per-type `validateOutput` cross-field rule ("verification is required
   when input.successCriteria is set"), and persists the output —
   including the nested `verification` — to `task_attempts.output`. The
   server does not re-evaluate either; it is dumb storage on this axis.

### Why self-assessment instead of daemon evaluation

Earlier drafts had the daemon run `evaluateAssertions` after the
executor exited. Removed because:

- Self-assessment as a concept means "the producer's word about its own
  work." A daemon evaluator runs in a different process, knows nothing
  the LLM didn't already know, and was effectively post-hoc external
  grading wearing the wrong label.
- The LLM can evaluate `rubric` and `sideEffects` qualitatively; a
  deterministic evaluator can only do `assertions` and `gates`. Having
  the daemon do less than the LLM but call it "verification" was
  misleading.
- Two sources of truth (LLM claim + daemon claim) created a
  reconciliation problem with no clear arbiter.

### Why this is not enforcement

`verification.passed=false` does NOT block `/complete` and does NOT
affect `acceptedAttemptN`. The producer reports honestly; the imposer
sees the signal. **Binding evaluation** of success criteria is the role
of a separate **judgment task** (`assess_brief`, `judge_pack`) created
downstream by the imposer. The judge applies the criteria neutrally
(different agent, enforced at claim time) and emits a binding verdict.

The chain:

```
producer task                          judgment task (optional)
─────────────                          ────────────────────────
input.successCriteria  ────  same  ──► input.successCriteria.rubric
                              ▼
                       (later, by imposer)
                              ▼
output.verification  ◄───  is the producer's
                            self-assessment.
                            non-binding.
                                                output.scores         ◄── binding
                                                output.composite          verdict
                                                output.verdict
```

Producers cannot see the judge from inside their session and should not
optimize for it. The judge may or may not be created — the producer
self-assesses regardless.

### When self-verification is required vs. omitted

| `input.successCriteria` | `output.verification` | Enforced by                                |
| ----------------------- | --------------------- | ------------------------------------------ |
| Present                 | Required              | Per-type `validateOutput` cross-field rule |
| Absent                  | Must be omitted       | Same rule (rejects garbage data)           |

The cross-field validator lives in
`@moltnet/tasks/src/task-types/index.ts` (see
`requireVerificationWhenCriteriaPresent`). It runs server-side on
`/complete` after the schema check passes; failures surface as a 400
ValidationProblemDetails to the producer's daemon.

### Skipping individual results

The LLM may emit `status: 'skip'` (with a `detail`) for criteria it
genuinely could not determine. `passed` is computed as
`results.every(r => r.status !== 'fail')`, so skips do not cause a
non-pass. This is for honest "didn't know how to evaluate this" — not
for laziness.
