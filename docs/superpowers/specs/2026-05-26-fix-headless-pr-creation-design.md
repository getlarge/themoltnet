# Fix headless PR creation for fulfill tasks (#1248)

Date: 2026-05-26
Branch: `issue-1248-tasks-hard-gate-fulfill-completion-when`
Author: LeGreffier (operator: ed@getlarge.eu)

> The issue title says "hard-gate fulfill completion when required PR success
> criteria fail". Investigation showed that frames a _symptom_. The real defect
> is that the agent was steered to a PR-creation path that cannot work in a
> headless run, even though a working in-VM path exists. This spec fixes that
> root cause. It deliberately does **not** add a producer-side hard gate — see
> "Decision: no hard gate" below.

## Problem

Task `e4e2d324-…` carried `input.successCriteria` requiring a real GitHub PR
URL (gate `github-pr-opened`, assertion `pullRequestUrl matches ^https://…`).
The daemon agent could not open the PR — it reported
`"Unable to create PR due to user approval requirements for gh command"` — and
truthfully emitted `verification.passed=false` with the failed gate. The task
still completed (`acceptedAttemptN: 1`). Manual recovery PR: #1247. Diary
incident: `be224974-…`.

## Root cause (prompt-surface misdirection, NOT a wiring gap)

The agent was steered to the wrong execution context for PR creation, even
though a working in-VM path exists.

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
`"Unable to create PR due to user approval requirements for gh command"`. Two
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

**Explicitly rejected fix:** adding a `gh` auto-approve rule to `sandbox.json`.
That would legitimize the host route — running `gh` against GitHub from the
host machine — which is undesirable: PR creation should stay inside the
sandboxed VM, where credentials are already injected and the blast radius is
contained. The host escape-hatch must remain a rare, human-approved last
resort.

## Decision: no hard gate

The issue suggested making `successCriteria` "hard" so a failed required gate
fails the attempt. We are **not** doing that, for two reasons:

1. **It treats the symptom.** Once the agent opens PRs in-VM (this spec), the
   `github-pr-opened` gate stops failing in the first place. A hard gate would
   only have produced a louder failure for a problem that no longer exists.
2. **It muddies a deliberate model.** Producer self-assessment is _advisory_ by
   design (`libs/tasks/src/success-criteria.ts:22-47`): `verification.passed`
   does not gate `/complete`; the binding gate is a downstream judgment task by
   a different agent. Bolting a producer-side hard gate onto the honest
   self-report (a) only ever catches an _honest_ `fail` — a buggy/lying LLM
   that reports `pass` slips through anyway — and (b) blurs the advisory/binding
   line the codebase documents at length. The downstream judge remains the
   enforcement mechanism.

If a real need for producer-side enforcement appears later (e.g. an
imposer who cannot create a follow-up judgment task), reopen it as its own
issue with the trust-model trade-offs stated explicitly.

## Design — prompt-surface fix only. No `sandbox.json`, no `libs/tasks` change.

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
for routine git/gh. (Keeps the already-correct `GH_TOKEN` one-liner.)

> **Scope note — the instructor is generic.** `buildRuntimeInstructor` is
> injected into _every_ task type's system prompt (and propagated to subagents
> via `parentRuntimeInstructor`), and does not branch on `taskType`. So the A3
> wording MUST stay task-type-neutral: phrase it about git/gh execution context
> generally, **not** about "opening your PR". PR-specific instructions belong in
> A2 (`fulfill_brief` prompt) only — a `judge_pack` / `run_eval` task that never
> pushes must not be told about PR mechanics in its invariant block.

## Affected files

| File                                                  | Change                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| `libs/pi-extension/src/moltnet/tools.ts`              | Rewrite `moltnet_host_exec` description; drop push/PR examples (A1) |
| `libs/agent-runtime/src/prompts/fulfill-brief.ts`     | Workflow step 6: explicit in-VM `gh pr create` (A2)                 |
| `libs/pi-extension/src/runtime/runtime-instructor.ts` | One line: git/gh run in-VM; host_exec is last-resort (A3)           |

**Deliberately not changed:**

- `sandbox.json` — to keep PR creation in-VM and out of the host escape-hatch
  (see "Explicitly rejected fix").
- `libs/tasks/**` — no hard gate (see "Decision: no hard gate"); the advisory
  verification model is unchanged.

## Testing

These are prose changes, hardest to unit-test meaningfully. Two layers:

**Regression pin (unit, `libs/pi-extension`).** A test alongside
`host-exec.test.ts` asserting the `moltnet_host_exec` tool description does
**not** recommend `"gh pr create"` / `"git push"` (and ideally that it
mentions the in-VM route). This guards against the lure silently returning in a
future edit. Cheap, deterministic, and pins the exact regression that caused
#1248.

**Acceptance (manual / smoke).** The real signal is a daemon `fulfill_brief`
run that opens a PR in-VM without hitting host approval. Use the agent-daemon
smoke-test walkthrough in `apps/agent-daemon/README.md`: provision a throwaway
agent against the e2e Docker stack, run the daemon, create a brief that
requires a PR, and confirm a PR URL comes back in the output. No automated e2e
is added for this PR — the failure mode is environmental (headless approval),
not a unit-testable code path.

## Out of scope

- Any producer-side hard gate / `successCriteria` enforcement (see "Decision:
  no hard gate"). Includes server-side re-evaluation of assertions and adding a
  `required` field to assertions/sideEffects.
- Any change to the judge (`assess_brief`) path.
- Disabling `gh` in the host escape-hatch entirely — out of scope; the
  escape-hatch keeps `gh` in `HOST_EXEC_ALLOWED` for genuine last-resort use,
  we just stop advertising it for routine PRs.

## Acceptance criteria mapping (from #1248)

The issue listed three acceptance criteria written under the assumption that a
hard gate was the fix. With the root cause corrected, here is an honest mapping:

1. _"A fulfill task can express 'must open a PR' in a way that cannot complete
   with `pullRequestUrl: null`."_ → **Not implemented as stated, by decision.**
   Instead, the agent now reliably opens the PR in-VM, so the honest output
   carries a real `pullRequestUrl`. We are not adding producer-side enforcement
   (see "Decision: no hard gate"); binding enforcement remains the downstream
   judge's role.
2. _"If PR creation fails, the attempt fails with a clear, inspectable error."_
   → Partially, via existing machinery: a genuinely failed `/complete` is still
   converted by the daemon to `tasks.fail` with an inspectable reason
   (`apps/agent-daemon/src/lib/finalize.ts:55-71`). Primarily, though, PR
   creation no longer fails because the agent is steered to the working in-VM
   path (this spec).
3. _"Docs distinguish advisory self-verification from hard completion gates."_
   → The advisory model is unchanged and already documented in
   `success-criteria.ts:22-47`; this spec does not introduce a hard gate, so
   there is no new advisory-vs-blocking distinction to document. The
   instructor/README contradiction about _where_ git/gh run is the doc fix this
   PR actually makes (A1/A3).

This is a narrower resolution than the issue imagined. Recommend updating the
issue (or closing with this rationale) so the title no longer implies a hard
gate shipped.
