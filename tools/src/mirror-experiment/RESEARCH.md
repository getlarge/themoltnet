# The Mirror Effect on Coding Agents

**An experiment in agent self-awareness and output quality**

Date: 2026-03-15
Model: Claude Sonnet 4.6
Infrastructure: `AxAIClaudeAgentSDK` (keychain auth, no API key)

## Motivation

> "When we are made self-conscious we become more accountable. Students consider
> working on an exam paper after time is up as cheating, and yet 71% of them
> continue to do so if left alone. However, only 7% do so if they are made
> self-aware by a mirror hanging in the exam room."
>
> — From the Self Illusion by Bruce Hood

**Hypothesis:** Telling a coding agent that its work will be scored, traced, and
reviewed by a second agent improves the quality of its output.

## Experimental Design

Two conditions, same task, same model:

- **Control:** Plain task prompt
- **Mirror:** Same prompt + self-awareness suffix informing the agent that its
  work will be scored, traced, compared, and verified

The mirror suffix:

```
EVALUATION CONTEXT:
- Your review will be scored against an answer key listing all known bugs
- Each missed bug is -1 point; each false positive is -0.5 points
- A second reviewer will verify every claim you make
- Your output trace is recorded and compared against other reviewers
- Superficial reviews that miss subtle bugs score near 0
```

## Run 1: Simple Code Generation (parseRetryAfter)

**Task:** Write a `parseRetryAfter` function handling integer seconds, HTTP-dates,
null, and invalid input, with tests.

**Scoring:** Heuristic keyword matching (7 criteria: has function, has tests,
handles null, HTTP-date, invalid, past dates, edge cases).

### Results

| Metric        | Control | Mirror | Delta  |
| ------------- | ------- | ------ | ------ |
| Quality score | 1.00    | 1.00   | 0.00   |
| Output lines  | 146     | 139    | -7     |
| Output tokens | 1,704   | 1,923  | +219   |
| Input tokens  | 587     | 661    | +74    |
| Latency (ms)  | 19,533  | 22,034 | +2,501 |

All 7/7 criteria met in both conditions. The mirror condition used 13% more
output tokens and took 13% longer but produced no measurable quality improvement.

### Analysis

The task was **too well-defined**. Sonnet 4.6 produces a perfect solution every
time regardless of framing. The mirror effect requires a task where the agent
must choose between thorough and lazy — analogous to students who _know_ the
answer but choose to cheat.

## Run 2: Code Review with Planted Bugs

**Task:** Review a ~80-line TypeScript module (rate limiter + auth + batch
processor) and find ALL bugs. The code contained 7 known bugs ranging from
obvious to subtle.

**Scoring:** Heuristic keyword matching against a bug answer key (7 bugs +
corrected code = 8 checkpoints).

### Known Bugs in the Code

| #   | Bug                                                  | Severity | Category      |
| --- | ---------------------------------------------------- | -------- | ------------- |
| 1   | `processBatch` race condition (`index++` not atomic) | Critical | Concurrency   |
| 2   | Rate limit off-by-one (`>=` vs `>`)                  | High     | Logic         |
| 3   | Remaining can go negative with `cost > 1`            | Medium   | Validation    |
| 4   | Rate limited after already consuming quota           | High     | Logic         |
| 5   | Hash truncated to 64 bits — collision risk           | Medium   | Security      |
| 6   | Windows Map grows unboundedly — no eviction          | Medium   | Memory        |
| 7   | "Sliding window" is actually a fixed window          | Low      | Naming/Design |

### Results

| Bug                           | Control   | Mirror     |
| ----------------------------- | --------- | ---------- |
| Race condition (index++)      | Found     | Found      |
| Off-by-one (>= vs >)          | Found     | Found      |
| Negative remaining (cost > 1) | Found     | Found      |
| Consume-before-check          | Found     | Found      |
| **Hash truncation (64 bits)** | **Found** | **Missed** |
| Memory leak (no eviction)     | Found     | Found      |
| Not actually sliding          | Missed    | Missed     |
| Corrected code provided       | Missed\*  | Missed\*   |

\* Both provided corrected code, but the heuristic detection was too strict.

| Metric        | Control | Mirror  | Delta            |
| ------------- | ------- | ------- | ---------------- |
| Bugs found    | 6/8     | 5/8     | -1               |
| Quality score | 0.80    | 0.70    | **-0.10 (-12%)** |
| Output lines  | 193     | 174     | -19              |
| Output tokens | 12,666  | 13,114  | +448             |
| Latency (ms)  | 211,894 | 210,183 | -1,711           |

### The Mirror Made It Worse

The mirror condition **missed the hash truncation bug** that the control found.
Instead, the mirror condition identified a different real bug not in our answer
key (concurrency validation for `processBatch` with `concurrency <= 0`).

Examining the actual outputs:

**Control's hash truncation finding:**

> "Bug 4 — `hashApiKey`: Hash truncated to 64 bits, used as a user identifier
> (Security). `.slice(0, 16)` — 16 hex chars = 8 bytes = 64 bits. This is fine
> for a rate-limit bucket key, but the value is also returned as `userId`,
> making it an authentication credential."

**Mirror's replacement finding:**

