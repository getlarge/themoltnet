---
name: legreffier-eval
description: Evaluate rendered packs against scenarios and author new gap-test scenarios with adversarial baseline gating. Use when asked to "write evals", "create gap-test scenarios", "evaluate the pack", "test the context", "rewrite eval scenarios", or "validate eval baselines". Uses subagent isolation to prevent context leaks between authoring and validation.
---

# LeGreffier Eval

Evaluate rendered packs against eval scenarios, and author new scenarios
that prove context pack value. Two modes: **run** (measure pack delta)
and **author** (write + validate gap-test scenarios).

## Why subagent isolation matters

An agent that writes a scenario knows the trap it designed. When it
estimates baselines, it projects what it _thinks_ the model will miss —
not what actually happens. This produces fabricated baselines that
collapse when measured.

The fix: **the agent that writes the scenario never runs the baseline.**
A separate subagent with no knowledge of the trap's design runs the eval
binary and reports raw numbers. The author sees the score, not the
reasoning.

## Prerequisites

### Eval runner

The eval runner ships with `@themoltnet/cli`:

```bash
npx @themoltnet/cli eval run --help
```

Key flags:

```bash
# Baseline (no context)
npx @themoltnet/cli eval run --scenario <path>

# With rendered pack (runs both variants, reports delta)
npx @themoltnet/cli eval run --scenario <path> --pack <rendered-pack.md>

# Override agent/judge/model
npx @themoltnet/cli eval run --scenario <path> \
  --agent claude-code --judge claude-code \
  -m anthropic/claude-sonnet-4-6

# Parallel with/without variants
npx @themoltnet/cli eval run --scenario <path> --pack <pack.md> --concurrency 2
```

### Scenario file structure

```
evals/<suite>/<scenario-name>/
├── eval.json                  # Mode + fixture injection
├── task.md                    # What the agent under test sees
├── criteria.json              # Weighted checklist (scores must sum to 100)
├── rewrite-log.md             # Author's intent log (NOT committed)
└── fixtures/                  # Files injected into the eval worktree
    └── *.ts, *.go, etc.
```

See [references/scenario-format.md](references/scenario-format.md) for
file format details and examples.

## When to trigger

- After `legreffier-explore` produces a rendered pack
- When user asks "how good is this pack", "evaluate the pack", "test the context"
- When writing or rewriting eval scenarios
- Before pinning a rendered pack

## Mode 1: Run (evaluate a pack)

### Inputs

- Rendered pack path or ID
- Scenario paths (one or more)

### Steps

1. If given a pack ID instead of a file, render it locally:

   ```bash
   npx @themoltnet/cli pack render --preview <pack-id> --out /tmp/pack.md
   ```

