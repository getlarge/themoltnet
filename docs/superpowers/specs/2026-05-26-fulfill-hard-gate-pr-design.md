# Hard-gate fulfill completion when required PR success criteria fail (#1248)

Date: 2026-05-26
Branch: `issue-1248-tasks-hard-gate-fulfill-completion-when`
Author: LeGreffier (operator: ed@getlarge.eu)

## Problem

Task `e4e2d324-…` carried `input.successCriteria` requiring a real GitHub PR
URL (gate `github-pr-opened`, assertion `pullRequestUrl matches ^https://…`).
The daemon agent could not open the PR — it reported
`"Unable to create PR due to user approval requirements for gh command"` — and
truthfully emitted `verification.passed=false` with the failed gate. The task
still completed (`acceptedAttemptN: 1`). Manual recovery PR: #1247. Diary
incident: `be224974-…`.

## Root cause (prompt-surface misdirection, NOT a wiring gap)

The issue's title frames a _symptom_ ("hard-gate completion"). The actual
defect is that **the agent was steered to the wrong execution context for PR
creation**, even though a working in-VM path exists.

The VM is provisioned for in-VM `gh pr create`:

- The base snapshot layer **always installs `git`, `gh`, and the `moltnet`
  CLI** (`libs/pi-extension/src/snapshot.ts:4-6`); a repo's `sandbox.json`
  `setupCommands` run _on top of_ that base, they don't replace it.
- Agent credentials are injected **inside the guest** at
  `/home/agent/.moltnet/<name>/`, so "git, gh, and the `moltnet` CLI all work
  inside the guest" (`libs/pi-extension/README.md:74-78, 101-103`).
- VM network egress to `api.github.com` is allowed (`sandbox.json:65`).
- The runtime instructor already documents the correct in-VM `gh` invocation:
  `GH_TOKEN=$(moltnet github token --credentials "$CREDS") gh <command>`
  (`libs/pi-extension/src/runtime/runtime-instructor.ts:43-54`).

So `gh pr create` should "just work" in the VM's normal `bash` tool. The agent
nonetheless reached for the **host escape-hatch** `moltnet_host_exec`, which in
a headless run cannot obtain the human UI approval it requires — producing
`"Unable to create PR due to user approval requirements for gh command"`. Three
prompt-surface signals caused that misroute:

1. **The escape-hatch tool's own description names `git push` and
   `gh pr create` as its canonical examples (load-bearing).**
   `moltnet_host_exec`'s description reads: _"Use ONLY when a sandboxed
   operation is impossible — e.g. `git push`, `gh pr create`"_
   (`libs/pi-extension/src/moltnet/tools.ts:973`). This directly contradicts
   the README ("gh works inside the guest") and is the lure: an agent that
   needs to open a PR matches the tool whose description advertises exactly
   that.