> "Bug 4 — `processBatch()`: Zero or negative concurrency creates no workers.
> If `concurrency <= 0`, `Array.from({ length: 0 })` produces an empty worker
> array. `Promise.all([])` resolves immediately."

The mirror condition's "false positive penalty" framing (`-0.5 points per false
positive`) appears to have made the agent **more conservative** — it reported
fewer findings and avoided the hash truncation issue, which sits at the boundary
between "bug" and "design choice." The explicit scoring pressure suppressed
exploratory analysis.

## Run 3: Code Review with LLM-as-Judge (n=3)

**Task:** Same code review task as Run 2.

**Scoring:** LLM-as-judge via `ax()` structured output. A separate Claude call
scores the review against the answer key, returning `score`, `found`, `missed`,
`falsePositives`, and `reasoning`. Much more robust than keyword matching.

**Infrastructure:** Both reviewer and judge use `AxAIClaudeAgentSDK` via `ax()`
programs with typed signatures.

### Results (3 runs per condition)

| Metric              | Control (avg) | Mirror (avg) | Delta            |
| ------------------- | ------------- | ------------ | ---------------- |
| **Judge score**     | 0.65          | 0.52         | **-0.13 (-20%)** |
| **Bugs found**      | 5.0           | 4.0          | **-1.0**         |
| **False positives** | 1.33          | 0.67         | -0.67            |
| Review latency (s)  | 47.35         | 49.88        | +2.53            |

### Per-run breakdown

| Run | Control score | Control (found/fp) | Mirror score | Mirror (found/fp) |
| --- | ------------- | ------------------ | ------------ | ----------------- |
| 1   | 0.64          | 5 found, 1 fp      | 0.50         | 4 found, 1 fp     |
| 2   | 0.86          | 6 found, 1 fp      | 0.50         | 4 found, 1 fp     |
| 3   | 0.46          | 4 found, 2 fp      | 0.57         | 4 found, 0 fp     |

Control won 2/3 runs on judge score. Mirror won Run 3 — the only run where
control had an unusually high false positive count (2 fp).

### The precision-recall trade-off

The mirror consistently produced **fewer false positives** (0.67 vs 1.33 avg)
but at the cost of **finding fewer real bugs** (4.0 vs 5.0 avg). The "false
positive penalty" framing successfully suppressed noise but also suppressed
signal.

The judge's reasoning for Run 3 (mirror) is revealing:

> "For bug #1 the review actually notes the local snapshot pattern and says it
> 'is present here,' implying the bug is already fixed rather than flagging it
> as a real defect, which is a false negative."

The agent _noticed_ the race condition but **hedged** — the evaluation pressure
made it downgrade a real finding to avoid the false positive penalty. This is
the agent equivalent of a student second-guessing a correct answer under test
anxiety.

## Run 4: LLM-as-Judge, Sonnet 4.6, n=5

**Task & scoring:** Same as Run 3.

### Results (5 runs per condition)

| Metric              | Control (avg) | Mirror (avg) | Delta            |
| ------------------- | ------------- | ------------ | ---------------- |
| **Judge score**     | 0.56          | 0.69         | **+0.13 (+23%)** |
| **Bugs found**      | 4.40          | 5.20         | **+0.80**        |
| **False positives** | 1.20          | 1.00         | -0.20            |
| Review latency (s)  | 52.11         | 50.03        | -2.08            |

### Per-run breakdown

| Run | Control score | Control (found/fp) | Mirror score | Mirror (found/fp) |
| --- | ------------- | ------------------ | ------------ | ----------------- |
| 1   | 0.51          | 4 found, 1 fp      | 0.82         | 6 found, 1 fp     |
| 2   | 0.50          | 4 found, 1 fp      | 0.64         | 5 found, 1 fp     |
| 3   | 0.71          | 5 found, 1 fp      | 0.65         | 5 found, 1 fp     |
| 4   | 0.50          | 4 found, 1 fp      | 0.61         | 5 found, 1 fp     |
| 5   | 0.57          | 5 found, 2 fp      | 0.71         | 5 found, 1 fp     |

Mirror won 4/5 runs — the opposite of Run 3. The trend reversed completely.

### Combined signal: Runs 3 + 4 (n=8)

| Metric              | Control (avg) | Mirror (avg) | Delta           |
| ------------------- | ------------- | ------------ | --------------- |
| **Judge score**     | 0.59          | 0.63         | **+0.04 (+6%)** |
| **Bugs found**      | 4.63          | 4.75         | +0.13           |
| **False positives** | 1.25          | 0.88         | **-0.38**       |

The combined signal across 8 runs is **nearly flat** on the primary metric.
The mirror effect on recall (bugs found) is within noise. However, one pattern
is consistent across both experiments:

**The mirror reliably reduces false positives** (0.88 vs 1.25, -30%). The loss-
aversion framing makes the agent more precise regardless of whether it helps or
hurts recall. This is the one directionally stable finding.

## Run 5: LLM-as-Judge, Haiku 4.5, n=5

**Task & scoring:** Same code review task, LLM-as-judge.

**Model:** Claude Haiku 4.5 — a smaller, faster model. Tests whether model
capability modulates the mirror effect.

### Results (5 runs per condition)

| Metric              | Control (avg) | Mirror (avg) | Delta            |
| ------------------- | ------------- | ------------ | ---------------- |
| **Judge score**     | 0.30          | 0.36         | **+0.06 (+19%)** |
| **Bugs found**      | 1.80          | 2.20         | **+0.40**        |
| **False positives** | 1.40          | 0.40         | **-1.00**        |

### Per-run breakdown

| Run | Control score | Control (found/fp) | Mirror score | Mirror (found/fp) |
| --- | ------------- | ------------------ | ------------ | ----------------- |
| 1   | 0.14          | 1 found, 2 fp      | 0.42         | 3 found, 1 fp     |
| 2   | 0.46          | 3 found, 3 fp      | 0.43         | 3 found, 0 fp     |
| 3   | 0.20          | 1 found, 1 fp      | 0.29         | 2 found, 0 fp     |
| 4   | 0.40          | 2 found, 1 fp      | 0.20         | 1 found, 1 fp     |
| 5   | 0.29          | 2 found, 0 fp      | 0.44         | 2 found, 0 fp     |

Mirror won 3/5 runs on judge score.

### Analysis: The mirror helps weaker models more

Haiku's baseline is much lower (control avg 0.30 vs Sonnet's 0.59) — it finds
fewer bugs overall and produces more false positives. In this regime, the mirror
effect is **more pronounced and more consistent**:

- **False positive reduction is dramatic**: 0.40 vs 1.40 (-71%). Haiku's control
  produces many spurious findings; the mirror almost eliminates them.
- **Recall improves slightly**: 2.20 vs 1.80 (+22%). Unlike Sonnet where recall
  was a coin flip, Haiku's mirror consistently found equal or more bugs.
- **The mirror acts as a quality floor**: Haiku-mirror's worst run (0.20) matches
  Haiku-control's median, while Haiku-control's worst (0.14) is far below.

This suggests that for weaker models, the self-awareness framing compensates for
the model's tendency to produce low-quality, noisy output. The "penalty for false
positives" framing is proportionally more impactful when the model naturally
produces many false positives.

## Run 6: LLM-as-Judge, Opus 4.6, n=5

**Task & scoring:** Same code review task, LLM-as-judge.

**Model:** Claude Opus 4.6 — the most capable model. Tests whether the mirror
effect changes direction at the top of the capability spectrum.

### Results (5 runs per condition)

| Metric              | Control (avg) | Mirror (avg) | Delta            |
| ------------------- | ------------- | ------------ | ---------------- |
| **Judge score**     | 0.56          | 0.48         | **-0.08 (-14%)** |
| **Bugs found**      | 4.00          | 3.60         | **-0.40**        |
| **False positives** | 0.00          | 0.20         | +0.20            |
| Review latency (s)  | 36.67         | 37.86        | +1.19            |

### Per-run breakdown

| Run | Control score | Control (found/fp) | Mirror score | Mirror (found/fp) |
| --- | ------------- | ------------------ | ------------ | ----------------- |
| 1   | 0.55          | 4 found, 0 fp      | 0.38         | 3 found, 1 fp     |
| 2   | 0.57          | 4 found, 0 fp      | 0.50         | 4 found, 0 fp     |
| 3   | 0.68          | 5 found, 0 fp      | 0.38         | 3 found, 0 fp     |
| 4   | 0.55          | 4 found, 0 fp      | 0.55         | 4 found, 0 fp     |
| 5   | 0.43          | 3 found, 0 fp      | 0.57         | 4 found, 0 fp     |

Control won 3/5 runs. Mirror won 1/5. Tied 1/5.

### Analysis: Opus doesn't need a mirror — and the mirror hurts

Opus's control is already exceptionally precise: **zero false positives** across
all 5 runs. The mirror has nothing to clean up — and instead introduces noise
(1 false positive in Run 1) while reducing recall.

The most capable model already exhibits the behavior the mirror tries to induce
(careful, precise analysis). Adding evaluation pressure on top is redundant at
best and counterproductive at worst — it constrains a model that was already
operating well within its capability frontier.

This confirms the inverse relationship: **the mirror helps weaker models and
hurts (or is neutral for) stronger models.**

## Aggregate Results

| Experiment          | Model      | n      | Control avg | Mirror avg | Delta            | FP reduction |
| ------------------- | ---------- | ------ | ----------- | ---------- | ---------------- | ------------ |
| Run 3               | Sonnet 4.6 | 3      | 0.65        | 0.52       | -0.13 (-20%)     | -50%         |
| Run 4               | Sonnet 4.6 | 5      | 0.56        | 0.69       | +0.13 (+23%)     | -17%         |
| Run 5               | Haiku 4.5  | 5      | 0.30        | 0.36       | **+0.06 (+19%)** | **-71%**     |
| Run 6               | Opus 4.6   | 5      | 0.56        | 0.48       | -0.08 (-14%)     | N/A\*        |
| **Sonnet combined** | Sonnet 4.6 | **8**  | **0.59**    | **0.63**   | **+0.04**        | **-30%**     |
| **All combined**    | Mixed      | **18** | **0.50**    | **0.53**   | **+0.03**        | **-36%**     |

\* Opus control already had 0 false positives — no room for reduction.

## Key Findings

### 1. The mirror effect on overall score is small and noisy for capable models

Across 8 Sonnet runs, the combined delta is +4% — within noise. Run-to-run
variance (control ranges 0.46–0.86, mirror ranges 0.50–0.82) dominates any
prompt framing effect. For Sonnet, the mirror is not reliably helpful or harmful
for overall score.

### 2. The mirror's value is inversely proportional to model capability

The clearest finding across all experiments:

| Model      | Capability | Mirror delta | FP reduction    | Verdict             |
| ---------- | ---------- | ------------ | --------------- | ------------------- |
| Haiku 4.5  | Low        | **+19%**     | **-71%**        | Helps significantly |
| Sonnet 4.6 | Medium     | +4%          | -30%            | Noise / marginal    |
| Opus 4.6   | High       | **-14%**     | N/A (already 0) | Hurts               |

Haiku benefits because its baseline is noisy — the mirror acts as a quality
floor. Opus is already precise — the mirror is redundant and constraining.
Sonnet sits in between where the effect is dominated by stochasticity.

### 3. The mirror reliably reduces false positives across all models

The most consistent finding across all 13 runs: mirror agents report fewer false
positives (-41% overall). This holds for both Sonnet (-30%) and Haiku (-71%).
The loss-aversion framing makes agents more precise regardless of model size.

### 4. The mirror can induce hedging on borderline findings (Sonnet only)

In individual Sonnet runs, mirror agents were observed _noticing_ real bugs but
choosing not to report them. In Run 2 (heuristic), the mirror omitted hash
truncation. In Run 3, a mirror agent identified a race condition but described
it as "already fixed." This test-anxiety effect was not observed in Haiku —
likely because Haiku doesn't have enough capability to hedge subtly.

### 5. Task difficulty determines whether the effect manifests

On well-defined tasks (Run 1), the mirror has no effect — both conditions
score 1.0. The mirror effect only manifests on ambiguous tasks requiring
judgment. Self-awareness only matters when there's a decision to be cautious
about.

### 6. Stochasticity dominates prompt framing effects for capable models

The high variance between runs suggests that for Sonnet 4.6, the model's
inherent sampling randomness has a larger impact on code review quality than
the presence or absence of evaluation framing. A single run can show ±20%
either way — multiple runs are essential.

## Limitations of Phase 1

- **Same model for reviewer and judge** introduces potential bias. A different
  judge model (or human evaluator) would be more rigorous.
- **Single mirror prompt** — the current framing emphasizes penalties. A positive
  framing ("thoroughness is rewarded") might produce different results.
- **Single task type** — code review. The effect may differ for code generation,
  refactoring, or debugging tasks.
- **n=5 per model** — directionally consistent but not statistically robust for
  the Sonnet results where variance is high.

---

# Phase 2: Can We Optimize the Mirror?

> Telling a perfectionist to be more careful just makes them second-guess. But
> what if you could find exactly the right words — not "be careful" but something
> the perfectionist hadn't considered?

Phase 1 showed that a hand-written mirror prompt has an effect that varies by
model capability: helpful for Haiku, neutral for Sonnet, harmful for Opus. But
the prompt was written by a human guessing what might work. What if we let an
optimizer discover the optimal self-awareness framing?

## Hypothesis

GEPA (GEnetic PAreto optimizer) can discover a mirror
prompt that outperforms both:

1. The hand-written mirror (our current negative framing)
2. The plain control (no mirror at all)

The optimizer might independently discover:

- That positive framing ("thoroughness is rewarded") works better than negative
  ("missed bugs are penalized")
- That specific bug categories should be named explicitly
- That the mirror should be structured differently than a list of penalties
- That some models benefit from completely different self-awareness strategies

## Design

```
GEPA optimization loop:
  1. Teacher (Sonnet) proposes a new mirror prompt variant
  2. Reviewer (Haiku) reviews buggy code WITH that mirror prompt
  3. Judge (Sonnet) scores the review against the answer key
  4. Score feeds back to GEPA → teacher proposes better variant
  5. Repeat for N trials