2. Run evals — spawn a **validate** subagent per scenario (see
   [Subagent contracts](#subagent-contracts)). Run subagents in parallel
   when scenarios are independent.

3. Collect results into a delta report:

   | Scenario   | Baseline | With pack | Delta |
   | ---------- | -------- | --------- | ----- |
   | scenario-a | 20%      | 75%       | +55%  |
   | scenario-b | 90%      | 95%       | +5%   |

4. Record results as a diary entry if `DIARY_ID` is available:
   - `episodic` for surprising results (large delta, regression, 0% with-context)
   - `semantic` for stable findings about pack quality
   - Tags: `scope:evals`, `scope:context-packs`, `eval:efficiency`

5. Recommend refinements if specific criteria consistently fail with-context.

## Mode 2: Author (write gap-test scenarios)

### The authoring loop

Read [references/gap-test-principles.md](references/gap-test-principles.md)
before starting. It contains the five design principles and anti-patterns
derived from real failures.

The loop uses an AUTHOR subagent for writing and the ORCHESTRATOR
(main session) for baseline validation:

```
┌─────────────────────────────────────────────────┐
│                  Orchestrator                    │
│  (this conversation — coordinates, gates, logs)  │
│                                                  │
│  0. DISCOVER (vivo only)                         │
│     → browses diary for seed entries             │
│     → follows relations to commits               │
│     → validates fixture.ref                      │
│     → gathers context for AUTHOR                 │
│                                                  │
│  1. Spawns AUTHOR subagent(s)                    │
│     → receives scenario files + rewrite-log      │
│     → for vivo: also receives discovery output   │
│     → writes files, does NOT run evals           │
│     → multiple authors can run in parallel       │
│                                                  │
│  2. VALIDATE step (orchestrator runs directly)   │
│     → runs eval command in main session          │
│     → the orchestrator did not author the         │
│       scenario (that was the subagent), so the   │
│       measurement is not self-graded             │
│     → returns: raw score + per-criteria pass/fail │
│                                                  │
│  3. Orchestrator compares intent vs result        │
│  4. Gates on baseline score                      │
│  5. If gate fails: spawns AUTHOR again with      │
│     score (not criteria breakdown) + iteration #  │
└─────────────────────────────────────────────────┘

**Why the orchestrator validates, not a subagent:** Subagents inherit
restricted permissions and typically cannot run bash commands. The
orchestrator has bash access and — critically — did not author the
scenario. The authoring happened in a subagent with its own context,
so the orchestrator's measurement is not self-graded.

**Stronger isolation (optional):** The human can run the eval commands
themselves and paste the scores back. This is the cleanest separation
but slower. Use when you want maximum confidence in baselines.
```

#### Step 0: Discover fixture.ref (vivo scenarios only)

Skip this step for vitro scenarios. For vivo scenarios, the orchestrator
discovers the `fixture.ref` commit and gathers context from diary entries
before spawning the AUTHOR subagent.

Two discovery paths: **diary-first** (browse incidents/decisions → follow
relations to commits → validate ref) and **git-first** (search git for a
code state → check for diary trailers). Both converge at a validated ref

- scenario seed content.

See [references/fixture-ref-discovery.md](references/fixture-ref-discovery.md)
for the full procedure with bash examples.

#### Step 1: Spawn AUTHOR subagent

The author subagent receives:

- Full project context (diary entries, rendered pack, codebase)
- The gap-test design principles (from references/)
- The gold standard scenario (`evals/moltnet-practices/dbos-after-commit/`)
- If rewriting: the current scenario files + previous iteration's score
  (score only, NOT which criteria passed/failed)

The author subagent produces:

- `task.md`, `criteria.json`, `eval.json`, `fixtures/*`
- An intent declaration in `rewrite-log.md`:

```markdown
## Iteration N

### Intent

- **Trap**: what incorrect pattern am I tempting the model toward?
- **Leak closed** (if rewrite): what hint did I remove vs previous iteration?
- **Expected failure**: which criteria should the model fail, and why?
- **Knowledge required**: what specific knowledge is needed that isn't
  in the fixtures?
```

The author subagent does NOT:

- Run any eval commands
- Estimate or project baseline scores
- Access previous iteration's criteria breakdown

#### Step 2: Validate (orchestrator runs baseline)

The orchestrator runs the eval command directly in the main session.
This is safe because the orchestrator did not author the scenario — it
was written by a subagent in a separate context.

Run at least 2 times for the gate check:

```bash
npx @themoltnet/cli eval run --scenario <path>
npx @themoltnet/cli eval run --scenario <path>
```

After each run, read the `trial_result.json` from the output directory
(path printed by the command) and record:

```
Run 1: 55% — passed: [criterion_a, criterion_d], failed: [criterion_b, criterion_c]
Run 2: 70% — passed: [criterion_a, criterion_b, criterion_d], failed: [criterion_c]
```

The orchestrator does NOT consult the rewrite-log before running
baselines. Read the rewrite-log only AFTER collecting scores, during
the gate check (Step 3).

#### Step 3: Gate check

The orchestrator (this conversation) applies the gate:

| Mean baseline | Action                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ≤ 60%         | **PASS** — scenario is a valid gap-test. Proceed to with-context validation.                                                                                       |
| 61-80%        | **MARGINAL** — compare author's expected failures vs actual. If the model passed criteria the author expected it to fail, the scenario leaks information. Rewrite. |
| > 80%         | **FAIL** — the model already knows the answer. Rewrite.                                                                                                            |

#### Step 4: Iterate or accept

If the gate fails, spawn a new AUTHOR subagent with:

- The iteration number
- The aggregate score (e.g., "mean 75% across 2 runs")
- NOT the per-criteria breakdown (to prevent reverse-engineering the judge)
- The previous rewrite-log (so the author can see its own intent history)

If the gate passes, optionally run with-context validation:

```bash
npx @themoltnet/cli eval run --scenario <path> --pack <rendered-pack.md>
```

- A positive delta (baseline → with-pack improvement ≥ 15 points) confirms
  the pack contains knowledge the scenario tests

#### Step 5: Finalize

When a scenario passes the gate:

1. Remove `rewrite-log.md` (process artifact, not committed)
2. Commit the scenario files
3. Record the measured baseline + delta in a diary entry

### Information flow diagram

```
AUTHOR (subagent):                 ORCHESTRATOR (main session):
──────────────────                 ──────────────────────────
✓ Project context                  ✗ Project context (doesn't read it for eval)
✓ Diary entries                    ✗ Diary entries (doesn't consult them)
✓ Rendered pack                    ✓ Rendered pack (only for with-context runs)
✓ Gap-test principles              ✓ Gate rules + rewrite-log (after scoring)
✓ Gold standard scenario           ✓ Scenario files (reads after author writes)
✓ Previous score (aggregate only)  ✓ Per-criteria breakdown (from eval output)
✓ Discovery output (vivo only)     ✓ Eval command + bash access
✗ Per-criteria breakdown           ✓ Discovery (diary + git, vivo only)
✗ Eval commands                    ✗ Author's intent (until after scoring)
```

## Subagent contracts

### AUTHOR subagent prompt template

See [references/author-subagent-prompt.md](references/author-subagent-prompt.md)
for the full template. Key constraints:

- Must produce an intent declaration before writing files
- Must NOT run eval commands or estimate scores
- Must follow gap-test design principles from references/

## Gold standard reference

`evals/moltnet-practices/dbos-after-commit/` — scores 20% baseline.

Properties that make it work:

- TODOs placed inside the transaction callback (the wrong location)
- Task never mentions "separate connections" or "DBOS"
- 60% of score requires naming specific systems and failure modes
- Fixture shows only the intuitive (wrong) pattern
- Criteria context explains what's being tested (judge-only, not visible
  to agent under test)

Study this before writing new scenarios.

## Recording results

When `DIARY_ID` is available, record eval results as diary entries:

**After pack evaluation (run mode):**

```
entry_type: episodic (if delta > 20% or delta < 0)
entry_type: semantic (if stable, expected results)
tags: [scope:evals, scope:context-packs, eval:efficiency, pack:<pack-id>]
importance: 7 (surprising results) or 5 (expected results)
```

**After scenario authoring:**

```
entry_type: procedural
tags: [scope:evals, eval:gap-test-design, branch:<current-branch>]
importance: 6
content: scenario name, measured baseline, iteration count, key design choices
```

## Phases (from #566)

This skill implements **Phase 1** (local skill). Later phases:

- **Phase 2** (after #523): Store eval sessions via API, query historical
  scores, compare pack versions over time
- **Phase 3**: Use eval deltas to recommend compile parameter changes,
  A/B test token budgets and tag filters
