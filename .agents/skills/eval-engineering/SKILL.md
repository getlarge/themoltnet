---
name: eval-engineering
description: Review, improve, and author MoltNet evals — one discipline across every use case (agent-runtime prompt evals in evals-v2/, practice/incident evals in evals/moltnet-practices/, and context-pack evals). Use when asked to "review an eval", "is this eval trustworthy", "improve/rewrite an eval scenario", "write an eval", "create an eval from an incident", "check the baseline", or "gap-test". Merges the LangChain eval-engineering process with MoltNet's battle-tested gap-test principles and the two-stage gate+judge harness.
---

# Eval engineering

One discipline for every MoltNet eval. An eval is a scenario that **distinguishes a
behavior**: the agent (or pack, or prompt) that has the capability passes; the one
that lacks it fails. If a scenario can't fail for the reason you care about, it
isn't an eval — it's a demo.

This skill exists because evals were fragmented into three shapes that never shared
a quality bar. It unifies them under one method and one review lens. It supersedes
`legreffier-eval`; **pack evaluation is now just one use case** here, not a separate
system.

## The two-stage model (how every MoltNet eval is scored)

1. **Deterministic gates** — execution, parsing, files, state, tool calls. Cheap,
   exact, no model. A gate failure is a hard fail (composite 0, judge skipped —
   the anti-inception rule). Gates answer _"did the mechanics happen and stay
   safe?"_
2. **Hidden-rubric judge** — semantic quality only, and only if gates pass. The
   rubric is **never shown to the target** (producer/judge split). The judge
   answers _"was the substance good?"_

> **Assign each check to the right stage.** Anything mechanically verifiable
> (a tool was/wasn't called, a file exists, JSON parses, no secret was uploaded,
> a command ran) is a **gate**, never a judge criterion. Reserve the judge for
> things only a reader can assess. Judge-grading a mechanical fact is the most
> common way evals lie.

## Use cases (same discipline, different target)

| Use case                            | Corpus / shape                                                 | What runs it                                                               |
| ----------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Agent-runtime prompt/behavior       | `evals-v2/<slug>/{prompt.md,eval.json,rubric.json,gates.json}` | `run_eval`/`judge_eval_attempt` against the live agent (`libs/agent-eval`) |
| Repo-practice / incident regression | `evals/moltnet-practices/<slug>/{task.md,criteria.json}`       | weighted-checklist judge                                                   |
| Context-pack value (gap-test)       | scenario + `--pack`                                            | `moltnet eval run` (baseline vs pack delta)                                |

Details and field schemas: [references/scenario-format.md](references/scenario-format.md).

## Method

Adapted from the LangChain eval-engineering process (map → propose → build → audit)
and MoltNet's gap-test principles. Do these in order.

1. **Name the behavior the eval must distinguish.** Concrete and observable
   ("regenerates the Go client after a schema change", "never uploads a file
   containing a secret"), not abstract ("writes good code"). One behavior per
   scenario.
2. **Propose 2–3 directions and let the human pick** before building. Don't
   assume what matters.
3. **Split checks by stage** (gates vs judge, above).
4. **Design the trap so it's invisible** — see
   [references/review-checklist.md](references/review-checklist.md) for the five
   principles. The task must not name the gotcha; fixtures must show only the
   wrong path; ≥40% of a judged score must require _articulation_, not code a
   reader could copy from the fixtures.
5. **Isolate and hide.** No production writes; reset mutable state between trials.
   Keep the rubric/criteria and expected outcomes out of the target's reach.
   **Leakage watch:** if a scenario is seeded from a diary incident and the agent
   under test can search the diary, it can find the answer — run against an
   isolated/scrubbed diary. See [references/incident-to-eval.md](references/incident-to-eval.md).
6. **Measure the baseline; never estimate it.** The author knows the trap and will
   overestimate its difficulty. A separate runner (subagent, no knowledge of the
   trap) runs the eval and reports raw numbers. Run ≥2 for a gate check, ≥4 for
   reporting — single runs are outliers.
7. **Audit, then iterate.** Read the target response, tool calls, gate evidence,
   and verdict. Re-run when the task was unclear, the environment unrealistic, the
   verifier wrong, or infra failed — those are _not_ capability failures.

## Reviewing an eval (the primary workflow)

To review or improve existing scenarios (e.g. the ones in `evals-v2/`), work
through [references/review-checklist.md](references/review-checklist.md). It scores
a scenario on: behavior-distinguishing, stage assignment (no mechanical facts in
the judge), trap validity, answer-not-in-fixtures, articulation weight, leakage,
and baseline integrity. Output a per-scenario verdict (keep / fix / cut) with the
specific defect and the fix — most-severe first.

## Authoring from incidents

The highest-signal evals are regressions from real failures. MoltNet's signed
episodic diary is a corpus of them. But not every incident is evalable, and
incident→scenario is authoring, not extraction: see
[references/incident-to-eval.md](references/incident-to-eval.md) for which
incidents qualify (agent-behavioral, not infra), how to strip the fix out of the
scenario, and the leakage guard.

## Anti-patterns (these produced fake baselines in real runs)

- Estimating a baseline instead of measuring it.
- A judge criterion that tests a mechanical fact a gate should own.
- Criteria that test code _structure_ ("uses a type switch") — observable from
  fixtures, free points that inflate the baseline.
- The task narrating the fix ("add `resolveTeamContext` to the session path").
- Criteria `context` that spoils the answer (it's judge-only, but it shapes the
  criteria into a lookup).
- Showing both the right and wrong pattern in fixtures — tests diffing, not
  domain knowledge.
- Single-run baselines.

Gold standard to study before authoring: `evals/moltnet-practices/dbos-after-commit/`
(20% baseline, follows every principle).