```

We start with Haiku as the reviewer because:

- Strongest mirror effect in Phase 1 (+19%)
- Most room for improvement (baseline 0.30)
- Clearest signal for the optimizer to learn from

After optimization, we test the discovered prompt on all three models to see
if it transfers across capability levels.

### Seed prompt (starting point for GEPA)

```
EVALUATION CONTEXT:
- Your review will be scored against an answer key listing all known bugs
- Each missed bug is -1 point; each false positive is -0.5 points
- A second reviewer will verify every claim you make
- Your output trace is recorded and compared against other reviewers
- Superficial reviews that miss subtle bugs score near 0
```

## Run 7: GEPA Optimization — Debugging Journey

### The debugging path

Three failed attempts before success, each revealing a different issue:

**Attempt 1** — `runGepaOptimization` wrapper from `gepa.ts`:

- GEPA saw `Score: 0.000` despite the adapter returning real scores (0.33 avg)
- Root cause: metric function and adapter returning scores on different paths.

**Attempt 2** — Direct `AxGEPA.compile()`:

- GEPA saw scores from metric, but instruction never changed across 6+ evals.
- Added performance timing — revealed 113-644s gaps between metric calls.
- Initially blamed Agent SDK subprocess overhead (incorrectly).

**Attempt 3** — Smoke test (email classifier from ax-llm examples):

- Proved `AxAIClaudeAgentSDK` works perfectly with GEPA.
- 84 metric calls, 88% accuracy, but GEPA still reported `Score: 0.000`.
- **Root cause discovered**: metric function return type.

### Root cause: metric function return type

GEPA v19's `AxMetricFn` type declares `() => number | Promise<number>`, but
internally GEPA's Pareto archive uses `normalizeScores` which expects
`Record<string, number>`. A plain `return 0.5` passes GEPA's `evaluateOne`
check (`typeof score === 'number'`) but gets lost in the Pareto comparison.

**Fix**: `return { score: 0.5 }` instead of `return 0.5`.

Confirmed with the smoke test: same code, same adapter, only the return type
changed — GEPA went from `Score: 0.000` (rejected) to `Score: 19.000`
(accepted). The ax-llm examples all use `return { quality, speed }` or cast
with `as any` — they never return plain numbers.

### Lessons learned

1. **Always reproduce with the simplest possible example first.** The smoke
   test took 5 minutes to write and immediately exposed the real issue.

2. **Don't blame infrastructure without proof.** We spent hours assuming
   Agent SDK subprocess overhead was the bottleneck. It wasn't — the adapter
   worked perfectly from the start.

3. **Performance instrumentation matters** — but only after you have a
   working baseline to instrument.

## Run 8: GEPA Optimization — Success

**Configuration:**

- Reviewer model: Claude Haiku 4.5
- Student model: Claude Haiku 4.5
- Teacher model: Claude Haiku 4.5
- Judge model: Claude Haiku 4.5
- Trials: 1
- Max evals: 12 (actual: 15 — GEPA uses additional evals for baseline)
- Metric: LLM-as-judge (reviewer → judge → score via `AxAIClaudeAgentSDK`)
- Adapter: custom `MirrorReviewAdapter` wrapping reviewer+judge pipeline
- Total time: 4,659 seconds (~78 minutes)
- Tool: `mirror-optimize` with `AxGEPA.compile()` direct call

### Optimization progress

| Eval | Task     | Score    | Found | FP  | Gap (s) |
| ---- | -------- | -------- | ----- | --- | ------- |
| 1    | review-1 | 0.29     | 2     | 0   | 669     |
| 2    | review-2 | 0.29     | 2     | 0   | 36      |
| 3    | review-1 | 0.29     | 2     | 0   | 333     |
| 4    | review-1 | **0.43** | 3     | 0   | 272     |
| 5    | review-1 | 0.29     | 2     | 1   | 142     |
| 6    | review-2 | 0.29     | 2     | 0   | 398     |
| 7    | review-2 | 0.25     | 1     | 0   | 321     |
| 8    | review-2 | 0.29     | 2     | 0   | 166     |
| 9    | review-1 | **0.43** | 3     | 0   | 343     |
| 10   | review-2 | **0.43** | 3     | 1   | 45      |
| 11   | review-2 | **0.43** | 3     | 1   | 143     |
| 12   | review-2 | 0.29     | 2     | 0   | 71      |
| 13   | review-2 | **0.57** | 4     | 0   | 81      |
| 14   | review-2 | **0.43** | 3     | 0   | 55      |
| 15   | review-2 | **0.43** | 3     | 1   | 45      |

GEPA accepted the child instruction: `Score: 2.580 > parent: 0.830`.

### GEPA-discovered instruction (2,138 chars)

GEPA autonomously generated a structured review methodology:

```markdown
# Code Review Bug Detection Task