2. **The fulfill prompt says only "Push the branch and open a PR"**
   (`libs/agent-runtime/src/prompts/fulfill-brief.ts:105`) — no "in the VM",
   no `gh pr create`, no `GH_TOKEN`. With no in-prompt route, the agent
   selects a tool by description match (see #1).

3. **Advisory verification let the honest failure through (by design).**
   Producer self-assessment is advisory: `verification.passed=false` does not
   gate `/complete` (`libs/tasks/src/success-criteria.ts:22-47`). The binding
   gate is meant to be a downstream judgment task by a different agent.

**Explicitly rejected fix:** adding a `gh` auto-approve rule to `sandbox.json`.
That would legitimize the host route — running `gh` against GitHub from the
host machine — which is undesirable: PR creation should stay inside the
sandboxed VM, where credentials are already injected and the blast radius is
contained. The host escape-hatch must remain a rare, human-approved last
resort.

## Strategy

Fix the prompt-surface misdirection (primary) so the agent opens PRs **in the
VM**, and add a cheap honest hard-gate as defense-in-depth.

The prompt fix makes PRs openable headlessly via the existing in-VM path. The
hard-gate ensures that _if_ a required gate ever fails again (regression,
transient infra), the attempt fails loudly instead of completing — reusing
machinery that **already exists**: the daemon already converts a
server-rejected `/complete` into a `tasks.fail` with an inspectable reason
(`apps/agent-daemon/src/lib/finalize.ts:55-71`).

## Design

### Part A — Prompt-surface fix (primary). No `sandbox.json` change.

**A1. Fix the `moltnet_host_exec` description (stop the lure at the source).**

In `libs/pi-extension/src/moltnet/tools.ts:969-977`, remove `git push` and
`gh pr create` as the example use-cases. Replace with wording that (a) gives a
genuinely host-only example and (b) states that routine git/gh — including
push and PR creation — run **inside the VM** via the normal `bash` tool, not
this escape-hatch. This fixes every task type's prompt surface at once, not
just `fulfill_brief`, and removes the contradiction with the README.

**A2. Make the in-VM PR route explicit in the fulfill prompt.**

In `libs/agent-runtime/src/prompts/fulfill-brief.ts`, change workflow step 6
from "Push the branch and open a PR" to spell out: run `git push` and
`gh pr create` **in the VM** using your normal `bash` tool, with the
`GH_TOKEN=$(moltnet github token …) gh …` form the runtime instructor
documents. Do not use `moltnet_host_exec` for this.

**A3. Reinforce in the runtime instructor.**

In `libs/pi-extension/src/runtime/runtime-instructor.ts`, add one explicit line
to the existing Identity & credentials block: `git push` and `gh` run in the
VM's normal shell; `moltnet_host_exec` is a last-resort host escape-hatch that
requires human approval and is unavailable in headless task runs — never use it
for routine push/PR. (Keeps the already-correct `GH_TOKEN` one-liner.)

### Part B — Honest hard-gate (defense-in-depth, server-side)

**B1. New cross-field rule in `libs/tasks/src/task-types/index.ts`.**

Compose alongside the existing `requireVerificationWhenCriteriaPresent` (do not
replace it). New helper `rejectFailedRequiredGates(output, input)`:

- Read `input.successCriteria.gates` (if any) and build a map
  `id → required`.
- Read `output.verification.results` (if any). For each result with
  `status === 'fail'` and `kind === 'gate'` whose `id` maps to a gate with
  `required === true`, collect the id + detail.
- If any collected, return an error string:
  `failed required gate(s): <id> (<detail>); attempt cannot complete`.
- Otherwise return `null`.

Combine the two rules for `fulfill_brief` (and, for symmetry,
`curate_pack` / `render_pack`) via a small `composeValidators(...fns)` helper
that returns the first non-null message. This keeps each rule single-purpose
and testable.

**Scope decision (YAGNI):** enforce only **gates** with `required: true`.
Assertions and `sideEffects` have no `required` field in the current schema;
adding one is out of scope. The incident used a _gate_ (`github-pr-opened`),
which this covers. A future PR can extend `required` to assertions if a real
need appears.

**Trust model:** this is the _honest_ hard-gate — it fires only on an explicit
`fail` result for a required gate (exactly the #1248 case, where the agent
truthfully reported the failed gate). It does **not** defend against an LLM that
reports `pass`, or **omits** the gate's result entirely, for a gate it actually
failed. `requireVerificationWhenCriteriaPresent` already forces a `verification`
block to exist when criteria are present, but it does not force one result per
gate id; closing that "missing result == implicit skip" hole would require
per-id completeness enforcement and is deliberately out of scope. Catching a
dishonest `pass`/omission remains the downstream judge's job, unchanged.
Documented explicitly so the distinction in `success-criteria.ts` stays
coherent.

**B2. No daemon change required.** When `validateOutput` returns the new error,
`/complete` throws `VALIDATION_FAILED`, and `finalize.ts:55-71` already converts
it to `tasks.fail({ code: 'output_rejected_by_server', … })`. The failure
record carries the gate id + detail, satisfying "fails with a clear,
inspectable error."

### Part C — Documentation

- Update the `success-criteria.ts` header: the advisory model still holds for
  assertions/rubric/sideEffects and non-required gates, but a **`required`
  gate that self-reports `fail` now hard-blocks `/complete`** on fulfillment
  task types. Make the advisory-vs-blocking line explicit.
- Update `docs/understand/agent-runtime.md` producer/judge section to note the
  required-gate carve-out.

## Affected files

| File                                                  | Change                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| `libs/pi-extension/src/moltnet/tools.ts`              | Rewrite `moltnet_host_exec` description; drop push/PR examples (A1) |
| `libs/agent-runtime/src/prompts/fulfill-brief.ts`     | Workflow step 6: explicit in-VM `gh pr create` (A2)                 |
| `libs/pi-extension/src/runtime/runtime-instructor.ts` | One line: git/gh run in-VM; host_exec is last-resort (A3)           |
| `libs/tasks/src/task-types/index.ts`                  | `rejectFailedRequiredGates` + `composeValidators` (B1)              |
| `libs/tasks/src/success-criteria.ts`                  | Header doc update (C)                                               |
| `docs/understand/agent-runtime.md`                    | Producer/judge note (C)                                             |

**Not changed:** `sandbox.json` — deliberately, to keep PR creation in-VM and
out of the host escape-hatch (see "Explicitly rejected fix" above).

## Testing

**Unit (libs/tasks):**

- `rejectFailedRequiredGates`:
  - required gate fails → error string naming the gate id.
  - required gate passes → null.
  - non-required gate fails → null (advisory).
  - failed result whose id is not a gate (e.g. assertion) → null.
  - no successCriteria / no verification → null.
  - multiple required gates, one fails → error names the failing one.
- `composeValidators`: returns first non-null; null when all pass; still
  enforces `requireVerificationWhenCriteriaPresent` (missing verification +
  criteria present → its original message).

**Integration (libs/tasks or task-service):**

- `validateTaskOutput('fulfill_brief', outputWithFailedRequiredGate, inputWithRequiredGate)`
  returns a non-empty `TaskValidationError[]` on `field: 'output'`.

**E2E (apps/rest-api/e2e), gated on Docker stack:**

- Create a `fulfill_brief` task with a `required: true` gate
  `github-pr-opened`. Claim, then `/complete` with an output whose
  `verification.results` reports that gate `fail` and `pullRequestUrl: null`.
  Assert `/complete` is rejected (VALIDATION_FAILED) and the task does **not**
  reach `completed` / does not set `acceptedAttemptN`. Assert a subsequent
  `/fail` (mirroring the daemon fallback) records the inspectable reason.
  - Use `@moltnet/api-client` typed fns (per the e2e rendered-pack rule), raw
    fetch only for `/health`, `/oauth2/token`, `/auth/register`.

**Prompt-surface (A) verification:** these are prose changes, hardest to
unit-test meaningfully. Pin the regression intent with a cheap string
assertion: a test in `libs/pi-extension` (e.g. alongside `host-exec.test.ts`)
that the `moltnet_host_exec` tool description does **not** contain
`"gh pr create"` / `"git push"` as recommended uses — guarding against the lure
silently returning. No `sandbox.json`/`shouldAutoApproveHostExec` change to
test, since Part A intentionally leaves the auto-approve rules untouched.
Manual/e2e confirmation that a daemon fulfill run opens a PR in-VM is the real
acceptance signal; see the agent-daemon smoke-test walkthrough in
`apps/agent-daemon/README.md`.

## Out of scope

- Server-side deterministic _re-evaluation_ of assertions (defending against a
  lying LLM). Tracked as a possible follow-up; the honest hard-gate + downstream
  judge already cover the stated acceptance criteria.
- Adding a `required` field to assertions / sideEffects.
- Any change to the judge (`assess_brief`) path.

## Acceptance criteria mapping (from #1248)

1. _"A fulfill task can express 'must open a PR' in a way that cannot complete
   with `pullRequestUrl: null`"_ → a `required: true` gate that the producer
   self-reports `fail` now blocks `/complete` (Part B).
2. _"If PR creation fails, the attempt fails with a clear, inspectable error"_
   → existing daemon fallback surfaces `output_rejected_by_server` with the
   gate id/detail (Part B2). And primarily: PR creation no longer fails,
   because the agent is now steered to the working in-VM `gh pr create` path
   instead of the un-approvable host escape-hatch (Part A).
3. _"Docs distinguish advisory self-verification from hard completion gates"_ →
   Part C.
