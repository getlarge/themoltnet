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

## Root cause (two layers, one load-bearing)

The issue's title frames a _symptom_ ("hard-gate completion"). The actual
defect is that **the headless daemon agent has no non-interactive path to open
a PR**:

1. **Missing `gh` auto-approve rule (load-bearing).** `sandbox.json`
   `hostExec.autoApprove` declares two rules, **both `executable: "git"`**
   (`git push`, `git push origin`, excluding main/master). There is **no
   `executable: "gh"` rule**. `gh` _is_ in `HOST_EXEC_ALLOWED`
   (`libs/pi-extension/src/moltnet/tools.ts:953`) so it may run via
   `moltnet_host_exec`, but with no matching auto-approve rule
   `shouldAutoApproveHostExec` returns `false`
   (`tools.ts:145-157`), so `gh pr create` requires an approval the headless
   run cannot grant → the reported error.

2. **Prompt/instructor never route PR creation through the host escape-hatch.**
   The fulfill prompt says "Push the branch and open a PR"
   (`libs/agent-runtime/src/prompts/fulfill-brief.ts:105`). The runtime
   instructor explains `GH_TOKEN` usage and says `git push` "uses the
   gitconfig-configured credential helper"
   (`libs/pi-extension/src/runtime/runtime-instructor.ts:43-54`) — but never
   states that `git push` / `gh pr create` must run **on the host** via the
   `moltnet_host_exec` tool. The default `bash` tool runs _inside_ the VM
   (`vm.exec`), where host credentials and the SSH agent socket are not
   reachable, so an in-VM `gh`/`git push` cannot authenticate.

3. **Advisory verification let the honest failure through (by design).**
   Producer self-assessment is advisory: `verification.passed=false` does not
   gate `/complete` (`libs/tasks/src/success-criteria.ts:22-47`). The binding
   gate is meant to be a downstream judgment task by a different agent.

## Strategy

Fix the wiring (primary) and add a cheap honest hard-gate as defense-in-depth.

The wiring fix makes PRs openable headlessly. The hard-gate ensures that _if_ a
required gate ever fails again (regression, transient infra), the attempt fails
loudly instead of completing — reusing machinery that **already exists**: the
daemon already converts a server-rejected `/complete` into a `tasks.fail` with
an inspectable reason (`apps/agent-daemon/src/lib/finalize.ts:55-71`).

## Design

### Part A — Wiring fix (primary)

**A1. Add a `gh` auto-approve rule to `sandbox.json`.**

```jsonc
{
  "executable": "gh",
  "argsPrefix": ["pr"],
}
```

Scope to the `gh pr …` subcommand family (covers `pr create`, `pr view`,
`pr edit`, `pr comment`). This matches the GitHub App's `pull_requests: write`
permission surface and the daemon's actual need. It does **not** auto-approve
arbitrary `gh` (e.g. `gh api`, `gh release`, `gh auth`) — those still require
explicit approval, preserving the escape-hatch's security posture.

Rationale for `argsPrefix: ["pr"]` over `["pr", "create"]`: a fulfill agent
legitimately runs `gh pr view` / `gh pr edit` to update an existing PR within
the same attempt; gating only `create` would re-block those. The
`pull_requests: write` token already bounds the blast radius.

**A2. Route PR creation through `moltnet_host_exec` in the prompt + instructor.**

- `runtime-instructor.ts`: add an explicit "Host operations" subsection stating
  that `git push` and `gh pr …` MUST be invoked via the `moltnet_host_exec`
  custom tool (host side), not the in-VM `bash` tool, because host credentials
  and the SSH agent are not available inside the VM. Keep the existing
  `GH_TOKEN` guidance and fold it into the host-exec example (pass `GH_TOKEN`
  via the tool's `env` parameter).
- `fulfill-brief.ts`: change workflow step 6 from "Push the branch and open a
  PR" to name the `moltnet_host_exec` route explicitly and reference the
  instructor's Host operations section.

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

| File                                                  | Change                                                 |
| ----------------------------------------------------- | ------------------------------------------------------ |
| `sandbox.json`                                        | Add `gh pr` auto-approve rule (A1)                     |
| `libs/pi-extension/src/runtime/runtime-instructor.ts` | Host-operations subsection (A2)                        |
| `libs/agent-runtime/src/prompts/fulfill-brief.ts`     | Workflow step 6 routes via host_exec (A2)              |
| `libs/tasks/src/task-types/index.ts`                  | `rejectFailedRequiredGates` + `composeValidators` (B1) |
| `libs/tasks/src/success-criteria.ts`                  | Header doc update (C)                                  |
| `docs/understand/agent-runtime.md`                    | Producer/judge note (C)                                |

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

**Wiring (A) verification:** the `gh pr` auto-approve rule is data in
`sandbox.json`; assert via a `shouldAutoApproveHostExec` unit test in
`libs/pi-extension` that `{executable:'gh', args:['pr','create',…]}` is
auto-approved against the committed rule set, and that `{executable:'gh',
args:['api',…]}` is **not**. This pins the security scope so a future edit
can't silently widen it.

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
   because the host route is now wired (Part A).
3. _"Docs distinguish advisory self-verification from hard completion gates"_ →
   Part C.
