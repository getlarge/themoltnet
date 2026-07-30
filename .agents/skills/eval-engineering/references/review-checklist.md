# Eval review checklist

Use this to review or improve a scenario. Score each dimension, then emit a
verdict per scenario — **keep / fix / cut** — with the specific defect and the
concrete fix, most-severe first. A scenario that fails any of the first three is
not a trustworthy eval yet.

## The dimensions

### 1. Distinguishes a behavior (blocker if it fails)

Can this scenario actually _fail_ for the reason you care about? Name the behavior
in one observable sentence. If a capable and an incapable target would score the
same, it's a demo, not an eval.

### 2. Stage assignment — no mechanical fact in the judge (blocker)

Every check is either a **deterministic gate** (execution, files, state, tool
calls, parsing, safety tripwires) or a **judge criterion** (semantic quality).
A mechanical fact graded by the judge is a lie waiting to happen.

- Gate, not judge: "tool X was called", "file exists", "output JSON parses",
  "no uploaded artifact matched a secret pattern", "command ran".
- Judge, only: "the explanation is correct and coherent", "notes name the real
  failure mode".

In `evals-v2/`, gates live in `gates.json`, the judge key in `rubric.json`
(hidden from the producer). In `evals/moltnet-practices/`, the checklist is
judge-scored — so any mechanical item there is a smell; push it to a gate if the
harness supports one.

### 3. The answer isn't in the fixtures / prompt (blocker)

> 70% of the score must require knowledge that can't be derived from the provided
> code or the task text. Test: have someone read only the task + fixtures. If they
> score >70% with no domain knowledge, it leaks.

### 4. The trap is invisible

- The task reads as a straightforward request and does **not** name the gotcha
  ("the server returns 204, so handle both" gives it away).
- Fixtures show only the **wrong** path, with no `// CORRECT:` comments and no
  sibling file that demonstrates the right pattern (that tests diffing, not
  knowledge).
- The intuitive (wrong) solution is where the scaffolding leads.

### 5. Articulation weight (for judged scenarios)

≥40% of a judged score must require the target to _explain why_ — name the
systems, describe the failure mode, identify the missing check. Correct code
alone should cap at ≤60%. Criteria that test code _structure_ ("uses a type
switch") are observable from fixtures — free points that inflate the baseline.

### 6. Leakage & isolation

- No production writes; mutable state reset between trials.
- Expected outcomes / rubric / criteria `context` are out of the target's reach.
  (`criteria.json.context` is judge-only, but if it states the exact answer the
  author will unconsciously turn the criteria into a lookup.)
- **Diary leakage:** if the scenario was seeded from an incident entry and the
  target can search the diary, it can find the fix. Run against an isolated or
  scrubbed diary. See [incident-to-eval.md](incident-to-eval.md).

### 7. Baseline integrity

- The baseline is **measured, not estimated.** The author knows the trap and
  overestimates difficulty. A separate runner with no knowledge of the trap runs
  it and reports raw numbers.
- ≥2 runs for a gate check, ≥4 for reporting — one run is an outlier
  (`repository-tenant-scope-bypass` spread 55–100% across four runs).

### 8. Harness hygiene (evals-v2 specifics)

- Rubric criteria weights sum to exactly 1 (`readScenario` throws otherwise).
- At least one gate is asserted (the corpus guard requires it).
- `requirePromptSections` checks section _ids_, which are emitted regardless of
  content — it can't distinguish "context present vs absent". Don't rely on it as
  a behavioral signal; use a gate or the judge delta.
- Gates see tool **names** and message/attempt events only — not tool arguments
  or artifact bytes. A check that needs artifact content needs a new gate kind.

## Output format

For each scenario reviewed:

```
<slug> — <keep | fix | cut>
  defect:  <the single most important problem, or "none">
  fix:     <the concrete change>
  (repeat for each additional defect, most-severe first)
```
