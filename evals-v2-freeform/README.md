# evals-v2-freeform — staging corpus for freeform task-type evals

Scenarios here target the **`freeform`** task type. They use the same four-file
shape as `evals-v2/` (`prompt.md`, `eval.json`, `rubric.json`, `gates.json`) with
one addition: `eval.json` carries `"taskType": "freeform"`, and `prompt.md`
becomes `FreeformInput.brief` (not `RunEvalInput.scenario.prompt`).

This lives in a **separate directory on purpose**: `evals-v2/`'s corpus guard and
`readScenario` are `run_eval`-only today. Folding these in requires extending
`eval.json` with an optional `taskType` (default `run_eval`) and adding a
`buildFreeformInput` producer builder. Until that lands, these are authored +
judge-validated here, out of the run_eval corpus guard's path.

## `submit-output-discipline`

**Behavior distinguished:** a freeform task with producer-visible
`successCriteria` completes its contract by submitting a schema-valid
`FreeformOutput` — a _faithful_ summary plus a verification record — rather than
answering in prose and never submitting, or submitting a hollow "looks fine".

**Stage split (per the eval-engineering skill):**

- **Gate (deterministic, over the real attempt):** `submit_freeform_output`
  captured once, schema-valid `FreeformOutput`, and — because the producer input
  sets a non-rubric `successCriteria` (a `submit-tool-call` gate, so no judge
  rubric leaks) — the cross-field rule `requireVerificationWhenCriteriaPresent`
  forces `output.verification` to be present. Gate failure ⇒ composite 0, judge
  skipped.
- **Judge (hidden rubric, semantic only):** is the submitted summary _faithful_ —
  did it actually find the `.some`-vs-`.every` defect and give a grounded merge
  verdict, or is it a well-written but hollow/wrong sign-off. Mechanical facts
  (submitted? verification present?) are gate-owned and kept out of the rubric.

**Verification status:** producer + gate proven **live** against
`gpt-oss:120b-cloud` — `apps/agent-daemon-e2e/src/live-ollama-freeform.e2e.test.ts`
drives this scenario as a real `freeform` task through the daemon
(`agent.tasks.buildFreeform`) and asserts the gate (completed attempt,
schema-valid `FreeformOutput`, verification present). In the proving run the
model returned a faithful summary that correctly identified the `.some`/`.every`
defect. The hidden-rubric judge leg was validated separately on the same model.
Still open: a measured producer baseline across a trap-blind runner + models,
and folding this into the unified `evals-v2/` corpus once `checkGates` is
task-type-aware.
