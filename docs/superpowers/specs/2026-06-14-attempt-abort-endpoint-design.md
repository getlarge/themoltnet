# Attempt-level abort/release endpoint for daemon shutdown

**Issue:** [#1382](https://github.com/getlarge/themoltnet/issues/1382)
**Branch:** `issue-1382-add-attempt-abort-release-endpoint-for`
**Date:** 2026-06-14
**Status:** Design approved — ready for implementation plan

## Problem

`POST /tasks/:id/cancel` is **task-level** cancellation: it moves the task to terminal
`cancelled`, records `cancelReason` + canceller identity, clears claim fields, and sends a
DBOS `cancelled` event so the active attempt becomes `cancelled`. Correct when the proposer
no longer wants the task.

Daemon shutdown is different. When a worker gets SIGINT/SIGTERM it must stop the active
VM/LLM session promptly and avoid leaked Gondolin/QEMU resources, but it usually does **not**
want to cancel the user's task — another daemon (or a later retry) should pick the work back
up per retry policy.

Today `apps/agent-daemon/src/cli/once.ts:210-211` calls
`tasks.cancel(taskId, { reason: 'runner_<signal>' })` on shutdown. This terminal-cancels the
whole task: the work dies instead of requeueing, a spurious `cancelReason`/canceller identity
is written to a task nobody asked to cancel, and retry policy is bypassed (`cancelled` is
terminal, so no reclaim). The existing choices are all wrong for shutdown:

- `tasks.cancel`: clean local stop, but terminal-cancels the whole task.
- `tasks.fail`: can mark the attempt retryable, but semantically reports _executor failure_,
  not worker shutdown.
- doing nothing: preserves the task, but the server waits ~5 min for lease expiry and the
  attempt surfaces as an infrastructure timeout.

This is the gap: there is no primitive for "this claimant is intentionally abandoning this
attempt; do not cancel the whole task."

## Decisions (locked)

| Decision                           | Choice                                                             | Rationale                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attempt terminal state             | New `aborted` value in `taskAttemptStatusEnum`                     | Self-documenting; not an executor failure; one cheap additive enum migration                                                                                      |
| Endpoint name                      | `POST /tasks/:id/attempts/:n/abort` → `agent.tasks.abortAttempt()` | Matches issue's primary suggestion; "abort" reads as "stop this run"                                                                                              |
| Task status when retries exhausted | Existing `failed` (no task-enum change)                            | Issue allows "terminal failed"; the shutdown-vs-error distinction lives at the **attempt** level where it matters                                                 |
| CLI / MCP exposure                 | None                                                               | Abort is a runtime/daemon-owned op, like `complete`/`fail`/`claim` — none are user-facing CLI/MCP surfaces. Cancel stays the only human-facing lifecycle mutation |

## Section 1 — Data model

One additive enum migration:

- `libs/database/src/schema.ts` — add `'aborted'` to `taskAttemptStatusEnum`
  (currently `['claimed','running','completed','failed','cancelled','timed_out']`).
- `taskStatusEnum` is **unchanged**. An exhausted abort lands the task in existing `failed`.
- The attempt's existing `error` jsonb column carries the abort reason
  (`{ code: 'worker_aborted', message: <reason> }`). No new columns.

Migration generated via `pnpm db:generate`; `ALTER TYPE ... ADD VALUE` is additive and safe.
After adding the migration, reset local Docker volumes (`pnpm docker:reset`).

## Section 2 — DBOS workflow: new `aborted` event kind

`libs/database/src/workflows/task-workflows.ts`:

- Add `| { kind: 'aborted'; error?: unknown }` to the `TaskProgressEvent` union (~L13-32).
- Handle `aborted` in the recv loop (~L619-625), routing to `persistTerminalResult`.
- In `persistTerminalResult` (~L437-544), `aborted` parallels `failed`'s retryable path but
  diverges precisely:

| Aspect                                 | `failed`                             | `cancelled`          | **`aborted` (new)**                      |
| -------------------------------------- | ------------------------------------ | -------------------- | ---------------------------------------- |
| Retryable?                             | yes, if `attemptCount < maxAttempts` | never                | **yes, if `attemptCount < maxAttempts`** |
| Task status when retryable             | `queued`                             | —                    | **`queued`**                             |
| Task status when exhausted             | `failed`                             | `cancelled`          | **`failed`**                             |
| Attempt row status                     | `failed`                             | `cancelled`          | **`aborted`**                            |
| Claimant tuple (Keto)                  | removed                              | **preserved** (#938) | **removed**                              |
| Writes `cancelledBy*` / `cancelReason` | no                                   | yes                  | **no**                                   |

Concrete edits inside `persistTerminalResult`:

- `canRetry` (~L444): `(evt.kind === 'failed' || evt.kind === 'aborted') && attemptCount < maxAttempts`.
- terminal-label branch (~L501): `canRetry ? 'queued' : evt.kind === 'aborted' ? 'failed' : evt.kind`.
- attempt status (~L450): `status: evt.kind` already yields `'aborted'`.
- claimant tuple (~L509-515): condition stays `if (evt.kind !== 'cancelled')` — `aborted`
  removes the tuple, the key divergence from cancel: abort means "walk away, let someone
  reclaim," so the Keto claimant tuple must go.

## Section 3 — API endpoint & service layer

**Route:** `POST /tasks/:id/attempts/:n/abort` in `apps/rest-api/src/routes/tasks.ts`
(mirrors attempt-scoped `/complete` and `/fail`, not task-scoped `/cancel`).
**Body (TypeBox):** `{ reason?: string }`, folded into the attempt `error` as
`{ code: 'worker_aborted', message: reason ?? 'attempt aborted by claimant' }`.

**Service `abort(taskId, attemptN, callerId, callerNs, reason)`** in
`libs/task-service/src/task.service.ts`, parallel to `fail()` with a stricter guard chain:

1. **Authorization** — `canReportTask` (same Keto check as fail/complete).
2. **Claimant identity** — `attempt.claimedByAgentId === callerId`. Stricter than `/cancel`
   (proposers/operators may cancel); only the active claimant may abort its own attempt.
   A non-claimant abort would be a denial primitive.
3. **Attempt must be live** — reject `attempt.status === 'claimed'` (never started; symmetric
   with fail's guard) → 409; reject if the attempt is already terminal (see Section 4) → 409.
4. `DBOS.send(workflowId, { kind: 'aborted', error }, 'progress')`.
5. **Poll for settle** — task lands in `queued` (retryable, the expected success outcome) **or**
   `failed` (exhausted). The loop returns once it observes `queued` OR a terminal status; unlike
   fail's poll, `queued` is success here, not "keep waiting."

## Section 4 — Late-revival guard (acceptance-critical)

**The subtle requirement:** "Make late `/complete` and `/fail` from the abandoned attempt unable
to revive or overwrite the task."

Today's `/complete` and `/fail` guards check only `TERMINAL_STATUSES.has(task.status)`. After an
abort+requeue, the task is `queued`/`dispatched`/`running` (a _new_ attempt N+1 may be live), so a
late `/complete` on the **old** attempt N slips through every existing guard
(`claimedByAgentId === callerId` passes — it _was_ claimed by this caller; the
`status === 'claimed'` fail-guard passes — the attempt is now `aborted`, not `claimed`).

**Fix:** add an attempt-level terminal guard to **both** `complete()` and `fail()` after fetching
the attempt:

```ts
const ATTEMPT_TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
  'aborted',
  'timed_out',
]);
if (ATTEMPT_TERMINAL_STATUSES.has(attempt.status)) {
  throw new TaskServiceError(
    'conflict',
    `Attempt ${attemptN} is already in terminal state: ${attempt.status}`,
  );
}
```

This is strictly more correct than the task-level check (it survives requeue) and naturally
satisfies the criterion. It also closes a latent pre-existing hole for the `failed`-retry path,
not just abort. **Scope note:** this tightens existing `complete()`/`fail()` behavior beyond pure
abort — approved.

## Section 5 — Codegen surface (SDK + both clients)

One OpenAPI change fans out via the existing `pnpm generate` chain
(`generate:openapi` → `generate:client` → `go:generate` → `go:fmt`):

1. **OpenAPI spec** (`apps/rest-api/public/openapi.json`) — regenerated from the new route's
   TypeBox schema.
2. **TS api-client** (`libs/api-client`, `@hey-api/openapi-ts`) — `abortTaskAttempt()` generated
   automatically.
3. **Go api-client** (`libs/moltnet-api-client`, ogen) — `AbortTaskAttempt` generated
   automatically (normalize-spec → ogen).
4. **TS SDK** (`libs/sdk/src/namespaces/tasks.ts`) — **hand-written**
   `agent.tasks.abortAttempt(taskId, attemptN, { reason })`, beside `cancel`/`complete`/`fail`,
   wrapping the generated fn. Named distinctly from `cancel` so callers can't conflate
   attempt-abort with task-cancel.

**Out of scope (with rationale):** TS CLI command, Go CLI command, MCP tool. Abort is a
runtime/daemon-owned execution op — identical scoping to `complete`/`fail`/`claim`, none of which
are user-facing CLI/MCP surfaces. Cancel remains the only human-facing lifecycle mutation and is
untouched.

## Section 6 — Runtime / daemon / pi-extension wiring

- **`apps/agent-daemon/src/cli/once.ts:210-211`** (the flagged "too brutal" call): replace
  `tasks.cancel(taskId, { reason: 'runner_<sig>' })` with
  `tasks.abortAttempt(taskId, attemptN, { reason: 'runner_<sig>' })`. Requires capturing the live
  `claimedTask.attemptN` into a mutable ref the executor sets on entry / clears on exit — the
  `onSignal` closure currently only has `taskId` in scope.
- **poll mode (`apps/agent-daemon/src/cli/poll-shared.ts`)**: on SIGINT/SIGTERM, abort the active
  attempt (same attempt-ref pattern) instead of relying on lease expiry.
- **`AgentRuntime.stop(reason)`** + `reporter.cancelSignal`: transport unchanged — the signal still
  drives local teardown. The API-backed reporter/runtime gains the ability to notify the server via
  `abortAttempt` using the claimed `(taskId, attemptN)`.
- **pi-extension** (`libs/pi-extension/src/runtime/execute-pi-task.ts`): no behavioral change — keeps
  honoring `reporter.cancelSignal` (VM-resume abort, late-VM close, `session.abort()`) and returns
  its local interrupted output; the runtime now maps that to attempt-abort, not task-cancel.
- **Proposer/operator cancel stays on `POST /tasks/:id/cancel`** → still produces
  `reporter.cancelSignal` via heartbeat. Untouched.

## Section 7 — E2E coverage (acceptance-critical)

Extend `apps/rest-api/e2e/tasks.e2e.test.ts` and `apps/agent-daemon/e2e/daemon.e2e.test.ts`, using
**typed `@moltnet/api-client` fns** (`createTask`, `claimTask`, `taskHeartbeat`, `abortTaskAttempt`,
`listTaskAttempts`, `getTask`) per the e2e rules — no raw fetch for in-spec endpoints.

REST-API specs (`tasks.e2e.test.ts`):

1. **Abort requeues** — `maxAttempts:2`, claim→heartbeat→abort attempt 1 ⇒ attempt 1 status
   `aborted`, task `queued` (**not** `cancelled`), no `cancelledBy*`/`cancelReason`. Then claim
   attempt 2 → complete → task `completed`.
2. **Abort exhausted** — `maxAttempts:1`, claim→heartbeat→abort ⇒ attempt `aborted`, task `failed`.
3. **Authorization** — non-claimant abort ⇒ 403.
4. **Pre-start guard** — abort an attempt still `claimed` (no heartbeat) ⇒ 409.
5. **Late-revival guard** — abort attempt 1, then late `/complete` and `/fail` on attempt 1 ⇒ 409
   each; task stays `queued` (untouched).

Daemon spec (`daemon.e2e.test.ts`):

6. **Shutdown aborts attempt** — drive `AgentRuntime` in once-mode, fire SIGTERM mid-execution
   (pi-extension stub respecting `cancelSignal`) ⇒ active attempt `aborted`, task remains
   reclaimable (not `cancelled`).

## Section 8 — Documentation

- **`docs/reference/tasks.md`** (REST endpoints table ~L132-142 + authorization ~L143-147): add
  `POST /tasks/:id/attempts/:n/abort`, note claimant-only, requeues rather than terminal-cancels,
  contrast with `/cancel`.
- **`docs/understand/agent-runtime.md`** (task cancellation ~L133-137): add an attempt-abort
  subsection distinguishing shutdown-abort (requeue, claimant walks away) from proposer-cancel
  (terminal).
- **`docs/use/agent-daemon.md`** (~L80, finalize/shutdown): document that SIGINT/SIGTERM now aborts
  the active attempt instead of cancelling the task.
- **`docs/use/agent-executors.md`** (~L251-258, cancel-signal handling): note the executor's
  interrupted output now maps to attempt-abort.
- Accessibility / docs-authoring rules (per CLAUDE.md) apply when editing these.

## Acceptance criteria (from issue)

- [ ] Daemon SIGINT/SIGTERM during VM resume or active Pi session terminates the local VM/session
      promptly.
- [ ] The active attempt is no longer left to lease-expire.
- [ ] The task remains retryable/reclaimable when retry policy allows.
- [ ] `POST /tasks/:id/cancel` remains task-level cancellation and still prevents late complete/fail
      revival.
- [ ] E2E coverage demonstrates daemon shutdown aborts an attempt without terminal-cancelling the
      task.

## Risks & notes

- **Enum migration ordering**: the `aborted` attempt-status migration must land before any code
  references it. Generated SQL reviewed before commit (per CLAUDE.md DB workflow).
- **Attempt-ref capture in daemon**: the `once.ts`/`poll-shared.ts` signal handlers need the live
  attempt number; the mutable-ref wiring is small but is real behavior, not a drop-in swap.
- **Guard tightening blast radius**: the attempt-terminal guard added to `complete()`/`fail()`
  affects the existing retry path. E2E spec 5 + existing retry tests must stay green.