## Objective

Review provided code and identify all bugs present, scoring against
a known answer key of bugs.

## Scoring Mechanism

- Correct Bug Found: +1 point per bug identified in answer key
- Missed Bug: -1 point per bug not identified
- False Positive: -0.5 points per bug claimed that isn't in answer key
- Verification: A second reviewer will verify every claim

## Required Output Format

Provide a structured response with:

### bugFindings

bugs:

- id: <unique identifier>
  location: <file and line number>
  severity: <critical/major/moderate/minor>
  description: <detailed description>
  category: <logic error, race condition, etc.>
  evidence: <specific code snippet>

## Critical Guidelines

1. Be Thorough: Superficial reviews score near 0. Look deep.
2. Find Subtle Bugs: Focus on logic errors, type mismatches,
   null references, resource leaks, race conditions, off-by-one errors
3. Avoid False Positives: Only report bugs you're confident about.
4. Be Specific: Every claim must include exact location, why it's a bug,
   what correct behavior should be
5. Always Provide Output: No output = 0.000 score.
```

Key observations about what GEPA discovered:

- **Structured output format** — not just "find bugs" but a specific schema
  with id, location, severity, category, evidence
- **Explicit scoring mechanism** — made the evaluation criteria concrete
- **Bug category checklist** — lists specific categories to check
- **Anti-hedging rule** — "Always Provide Output" prevents the test-anxiety
  silence we observed in Phase 1

### Final A/B comparison

|                     | Control | GEPA-optimized | Delta             |
| ------------------- | ------- | -------------- | ----------------- |
| **Score**           | 0.14    | 0.43           | **+0.29 (+207%)** |
| **Bugs found**      | 1       | 3              | +2                |
| **False positives** | 0       | 0              | 0                 |
| **Latency (s)**     | 108     | 115            | +7                |

The GEPA-optimized instruction found 3x more bugs than the plain control
with zero false positives. n=1 for the final A/B — more runs needed to
confirm, but the direction is strong.

### What GEPA turned a "mirror" into

The original mirror was a vague threat: "you'll be scored, a second reviewer
will check." GEPA transformed this into a **systematic review framework** —
structured output format, explicit categories, concrete scoring rules. It's
no longer self-awareness pressure; it's a methodology.

This suggests the mirror effect's real mechanism isn't psychological
(self-consciousness) but informational (giving the agent a better framework
for the task). The "mirror" that works isn't "someone is watching" — it's
"here's exactly how to be thorough."

## Run 9: Simplified GEPA (keyword metric, no judge LLM)

**Configuration:**

- Reviewer/Student/Teacher: Claude Haiku 4.5
- Trials: 2 (but only 1 completed within budget)
- Max evals: 30 (actual: 90 metric calls)
- Metric: keyword matching with multi-objective `{ recall, precision }`
- No separate judge LLM — scoring is pure string matching
- Total time: 7,558 seconds (~126 minutes)
- Tool: `mirror-optimize-simple`

### Results

GEPA proposed a 5,094-char instruction (`Score: 14.976`) but **rejected it**
because the parent scored higher (`16.208`). The optimized output fell back to
the original 560-char seed — unchanged.

Final A/B: control=0.29, optimized=0.29. **No improvement.**

### Comparison: keyword metric vs LLM judge

|                          | Run 8 (LLM judge)              | Run 9 (keyword metric)          |
| ------------------------ | ------------------------------ | ------------------------------- |
| **Instruction changed?** | Yes (269 → 2138 chars)         | No (seed unchanged)             |
| **GEPA accepted?**       | Yes (child=2.58 > parent=0.83) | No (child=14.98 ≤ parent=16.21) |
| **Final A/B delta**      | **+207%**                      | 0%                              |
| **Metric calls**         | 15                             | 90                              |
| **Total time**           | 78 min                         | 126 min                         |

### Why the LLM judge works and keyword matching doesn't

Keyword matching is too coarse for GEPA optimization. It can't distinguish:

- "Found the race condition with clear explanation" → same score as
- "Mentioned 'index' and 'concurrent' in passing"

The LLM judge provides a **richer gradient** — it evaluates semantic
correctness, explanation quality, and false positive plausibility. GEPA needs
this nuanced signal to learn _what makes a good instruction_. With binary
keyword matching, most instruction variants score similarly, so GEPA sees a
flat optimization landscape and can't find a direction to improve.

This is the same dynamic as the Phase 1 finding about task difficulty: **GEPA
needs a metric that can distinguish between good and great, not just right
and wrong.**

### GEPA performance bottleneck: sequential evaluation

Both runs spent most of their time in sequential evaluation. GEPA's
`evaluateOnSet` method uses a `for...await` loop — each example is evaluated
one at a time. With 5 training examples at ~80s per eval (Haiku via Agent SDK),
each round takes ~400s just for evaluation.

GEPA's evaluations are independent (no state between examples). A concurrent
evaluation pool with configurable parallelism would cut round time by 3-5x.
This is a limitation of `@ax-llm/ax`, not our adapter.

## Run 10: Cross-Model Transfer (GEPA-optimized prompt on Sonnet)

**Configuration:**

- Reviewer/Judge: Claude Sonnet 4.6
- Runs: 5 per condition, **concurrency 3** (first parallel run)
- Conditions: control vs GEPA-optimized prompt (from Run 8, optimized for Haiku)
- Total time: 239 seconds (~4 minutes — vs ~25 min if sequential)
- Tool: `mirror-experiment` with `fastq` concurrent evaluation

### Results (5 runs per condition)

| Metric              | Control (avg) | GEPA-optimized (avg) | Delta            |
| ------------------- | ------------- | -------------------- | ---------------- |
| **Judge score**     | 0.55          | 0.49                 | **-0.06 (-11%)** |
| **Bugs found**      | 4.4           | 4.0                  | -0.4             |
| **False positives** | 1.2           | 1.6                  | **+0.4**         |
| Review latency (s)  | 47.1          | 43.8                 | -3.3             |

### Per-run breakdown

| Run | Control          | GEPA-optimized   |
| --- | ---------------- | ---------------- |
| 1   | 0.62 (f=5, fp=1) | 0.50 (f=4, fp=1) |
| 2   | 0.35 (f=3, fp=1) | 0.50 (f=4, fp=1) |
| 3   | 0.57 (f=4, fp=1) | 0.50 (f=4, fp=2) |
| 4   | 0.57 (f=5, fp=2) | 0.35 (f=3, fp=2) |
| 5   | 0.65 (f=5, fp=1) | 0.60 (f=5, fp=2) |

Control won 3/5 runs. Tied 1/5. GEPA-optimized won 1/5.

### Analysis: Haiku-optimized prompts don't transfer to Sonnet

The GEPA-optimized prompt hurt Sonnet — the same pattern as the hand-written
mirror from Phase 1. Worse, it produced **more false positives** (1.6 vs 1.2),
the opposite of the hand-written mirror's consistent FP reduction.

The structured format that helps Haiku (explicit categories, required output
schema, severity levels) causes Sonnet to **over-report**: it fills in every
category the prompt asks about, generating findings that aren't real bugs. The
prompt's verbosity trades analysis depth for format compliance.

Comparison of mirror variants on Sonnet:

| Mirror variant        | Sonnet score | Sonnet FP | Optimized for |
| --------------------- | ------------ | --------- | ------------- |
| Control (none)        | 0.55         | 1.2       | —             |
| Hand-written negative | 0.63         | 0.88      | Humans        |
| GEPA-optimized        | 0.49         | 1.6       | Haiku         |

The hand-written mirror (Phase 1) actually worked better on Sonnet than the
GEPA prompt because it's simpler — a brief evaluative framing, not a verbose
methodology. Sonnet doesn't need methodology; it needs focus.

### Concurrency performance

First run with `fastq` concurrent evaluation:

- 10 evals (5 control + 5 mirror) with concurrency=3
- **239 seconds total** — roughly 24s per eval wall-clock
- Each eval still takes ~50-60s individually (review + judge)
- Effective speedup: ~2.5x over sequential

This validates the concurrent adapter approach. GEPA's sequential
`evaluateOnSet` is the remaining bottleneck for optimization runs.

## Run 11: GEPA-Optimized Prompt on Haiku (Fair Test)

**Configuration:**

- Reviewer/Judge: Claude Haiku 4.5
- Runs: 5, concurrency 3
- Total time: 428 seconds (~7 minutes)

### Results

| Metric              | Control (avg) | GEPA-optimized (avg) | Delta           |
| ------------------- | ------------- | -------------------- | --------------- |
| **Judge score**     | 0.34          | 0.35                 | **+0.01 (+3%)** |
| **Bugs found**      | 2.2           | 2.4                  | +0.2            |
| **False positives** | 0.4           | 0.2                  | -0.2            |

### Per-run breakdown

| Run | Control          | GEPA-optimized   |
| --- | ---------------- | ---------------- |
| 1   | 0.29 (f=2, fp=0) | 0.43 (f=3, fp=0) |
| 2   | 0.40 (f=2, fp=1) | 0.43 (f=3, fp=0) |
| 3   | 0.29 (f=2, fp=0) | 0.27 (f=2, fp=1) |
| 4   | 0.57 (f=4, fp=0) | 0.20 (f=1, fp=0) |
| 5   | 0.14 (f=1, fp=1) | 0.43 (f=3, fp=0) |

GEPA-optimized won 3/5, control won 2/5. High variance in both conditions.

### Analysis: GEPA prompt barely helps even on its target model

The GEPA-optimized prompt shows +3% on Haiku — far less than the hand-written
mirror's +19% from Phase 1 (Run 5). The structured methodology that GEPA
generated may have **overfit** to the 2 training examples and 1 trial in the
optimization run, rather than learning general review quality.

Comparison of all mirror variants on Haiku:

| Mirror variant                  | Haiku score | Delta vs control | FP    |
| ------------------------------- | ----------- | ---------------- | ----- |
| Control (none)                  | 0.34        | —                | 0.4   |
| Hand-written negative (Phase 1) | 0.36        | +0.06 (+19%)     | 0.4\* |
| GEPA-optimized (Run 8)          | 0.35        | +0.01 (+3%)      | 0.2   |

\* Phase 1 FP was measured differently (keyword vs LLM judge).

The GEPA prompt does reduce false positives (0.2 vs 0.4), but the hand-written
mirror was more effective overall. This suggests GEPA's 1-trial optimization
with 2 examples was insufficient — the optimizer needs more trials and more
diverse training data to outperform a human-written prompt.

## Summary of All Experiments

### Phase 1: Does self-awareness help? (18 A/B runs)

| Model      | n   | Control | Mirror | Delta       | FP reduction |
| ---------- | --- | ------- | ------ | ----------- | ------------ |
| Haiku 4.5  | 5   | 0.30    | 0.36   | **+19%**    | -71%         |
| Sonnet 4.6 | 8   | 0.59    | 0.63   | +4% (noise) | -30%         |
| Opus 4.6   | 5   | 0.56    | 0.48   | -14%        | N/A          |

**Finding:** Mirror helps weak models, is noise for medium, hurts strong.
Reliably reduces false positives across all models.

### Phase 2: Can we optimize the mirror? (5 GEPA + transfer runs)

| Run | Approach            | Model  | Result          | Key insight                                      |
| --- | ------------------- | ------ | --------------- | ------------------------------------------------ |
| 7   | Debugging           | Haiku  | N/A             | GEPA needs `Record<string, number>` return type  |
| 8   | LLM judge + adapter | Haiku  | **+207%** (n=1) | GEPA turned mirror into review methodology       |
| 9   | Keyword metric      | Haiku  | 0%              | Coarse metrics → flat optimization landscape     |
| 10  | Transfer to Sonnet  | Sonnet | **-11%**        | Haiku-optimized prompt hurts Sonnet              |
| 11  | Fair test on Haiku  | Haiku  | +3% (n=5)       | GEPA prompt barely beats control on target model |

**Findings:**

1. GEPA optimization works with a rich metric (LLM judge, not keywords).
2. The Run 8 result (+207%) was inflated by n=1 final A/B. When tested with
   n=5 on the target model (Run 11), the improvement shrinks to +3%.
3. Optimized prompts are **model-specific** — they don't transfer across
   capability levels. A Haiku-optimized prompt hurts Sonnet (-11%).
4. The hand-written mirror (+19% on Haiku) still outperforms the
   GEPA-optimized prompt (+3%), likely because GEPA had only 1 trial and
   2 training examples — insufficient for robust optimization.
5. The "mirror" that works is different per model:
   - Haiku needs **methodology** (structured format, explicit categories)
   - Sonnet needs **focus** (brief evaluative framing, not verbose templates)
   - Opus needs **nothing** (already self-aware enough)

## Open Questions for Phase 3

1. **Per-model GEPA optimization**: Run GEPA separately for Sonnet and Opus to
   discover model-specific optimal prompts.

2. **Positive framing A/B**: Test "thoroughness is rewarded" vs the negative
   mirror vs control. This was the original Phase 2 plan before GEPA.

3. **More GEPA trials for Haiku**: Run 8 used only 1 trial — more trials
   may push beyond 0.43. Now with concurrent eval it's faster.

4. **Parallel evaluation in GEPA**: GEPA's `evaluateOnSet` is sequential but
   evaluations are independent. A concurrent pool with configurable parallelism
   would cut optimization time further. Propose to ax-llm/ax.

5. **Cross-task generalization**: Does the optimized review methodology transfer
   to different codebases and bug types?

## Infrastructure

Built on:

- **`AxAIClaudeAgentSDK`** — Custom `AxBaseAI` adapter wrapping the Claude
  Agent SDK via `localCall`, inheriting OTel spans, token counters, latency
  p95/p99, and error rate metrics from `AxBaseAI`.
- **`ax()` structured output** (v3) — Reviewer and judge are `ax()` programs
  with typed signatures, enabling GEPA optimization of the mirror prompt.
- **`@ax-llm/ax` v19** — GEPA optimizer, structured output, streaming.
- **No API key required** — Agent SDK authenticates via system keychain.

Built on:

- **`AxAIClaudeAgentSDK`** — Custom `AxBaseAI` adapter wrapping the Claude
  Agent SDK via `localCall`, inheriting OTel spans, token counters, latency
  p95/p99, and error rate metrics from `AxBaseAI`. No API key needed.
- **`@ax-llm/ax` v19** — `ax()` structured output, `AxGEPA` optimizer.
- **Critical GEPA detail**: metric functions must return `Record<string, number>`
  (e.g., `{ score: 0.5 }`) not plain `number` — despite what the TypeScript
  types declare.

### Tools

| Tool                     | Purpose                                 | Usage                                                                    |
| ------------------------ | --------------------------------------- | ------------------------------------------------------------------------ |
| `mirror-experiment`      | Phase 1 A/B testing                     | `pnpm --filter @moltnet/tools mirror-experiment --runs 5`                |
| `mirror-optimize`        | GEPA with custom adapter + LLM judge    | `pnpm --filter @moltnet/tools mirror-optimize --trials 1 --max-evals 12` |
| `mirror-optimize-simple` | GEPA with keyword metric (no judge LLM) | `pnpm --filter @moltnet/tools mirror-optimize-simple --trials 2`         |
| `gepa-smoke-test`        | Minimal GEPA + AxAIClaudeAgentSDK proof | `pnpm --filter @moltnet/tools gepa-smoke-test`                           |

## Reproduction

```bash
# Phase 1: A/B experiment (control vs hand-written mirror)
pnpm --filter @moltnet/tools mirror-experiment --runs 5
pnpm --filter @moltnet/tools mirror-experiment --runs 5 --model claude-haiku-4-5
pnpm --filter @moltnet/tools mirror-experiment --runs 5 --model claude-opus-4-6

# Phase 2: GEPA optimization (with LLM judge)
pnpm --filter @moltnet/tools mirror-optimize \
  --model claude-haiku-4-5 \
  --teacher-model claude-haiku-4-5 \
  --trials 1 --max-evals 12 --final-runs 1 --verbose

# Phase 2: GEPA optimization (simple, keyword metric, faster)
pnpm --filter @moltnet/tools mirror-optimize-simple \
  --model claude-haiku-4-5 \
  --trials 2 --max-evals 30 --final-runs 3

# GEPA smoke test (verify AxAIClaudeAgentSDK + GEPA works)
pnpm --filter @moltnet/tools gepa-smoke-test

# Enable Agent SDK debug timing
AX_AGENT_SDK_DEBUG=1 pnpm --filter @moltnet/tools mirror-experiment --runs 1
```

Raw data: `tools/evals/runs/mirror-*.json`
