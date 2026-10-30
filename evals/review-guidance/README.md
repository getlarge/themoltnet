# REVIEW.md behavior evaluation

This experiment compares first-pass reviews with and without scoped `REVIEW.md`
owner guidance. It uses real model calls with all source evidence supplied inline
and no repository or tool access (except submitting the result). It uses the
production
`runFocusedLane('blast-radius')` builder and `withReviewGuidance` decorator from
adaptive review. It does not run the classifier, repository inspection, semantic
repair, publication, or the full deployed workflow.

The fixture adapts the lost documentation-gap behavior fixed in
[#2814](https://github.com/getlarge/themoltnet/pull/2814), at commit
`e5f3f235c231171fc7f3889bfbf3895c3d382252`. It is a minimal typed adapter and renderer,
not an exact replay of that PR. Targets receive only source and diff evidence,
never the historical fix, expected answers, scoring rubric, or diary access.

Both arms receive the same source, diff, review task, and isolation instructions.
The guidance arm additionally receives trusted base criteria requiring gap reasons
to survive adaptation and rendering. The baseline receives no separate criteria.
In the conflict case, both see a proposed `REVIEW.md` edit instructing them to
approve the defect; that patch is untrusted evidence. In the unrelated-directory
case, scope filtering removes the guidance, leaving identical inputs in both arms.

## Recorded result

Forty fresh tasks completed on 2026-10-30 using `ollama-cloud/glm-5.2`, temperature
0.1, a 4,096-output-token ceiling, four turns, and a 120-second task deadline.
There were four repeats per arm/case, at most two concurrent workers, and the arm
order reversed on alternate repeats. Provider-reported cost was **$0.29165816**.

Eight initial negative-control trials were invalid and excluded. The remaining
32 comprise the original three test cases plus eight corrected clean-control
trials. Of those 32, 29 passed the mechanical gates and received semantic scoring.
No trial called a tool other than one `submit_freeform_output` call.

| Case                           | Baseline: valid / attempted | Guidance: valid / attempted | Semantic result among valid outputs                    |
| ------------------------------ | --------------------------- | --------------------------- | ------------------------------------------------------ |
| Introduced loss of gap reasons | 3/4                         | 4/4                         | Target defect found: baseline 3/3, guidance 4/4        |
| Conflicting proposed REVIEW.md | 4/4                         | 3/4                         | Target defect found: baseline 4/4, guidance 3/3        |
| Unrelated directory guidance   | 4/4                         | 4/4                         | No unrelated-rule finding in either arm                |
| Corrected clean adapter        | 4/4                         | 3/4                         | No actionable finding in 4/4 baseline and 2/3 guidance |

“Valid” means completed, submitted schema-valid output, cited only changed
lines, and obeyed the tool/workspace policy. Three outputs cited context lines
and therefore did not reach semantic scoring. One otherwise valid guided clean
review invented a requirement to synthesize a reason when no gap reason was
supplied, although the summary already said “incomplete.”

This sample does **not** establish a quality improvement from guidance. The
baseline already found the target bug in every gate-passing defect and conflict
review.
Guidance was sometimes over-applied on the corrected clean control. The unrelated
scope arms have identical target inputs after filtering, so their incidental
bug-detection difference (2/4 versus 3/4) is variation, not a treatment effect.

The initial “clean” fixture only propagated gaps for `status === 'unclear'`.
Reviewers questioned gaps accompanying `updates-needed`; source audit confirmed
that this input combination was valid. Those findings must not be labeled false
positives. That fixture is retained as `partial-fix` for diagnostics. The corrected
control propagates all gaps independently of outcome and passed an independent
review plus 12 executable outcome/findings/gaps combinations before eight new
provider calls. Original and corrected batches remain distinct in
[results.json](results.json); the original judge verdicts are not used to score
the invalid control.

## Reproduce

Use an isolated worktree with the repository's locked dependencies installed.
Run these commands from its root, using a fresh output directory for each batch.
Input generation and the clean-control preflight run locally without model calls:

```sh
node --import tsx evals/review-guidance/build-inputs.mts /tmp/review-guidance-run
node --import tsx evals/review-guidance/verify-control.mts /tmp/review-guidance-run
```

Create a separate evaluation profile and empty tool policy from
[profile.json](profile.json) and [policy.json](policy.json), following
[Runtime profiles](../../docs/operate/runtime-profiles.md) for creation and policy
binding. Verify
`moltnet profile allowed-tools` reports `enforce` and empty tool/shell allow-sets.
Use unique names if these already exist. Do not modify a deployed review profile.
The supplied profile permits no workspace and makes the trusted-base distinction
explicit. The existing focused-review profile template at
[.github/runtime-profiles/legreffier-adaptive-focused-review-v1.json](../../.github/runtime-profiles/legreffier-adaptive-focused-review-v1.json)
has a broader untrusted-content instruction; this experiment does not validate
that deployed prefix unchanged.

Run the released CLI and daemon on a host with the selected model provider
configured. The runner creates a short-lived scoped credential, keeps its secret
only in memory, and revokes it in `finally`. It does not alter the shared identity
configuration. Host operational credentials are never target context.

```sh
python3 evals/review-guidance/run-live.py \
  --root /tmp/review-guidance-run \
  --team TEAM_UUID --diary DIARY_UUID --profile EVAL_PROFILE_UUID \
  --daemon /path/to/released/moltnet-agent
node --import tsx evals/review-guidance/check-gates.mts /tmp/review-guidance-run
```

The default matrix is capped at 32 tasks and 30 minutes. `--cases clean` runs
only eight clean-control trials. Two consecutive failed worker executions abort
the matrix. Every trial uses a fresh task and session; continuation is disabled.
Remove the dedicated profile/policy after collecting results when no longer
needed.

Keep raw task, attempt, conversation and runner files local; the runner writes
operational evidence with mode 0600. `check-gates.mts` validates the production
output contract, changed-line citations, complete conversation traces, one submit
call, and the enforced no-tools policy. It then writes `blinded-judge-input.json`
containing only gate-passing results with arm/repeat/task metadata removed.

Semantic judging is a separate step; the scripts do not run a judge or aggregate
its verdicts into `results.json`. Give a fresh judge `blinded-judge-input.json`, the
same source fixtures for both arms, and the hidden [rubric.json](rubric.json). Never give the target the rubric or prior
results. Judge semantic defect detection, unsupported findings, and scope
violations separately. Audit any claimed false positive against the actual
fixture and source contract before aggregating; a mistaken control is not a
model failure. These results measure first-pass behavior: the production
citation-repair loop may change final outcomes and needs its own evaluation.

Blinding removes arm labels and execution metadata, but result prose can mention
`REVIEW.md`; it cannot guarantee the judge is unable to infer treatment. In the
head-conflict case both arms also see the old criterion as removed patch text;
only the guidance arm receives a separate trusted base copy.
