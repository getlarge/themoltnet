# GEPA, Ax, and Multi-Objective Signals in `libs/context-evals`

**Date**: 2026-03-22
**Status**: Research note
**Scope**: `libs/context-evals` GEPA runner, custom GEPA adapters, Ax GEPA contract, upstream GEPA adapter contract

## Question

Do our custom GEPA adapters in `libs/context-evals` follow the intended GEPA design, especially around reporting agent metrics back into optimization? Or are we currently missing an important multi-objective signal?

## Short Answer

Yes, we are currently missing that signal.

More precisely:

- Upstream Python GEPA supports adapter-level multi-objective reporting via `EvaluationBatch.objective_scores`.
- `@ax-llm/ax` supports multi-objective GEPA, but not through its adapter batch type.
- Our current `libs/context-evals` runner uses only a single scalar objective, `score`, even though Ax GEPA can optimize multiple objectives through `metricFn`.

So the issue is real, but it is not "student/teacher vs adapters". The issue is that our current Ax GEPA wiring collapses reward too early.

## Important Follow-Up — 2026-03-23

After fetching and reading the upstream Ax examples:

- `src/examples/gepa.ts`
- `src/examples/gepa-flow.ts`
- `src/examples/gepa-quality-vs-speed-optimization.ts`

there is a second architectural issue that matters as much as the missing
multi-objective signal:

**we may be optimizing the wrong boundary.**

The upstream examples consistently optimize either:

- an `ax(...)` program, or
- a `flow(...)` tree

with:

- local or remote student/teacher `AxAIService`s
- objective vectors produced in `metricFn`
- no custom GEPA adapter

That means our current custom-adapter-heavy design is not merely missing
objective propagation. It is also farther from Ax's intended happy path than
necessary.

## Why We Built Custom Adapters Anyway

This part is important and was under-documented.

One of the main reasons for the custom adapters was operational, not
conceptual:

- we wanted to run coding tasks locally through our own Claude/Codex agent
  runner
- we wanted local testing without paying Anthropic/OpenAI API costs on every
  iteration
- at the time, `libs/context-evals` owned the local Ax wrappers and the task
  harness, so the adapter boundary felt like the natural place to integrate
  everything

Now that the Ax wrappers can live in `libs/ax-agents`, that assumption should
be revisited. The existence of local `AxAIService` implementations changes the
trade-offs substantially.

## My Findings

### 1. Upstream GEPA expects more than a single scalar score

GEPA's adapter guide explicitly documents multi-objective optimization through `objective_scores` on `EvaluationBatch`.

Reference:

- GEPA adapter guide: https://gepa-ai.github.io/gepa/guides/adapters/

Relevant pattern from the docs:

- `scores` remains the main score list.
- `objective_scores` can include multiple normalized dimensions such as:
  - `accuracy`
  - `latency`
  - `cost`

This matches the concern that agent metrics can be part of the optimization objective, not just debugging output.

### 2. GEPA reflective datasets are not the same thing as the reward

GEPA also expects adapters to provide a reflective dataset for mutation/reflection. That dataset is built from:

- task inputs
- generated outputs
- trajectories
- feedback text
- scores

Reference:

- GEPA adapter guide: https://gepa-ai.github.io/gepa/guides/adapters/
- GEPA home/docs overview: https://gepa-ai.github.io/gepa/

In other words:

- reward/objectives drive search
- reflective datasets help the teacher explain failures and propose better prompts

These are complementary, not interchangeable.

### 3. `@ax-llm/ax` GEPA is multi-objective, but via `metricFn`, not adapter batches

The installed `@ax-llm/ax` package shows a split contract.

The Ax GEPA adapter batch type is scalar-only:

- [`index.d.ts`](/Users/edouard/Dev/getlarge/themoltnet/node_modules/.pnpm/@ax-llm+ax@19.0.13/node_modules/@ax-llm/ax/index.d.ts#L1958)

`AxGEPAEvaluationBatch` only contains:

- `outputs`
- `scores`
- `trajectories`

There is no `objective_scores` field in the Ax adapter type.

But Ax GEPA itself is implemented as multi-objective. In the extracted source from the installed sourcemap:

- `AxGEPA.compile()` is explicitly documented as "Multi-objective GEPA"
- each example is evaluated into `Promise<Record<string, number>>`
- the optimizer averages vectors and scalarizes only for candidate selection

Local references from the extracted Ax source:

- `metricFn as AxMultiMetricFn` and vector evaluation path:
  - extracted `gepa.ts` lines 261-321 from `node_modules/.pnpm/@ax-llm+ax@19.0.13/node_modules/@ax-llm/ax/index.js.map`
- corresponding public types:
  - `AxMetricFn` returns `number` at [`index.d.ts`](/Users/edouard/Dev/getlarge/themoltnet/node_modules/.pnpm/@ax-llm+ax@19.0.13/node_modules/@ax-llm/ax/index.d.ts#L2032)
  - `AxMultiMetricFn` returns `Record<string, number>` at [`index.d.ts`](/Users/edouard/Dev/getlarge/themoltnet/node_modules/.pnpm/@ax-llm+ax@19.0.13/node_modules/@ax-llm/ax/index.d.ts#L2037)

Conclusion:

- Python GEPA: multi-objective can flow through adapter `EvaluationBatch.objective_scores`
- Ax GEPA: multi-objective flows through `metricFn`

### 4. Our current `libs/context-evals` runner is effectively single-objective

Our GEPA runner currently returns only one objective to Ax GEPA:

- [`libs/context-evals/src/gepa.ts`](/Users/edouard/Dev/getlarge/themoltnet/libs/context-evals/src/gepa.ts#L203)
- [`libs/context-evals/src/gepa.ts`](/Users/edouard/Dev/getlarge/themoltnet/libs/context-evals/src/gepa.ts#L253)

The current `metricFn` returns:

```ts
return { score: evalResult.score } as unknown as number;
```

That means:

- task score is the only optimization signal
- agent metrics are not part of Pareto optimization
- rich traces can inform reflection, but not frontier construction

### 5. Our adapters already have useful agent metrics, but they are not promoted into objectives

The skill adapter captures several useful execution signals:

- `turnCount`
- `durationMs`
- `costUsd`
- `toolCallCount`
- `toolSummaries`

Reference:

- [`libs/context-evals/src/skill-adapter.ts`](/Users/edouard/Dev/getlarge/themoltnet/libs/context-evals/src/skill-adapter.ts#L156)

The context-pack adapter has less agent telemetry, but it does capture task execution traces, failed tests, regressions, and eval summaries:

- [`libs/context-evals/src/adapter.ts`](/Users/edouard/Dev/getlarge/themoltnet/libs/context-evals/src/adapter.ts#L137)

So the missing piece is not raw data collection. The missing piece is objective construction and propagation.

### 6. Our reflective datasets are reasonable, but they are not objective channels

Our reflective dataset builders are here:

- context packs: [`libs/context-evals/src/adapter.ts`](/Users/edouard/Dev/getlarge/themoltnet/libs/context-evals/src/adapter.ts#L137)
- skills: [`libs/context-evals/src/skill-adapter.ts`](/Users/edouard/Dev/getlarge/themoltnet/libs/context-evals/src/skill-adapter.ts#L208)

These functions produce structured examples for reflection with fields like:

- `Inputs`
- `Generated Outputs`
- `Feedback`

This is the right shape for teacher-side mutation, but it does not replace multi-objective reward reporting.

### 7. Student and teacher should not replace adapters

Our current pipeline correctly treats student and teacher models as optimization actors:

- `studentAI`: task-side program execution target / optimization runtime
- `teacherAI`: reflection / proposal model

Reference:

- [`libs/context-evals/src/pipeline.ts`](/Users/edouard/Dev/getlarge/themoltnet/libs/context-evals/src/pipeline.ts#L517)

This should remain true. The adapters are still the right abstraction for:

- running the actual system under test
- collecting trajectories
- constructing reflection evidence

The fix is not to replace adapters with student/teacher. The fix is to let the metric path expose multiple objectives.

### 8. But adapters should probably stop being the default

This is the nuance missing from the earlier version of this note.

For flow-shaped systems, the upstream examples suggest we should try the default
GEPA path first:

- optimize an `ax(...)` program or `flow(...)`
- use local `@moltnet/ax-agents` student/teacher services if API-free local
  testing is required
- evaluate real behavior in `metricFn`

Custom adapters still make sense when the optimized object is a true external
artifact, such as:

- a compiled markdown context pack
- a whole static `SKILL.md`
- another blob that is injected into a worktree but is not naturally an Ax node
  instruction

So the real split is not "adapters vs student/teacher". It is:

- **Flow mode** for Ax-native optimization targets
- **Artifact mode** for external text targets

## My Interpretation

The current architecture is partially aligned with GEPA:

- good: explicit task evaluation
- good: reflective datasets with actionable traces
- good: teacher/student split
- missing: multi-objective reward propagation
- likely overbuilt: custom adapter usage as the default integration point

The result is that our GEPA loops can learn from "why" through reflection, but still optimize only one axis numerically.

If we care about agent behavior quality, cost, latency, or tool discipline,
those dimensions need to enter the Ax `metricFn` as named objectives.

And if the thing we are optimizing can be expressed as an Ax program or flow,
we should strongly prefer that route before adding more adapter logic.

## My Suggestions

### 1. Extend `evaluateOne()` to return objective vectors

Instead of only:

```ts
{
  (score, trace);
}
```

return something like:

```ts
{
  score,
  objectives: {
    task_success: score,
    latency_efficiency: ...,
    cost_efficiency: ...,
    turn_efficiency: ...,
    tool_efficiency: ...,
  },
  trace,
}
```

This should be the main change in [`libs/context-evals/src/gepa.ts`](/Users/edouard/Dev/getlarge/themoltnet/libs/context-evals/src/gepa.ts).

### 2. Change `metricFn` to return the full objective map

Today we hardcode:

```ts
{
  score: evalResult.score;
}
```

Instead, return a proper multi-objective record, for example:

```ts
{
  task_success: evalResult.score,
  latency_efficiency,
  cost_efficiency,
  turn_efficiency,
  tool_efficiency,
}
```

This is how Ax GEPA will preserve Pareto tradeoffs.

### 3. Keep one scalar summary for logs and baseline comparisons

Even with multi-objective optimization, it is still useful to maintain one scalar summary for:

- quick CLI output
- regression thresholds
- simple before/after comparisons

But that scalar should be a reporting convenience, not the only optimization signal.

### 4. Enrich reflective datasets with the same dimensions in plain language

For the teacher model, include feedback such as:

- "Correct output, but took 19 turns"
- "Correct output, but cost was 3x higher than comparable runs"
- "Reached answer with unnecessary tool churn"

This keeps the teacher's textual reasoning aligned with the actual Pareto objectives.

### 5. Start with the skill adapter

`SkillEvalAdapter` already has the richest agent telemetry, so it is the cleanest first target.

Initial objective set:

- `task_success`
- `latency_efficiency`
- `cost_efficiency`
- `turn_efficiency`
- `tool_efficiency`

Each should be normalized to `0..1`, with higher always better.

### 6. Add explicit policy for objective weighting and scalarization

Ax GEPA can scalarize objective vectors for selection. We should define a deliberate policy rather than relying on default averaging forever.

Useful options:

- simple equal-weight average for first pass
- task-success-first scalarizer
- configurable `paretoMetricKey` or custom scalarizer by eval family

### 7. Run explicit viability experiments

Before building more adapter complexity, run these experiments:

#### Skills

1. Single-instruction `ax(...)` program optimized with default `AxGEPA`
2. Small `flow(...)`-based skill decomposition optimized with `AxGEPAFlow`
3. Same experiments using local `@moltnet/ax-agents` as student/teacher

#### Context packs

1. Flow-based pack selection/composition policy optimized with default GEPA
2. Static compiled pack artifact optimized with a thin adapter
3. Hybrid approach where GEPA tunes retrieval/selection instructions but not
   the final markdown blob

## My Proposed Next Step

Implement a backward-compatible extension to `libs/context-evals`:

1. Add optional multi-objective fields to local evaluation result types.
2. Populate them in `SkillEvalAdapter` from existing trace data.
3. Update `runGepaOptimization()` so `metricFn` returns the full objective map when present.
4. Preserve current scalar behavior when no objectives are supplied.
5. Add tests proving Ax GEPA receives and preserves multi-objective records.

## References

### Upstream GEPA

- GEPA docs home: https://gepa-ai.github.io/gepa/
- GEPA adapter guide: https://gepa-ai.github.io/gepa/guides/adapters/
- GEPA DefaultAdapter API: https://gepa-ai.github.io/gepa/api/adapters/DefaultAdapter/
- GEPA MCPAdapter API: https://gepa-ai.github.io/gepa/api/adapters/MCPAdapter/
- GEPA repository:
  - Default adapter path: https://github.com/gepa-ai/gepa/blob/main/src/gepa/adapters/default_adapter/default_adapter.py
  - MCP adapter path: https://github.com/gepa-ai/gepa/blob/main/src/gepa/adapters/mcp_adapter/mcp_adapter.py

### Ax

- Ax GEPA adapter/evaluation types:
  - [`node_modules/.pnpm/@ax-llm+ax@19.0.13/node_modules/@ax-llm/ax/index.d.ts`](/Users/edouard/Dev/getlarge/themoltnet/node_modules/.pnpm/@ax-llm+ax@19.0.13/node_modules/@ax-llm/ax/index.d.ts#L1958)
  - [`node_modules/.pnpm/@ax-llm+ax@19.0.13/node_modules/@ax-llm/ax/index.d.ts`](/Users/edouard/Dev/getlarge/themoltnet/node_modules/.pnpm/@ax-llm+ax@19.0.13/node_modules/@ax-llm/ax/index.d.ts#L2032)
- Ax GEPA implementation examined via installed sourcemap:
  - `node_modules/.pnpm/@ax-llm+ax@19.0.13/node_modules/@ax-llm/ax/index.js.map`

### Local code

- GEPA runner:
  - [`libs/context-evals/src/gepa.ts`](/Users/edouard/Dev/getlarge/themoltnet/libs/context-evals/src/gepa.ts#L125)
- Context pack adapter:
  - [`libs/context-evals/src/adapter.ts`](/Users/edouard/Dev/getlarge/themoltnet/libs/context-evals/src/adapter.ts#L33)
- Skill adapter:
  - [`libs/context-evals/src/skill-adapter.ts`](/Users/edouard/Dev/getlarge/themoltnet/libs/context-evals/src/skill-adapter.ts#L28)
- Agent runner:
  - [`libs/context-evals/src/agent-runner.ts`](/Users/edouard/Dev/getlarge/themoltnet/libs/context-evals/src/agent-runner.ts)
- Pipeline student/teacher wiring:
  - [`libs/context-evals/src/pipeline.ts`](/Users/edouard/Dev/getlarge/themoltnet/libs/context-evals/src/pipeline.ts#L517)

---

## Research Angle 2: Student/Teacher/Adapter Misalignment

**Date**: 2026-03-22
**Trigger**: Deeper reading of the ax-llm GEPA `compile()` source and comparison with upstream Python GEPA adapters

### Context

The GEPA article describes a system where agents' execution metrics and reasoning traces drive reflective optimization. This raised a question: do our custom adapters actually feed agent behavior back into the optimization loop the way GEPA intends?

### Findings

#### 1. In standard GEPA (with or without adapter), the student IS the agent being evaluated

In the upstream Python GEPA `DefaultAdapter`:

```python
# The student LLM runs the task directly
responses = self._lm.batch_complete(litellm_requests, ...)
# Then the evaluator scores the student's output
eval_result = self.evaluator(data, assistant_response)
```

Same for `MCPAdapter` — the `task_model` IS the student. It receives the candidate instruction as a system prompt, executes the task (including MCP tool calls), and its outputs are scored and reflected upon.

In the ax-llm default path (no adapter), `AxGEPA.compile()` does:

```typescript
prediction = await program.forward(this.studentAI, example);
scores = await normalizeScores(prediction, example);
```

The student runs the task, the teacher reflects on `{input, prediction, score}` tuples from the student's actual outputs.

Reference: [`gepa.ts` lines 429-467](https://github.com/ax-llm/ax/blob/main/src/ax/dsp/optimizers/gepa.ts#L429)

#### 2. Our adapters decouple the student from the evaluated agent

In our setup:

- The `ax()` program (`'task_id:string -> evalScore:number'`) is a dummy scaffold
- `program.forward(studentAI, example)` produces a meaningless `evalScore` prediction
- The actual evaluation happens in `metricFn` → `evaluateOne()` → `runAgentTask()` (Claude Code subprocess)
- The student's prediction is ignored by `metricFn` in `gepa.ts:208-213`

This means the student LLM is pure wasted compute — it runs on every evaluation in `evalBatch()` (line 435 of ax-llm's gepa.ts) producing predictions that nobody consumes.

#### 3. The reflection path falls back to garbage when `propose_new_texts` is missing

When an adapter is present, ax-llm's GEPA compile loop (lines 805-850) does:

```typescript
if (adapter) {
  // 1. Run adapter evaluation (real Claude Code agent)
  const evalParent = await adapter.evaluate(mini, cfg, true);
  adapterParentSum = evalParent.scores.reduce(...);

  // 2. Build reflective dataset from real traces
  const reflDs = adapter.make_reflective_dataset(cfg, evalParent, [target.id]);

  // 3. Try adapter's own proposal — WE DON'T IMPLEMENT THIS
  const proposedMap = await adapter.propose_new_texts?.(cfg, reflDs, [target.id]);
  newInstruction = proposedMap?.[target.id];  // → undefined
}

// 4. Since propose_new_texts returned nothing, fall back to default reflection
if (!newInstruction) {
  newInstruction = await this.reflectTargetInstruction(
    target.id, currentInstruction, program, applyConfig, cfg,
    mini, metricFn, options,
    parentTuples  // ← tuples with dummy student predictions!
  );
}
```

The `parentTuples` passed to `reflectTargetInstruction` are:

```typescript
const parentTuples = parentMiniEval.rows.map((row) => ({
  input: row.input,
  prediction: row.prediction, // ← dummy ax() program output via studentAI
  score: row.scalar, // ← real score from metricFn (runs Claude Code)
}));
```

So the teacher reflects on tuples where:

- **score** = real (comes from our `metricFn` which runs the actual Claude Code agent)
- **prediction** = garbage (comes from the dummy `ax('task_id:string -> evalScore:number')` forwarded through studentAI)

The teacher sees something like `{input: {task_id: "fix-bug-123"}, prediction: {evalScore: 0.3}, score: 0.75}`. The prediction is meaningless.

Reference: [`gepa.ts` lines 799-849](https://github.com/ax-llm/ax/blob/main/src/ax/dsp/optimizers/gepa.ts#L799)

#### 4. The adapter's reflective dataset is built but discarded

Both our adapters implement `make_reflective_dataset()` with structured feedback from real agent traces:

- Failed test outputs, setup failures, eval summaries (gpack adapter)
- Scorer feedback with diary entry verification results (skill adapter)

But since `propose_new_texts` is undefined, this reflective dataset is never used for instruction proposal. The fallback `reflectTargetInstruction()` builds its own feedback from the dummy student tuples instead.

#### 5. The adapter's `evaluate()` is called but only for acceptance gating

When an adapter is present, ax-llm uses the adapter's scores as an **additional acceptance gate** (lines 900-904):

```typescript
const accepted =
  childMiniEval.sum > parentMiniEval.sum + threshold &&
  (adapterParentSum === undefined ||
    adapterChildSum === undefined ||
    adapterChildSum > adapterParentSum + threshold);
```

This means the adapter evaluation runs twice per iteration (parent + child) purely for gating, not for reflection. The actual scoring for Pareto construction comes from `evalBatch()` which uses `program.forward(studentAI, ...)` + `metricFn`.

#### 6. Summary of waste in current setup

| Component                             | Intended role                                           | Our current usage                                               | Waste level                                                 |
| ------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------- |
| **studentAI**                         | Execute tasks, produce predictions teacher reflects on  | Runs dummy `ax()` scaffold, predictions ignored                 | 100% wasted                                                 |
| **teacherAI**                         | Reflect on student outputs, propose better instructions | Reflects on garbage predictions paired with real scores         | Partially wasted (real scores help, but no agent reasoning) |
| **adapter.evaluate()**                | Run real evaluation                                     | Runs Claude Code correctly, but only used for acceptance gating | Useful but underutilized                                    |
| **adapter.make_reflective_dataset()** | Build structured feedback for teacher                   | Builds good feedback from real traces, then discarded           | 100% wasted                                                 |
| **adapter.propose_new_texts()**       | Let adapter drive instruction proposal with rich traces | Not implemented                                                 | Missing entirely                                            |

### Comparison with upstream contracts

#### Python GEPA `GEPAAdapter` protocol

```python
class GEPAAdapter(Protocol[DataInst, Trajectory, RolloutOutput]):
    def evaluate(self, batch, candidate, capture_traces=False) -> EvaluationBatch: ...
    def make_reflective_dataset(self, candidate, eval_batch, components_to_update) -> Mapping: ...
    propose_new_texts: ProposalFn | None = None
```

`propose_new_texts` is explicitly documented as: "allows the user to implement their own instruction proposal logic. For example, the user can use a different LLM, implement DSPy signatures, etc."

Source: https://github.com/gepa-ai/gepa/blob/main/src/gepa/core/adapter.py

#### Ax-llm `AxGEPAAdapter` interface

```typescript
interface AxGEPAAdapter<Datum, Traj, Out> {
  evaluate(
    batch,
    candidate,
    captureTraces?,
  ): Promise<AxGEPAEvaluationBatch<Traj, Out>>;
  make_reflective_dataset(
    candidate,
    evalBatch,
    componentsToUpdate,
  ): Record<string, any[]>;
  propose_new_texts?: (
    candidate,
    reflectiveDataset,
    componentsToUpdate,
  ) => Promise<Record<string, string>> | Record<string, string>;
}
```

The `propose_new_texts` hook exists in both. Neither adapter currently implements it. This is the primary integration gap.

### Suggestions

#### 1. Implement `propose_new_texts` on both adapters

This is the most impactful fix. When implemented, ax-llm GEPA will use the adapter's proposal instead of falling back to the dummy-student reflection path.

The implementation should:

- Accept the reflective dataset (already built from real traces by `make_reflective_dataset`)
- Use the teacherAI (or a dedicated reflection model) to propose improved instructions
- Return a `Record<string, string>` mapping component IDs to new instruction text

This would make the teacher useful (reflecting on real agent behavior) and the student irrelevant (which is acceptable for opaque-agent adapters).

#### 2. Consider whether the studentAI should be eliminated or repurposed

Two options:

**Option A: No-op student** — configure the studentAI as the cheapest possible model (or a mock) since its predictions are unused. This saves compute without changing architecture.

**Option B: Student as evaluation proxy** — make the student predict expected outcomes (test pass/fail, cost range) before the real agent runs. Use prediction accuracy as a secondary signal. This adds a useful forecasting dimension but is more complex.

Option A is pragmatic and immediate. Option B is interesting but speculative.

#### 3. Enrich `make_reflective_dataset` with agent reasoning traces

Currently the reflective dataset includes test results and scores but not the agent's internal reasoning. For the gpack adapter, `toolSummaries` from `AgentRunResult` could be included. For the skill adapter, the scorer's detailed feedback is already propagated but agent-level tool call traces are not.

Even without `propose_new_texts`, enriching the reflective dataset prepares for better reflection when the proposal hook is implemented.

#### 4. Dual scoring path is redundant — consider consolidating

Currently each iteration runs both:

- `evalBatch()` → `program.forward(studentAI)` + `metricFn` (for Pareto)
- `adapter.evaluate()` (for acceptance gating)

Both paths ultimately score the same task. If `propose_new_texts` is implemented (making the adapter the primary proposal path), the dummy student path could potentially be eliminated entirely, routing all scoring through the adapter. This would require changes to how ax-llm's GEPA consumes scores, possibly via a custom `metricFn` that delegates to the adapter.

### References (additional to existing)

#### Ax-llm GEPA source (full file downloaded)

- Ax-llm GEPA optimizer: https://github.com/ax-llm/ax/blob/main/src/ax/dsp/optimizers/gepa.ts
  - Local copy: `/tmp/ax-gepa.ts` (1772 lines, downloaded 2026-03-22)
  - Key sections:
    - Adapter usage in compile loop: lines 805-867
    - Acceptance gating with adapter scores: lines 900-904
    - Fallback to `reflectTargetInstruction` when `propose_new_texts` is missing: lines 837-849
    - `parentTuples` construction with dummy predictions: lines 799-803
    - `evalBatch` runs `program.forward(studentAI)`: lines 429-467

#### Upstream GEPA adapter protocol

- Core adapter protocol: https://github.com/gepa-ai/gepa/blob/main/src/gepa/core/adapter.py
  - `EvaluationBatch` dataclass with `objective_scores` field
  - `GEPAAdapter` protocol with `propose_new_texts` hook
  - Detailed docstrings on scoring semantics and error handling contracts

#### Upstream GEPA default adapters

- Default adapter (LLM-as-student): https://github.com/gepa-ai/gepa/blob/main/src/gepa/adapters/default_adapter/default_adapter.py
  - Student LLM executes tasks directly via `batch_complete`
  - `Evaluator` protocol returns `(score, feedback, objective_scores)`
  - Reflective dataset includes student's `full_assistant_response`

- MCP adapter (tool-calling student): https://github.com/gepa-ai/gepa/blob/main/src/gepa/adapters/mcp_adapter/mcp_adapter.py
  - Two-pass workflow: tool call + answer generation
  - Trajectory captures full execution trace: tool selection, arguments, responses, model outputs
  - Per-component feedback generation (`_generate_tool_feedback`, `_generate_system_prompt_feedback`)

---

## Research Angle 3: Using ax-llm AxAgent as the Student + `propose_new_texts` Design

**Date**: 2026-03-22
**Trigger**: If the student is supposed to be the evaluated agent, could we use ax-llm's AxAgent instead of the Claude Code subprocess? And what can we learn from how GEPA adapters handle `propose_new_texts`?

### Findings

#### 1. Neither upstream GEPA adapter implements `propose_new_texts`

Neither `DefaultAdapter` nor `MCPAdapter` implements `propose_new_texts`. The hook is `None` on both. Instead, the upstream GEPA engine delegates instruction proposal to `ReflectiveMutationProposer`, which has a clear priority chain:

```python
# ReflectiveMutationProposer.propose_new_texts() — line 89-149
def propose_new_texts(self, candidate, reflective_dataset, components_to_update):
    # Priority 1: adapter.propose_new_texts (if implemented)
    if self.adapter.propose_new_texts is not None:
        return self.adapter.propose_new_texts(candidate, reflective_dataset, components_to_update), {}, {}

    # Priority 2: custom_candidate_proposer (user-supplied callable)
    if self.custom_candidate_proposer is not None:
        return self.custom_candidate_proposer(candidate, reflective_dataset, components_to_update), {}, {}

    # Priority 3: default — use reflection_lm with InstructionProposalSignature
    # Feeds the reflective dataset through a prompt template and extracts new instruction
    for name in components_to_update:
        result, prompt, raw_output = InstructionProposalSignature.run_with_metadata(
            lm=self.reflection_lm,
            input_dict={
                "current_instruction_doc": candidate[name],
                "dataset_with_feedback": reflective_dataset[name],
            },
        )
        new_texts[name] = result["new_instruction"]
```

Source: https://github.com/gepa-ai/gepa/blob/main/src/gepa/proposer/reflective_mutation/reflective_mutation.py

Key insight: in the reference GEPA, the default reflection path (priority 3) consumes the **adapter's reflective dataset** — the output of `make_reflective_dataset()`. This is different from ax-llm, where the fallback `reflectTargetInstruction()` ignores the adapter's reflective dataset and uses the dummy student's `{input, prediction, score}` tuples instead.

This means: **even without implementing `propose_new_texts`, the reference GEPA uses the adapter's feedback**. In ax-llm, it doesn't.

#### 2. The `InstructionProposalSignature` is a simple prompt template

The upstream GEPA reflection prompt is essentially:

````
I provided an assistant with the following instructions: ```<current_instruction>```
Here are examples with the assistant's responses and feedback: ```<reflective_dataset>```
Write a new instruction. Include domain-specific facts and generalizable strategies.
Provide new instructions within ``` blocks.
````

The reflective dataset is rendered as markdown with `# Example N`, `## Inputs`, `## Generated Outputs`, `## Feedback` sections. No complex DSPy signatures — just a structured prompt fed to the reflection LM.

This is almost exactly what ax-llm's `REFLECTION_PROMPT_TEMPLATE` does, except ax-llm renders `{input, prediction, score}` tuples from the dummy student rather than the adapter's reflective dataset.

Source: https://github.com/gepa-ai/gepa/blob/main/src/gepa/strategies/instruction_proposal.py

#### 3. ax-llm AxAgent has rich built-in trace capture

`AxAgent._forwardForEvaluation()` returns `AxAgentEvalPrediction` which includes:

```typescript
{
  completionType: 'final' | 'askClarification',
  output: OUT,                     // structured output fields
  guidanceLog: string,             // responder guidance history
  actionLog: string,               // full action execution log
  functionCalls: AxAgentEvalFunctionCall[],  // every tool call with args + results + errors
  toolErrors: string[],            // error summaries
  turnCount: number,               // number of actor turns
  usage: AxProgramUsage[],         // per-step token usage (promptTokens, completionTokens, totalTokens)
  recursiveTrace?: ...,            // nested agent trace tree
  recursiveStats?: ...,            // aggregated stats from recursive calls
}
```

The built-in judge metric (used with `AxAgent.optimize()`) passes all of this to an LLM judge:

```typescript
const judgeOutput = {
  completionType,
  clarification,
  finalOutput,
  actionLog,
  guidanceLog,
  functionCalls,
  toolErrors,
  turnCount,
  usage,
  recursiveTrace,
  recursiveStats,
};
```

Source: https://github.com/ax-llm/ax/blob/main/src/ax/prompts/agent/AxAgent.ts lines 2580-2616, 2620-2786

This is exactly the kind of rich trajectory data GEPA expects from the student.

#### 4. AxAgent can be the student AND is GEPA-optimizable

`AxAgent` implements `AxProgrammable` — it has `forward()`, `setInstruction()`, `getTraces()`, `getUsage()`, `namedProgramInstances()`. It's designed to be passed directly to `AxGEPA.compile()` as the program being optimized.

The AxAgent even has a built-in `optimize()` method that:

- Creates evaluation tasks (`AxAgentEvalTask`)
- Builds a judge metric from criteria
- Creates an `AxGEPA` optimizer
- Calls `optimizer.compile(program, examples, metricFn)`

Source: https://github.com/ax-llm/ax/blob/main/src/ax/prompts/agent/AxAgent.ts (constructor, optimize method, \_forwardForEvaluation)

#### 5. Why we use Claude Code subprocess instead — and why it matters

Our adapters shell out to Claude Code (`runAgentTask()` via the Agent SDK) because:

- Claude Code has file system access, shell execution, MCP server connections
- Our tasks require real git worktrees, pnpm installs, test execution
- AxAgent's tool calling is LLM-native (function calling), not subprocess-based

AxAgent can call tools, but those tools are JavaScript functions registered via `AxFunction` — they don't have the same power as Claude Code's filesystem/shell/MCP capabilities. To use AxAgent as the student, we'd need to:

- Register tool functions that wrap shell execution, file I/O, git operations
- OR use AxAgent's code execution runtime (RLM) which does support JS execution

This is not a trivial adaptation, but it's architecturally possible.

#### 6. A hybrid path: AxAgent as orchestrator with Claude Code as a tool

Instead of replacing Claude Code with AxAgent OR keeping the current opaque subprocess, a middle path:

1. Create an `AxAgent` whose tools include a `runClaudeCodeTask` function
2. The AxAgent receives the optimized instruction, decides how to approach the task, calls Claude Code as one of its tools
3. AxAgent's native trace capture records the full reasoning chain + tool call decisions
4. GEPA optimizes the AxAgent's instruction, seeing both the reasoning traces AND the Claude Code results

This preserves Claude Code's capabilities while making the student visible to GEPA's reflection loop.

### What we should take from the upstream GEPA adapters

#### Design principle: the adapter evaluates, the proposer reflects

In upstream GEPA, there's a clean separation:

- **Adapter** owns: program construction, evaluation, trajectory capture, reflective dataset building
- **Proposer** owns: candidate selection, instruction mutation, acceptance testing

The proposer always uses the adapter's reflective dataset for reflection — there's no fallback to a dummy student path. This is the critical design difference from ax-llm.

#### Design principle: trajectories carry the full execution context

Both `DefaultAdapter` and `MCPAdapter` capture the student's actual outputs in trajectories:

- `DefaultAdapter`: `full_assistant_response` + evaluator feedback
- `MCPAdapter`: `model_first_pass_output`, `tool_arguments`, `tool_response`, `model_final_output`, `system_prompt_used`

The reflective dataset is then built from these trajectories. The teacher sees what the student actually did, not what a proxy predicted.

#### Design principle: `propose_new_texts` is an escape hatch, not the primary path

No upstream adapter implements it. It exists for adapters where the standard `InstructionProposalSignature` doesn't work (e.g., coupled multi-component updates, domain-specific proposal logic). The default path through `reflection_lm` + `InstructionProposalSignature` works well when the reflective dataset is rich.

### Suggestions

#### 1. Fix the ax-llm reflection fallback to use adapter reflective dataset

The most impactful fix for our current architecture (without changing to AxAgent): implement `propose_new_texts` on our adapters so the fallback to `reflectTargetInstruction` (which uses dummy predictions) is never reached.

The implementation should:

- Accept the reflective dataset from `make_reflective_dataset()` (already rich with test failures, agent metrics)
- Use the teacherAI to generate improved instructions via a prompt similar to `InstructionProposalSignature`
- Return `Record<string, string>` mapping component IDs to new instruction text

This aligns our adapters with GEPA's intent without requiring AxAgent.

#### 2. Enrich reflective datasets with agent reasoning (immediate)

Even before implementing `propose_new_texts`, improve `make_reflective_dataset()` to include:

- `toolSummaries` from `AgentRunResult` — what the agent actually did
- `stderrOutput` — agent's internal reasoning/errors
- `costUsd`, `durationMs`, `turnCount` — efficiency signals as feedback text

This prepares the reflective dataset for higher-quality reflection once the proposal hook is wired up.

#### 3. Evaluate AxAgent as a longer-term replacement for the subprocess model

Benefits:

- Native trace capture (actionLog, functionCalls, usage, turnCount)
- Direct GEPA compatibility (implements `AxProgrammable`)
- Built-in optimization support (`AxAgent.optimize()`)
- Multi-objective metrics natively available via `getUsage()`

Challenges:

- Tool registration for filesystem/shell/git operations
- MCP server connections (AxAgent doesn't natively manage MCP sessions)
- Matching Claude Code's full capability set

This is a larger refactor but would eliminate the student/adapter impedance mismatch entirely.

#### 4. Consider the hybrid AxAgent-as-orchestrator approach

If full AxAgent adoption is too large a change, the hybrid path (AxAgent wrapping Claude Code as a tool) gives us:

- Visible reasoning traces for GEPA reflection
- Claude Code's full capabilities preserved
- Native GEPA integration without major architecture changes
- Agent-level metrics (turns, usage, tool calls) automatically captured

### References (additional)

#### GEPA reflective mutation proposer

- Source: https://github.com/gepa-ai/gepa/blob/main/src/gepa/proposer/reflective_mutation/reflective_mutation.py
  - `propose_new_texts()` priority chain: adapter → custom proposer → default reflection_lm (lines 89-149)
  - `propose()` main loop: select candidate → sample minibatch → evaluate with traces → build reflective dataset → propose new texts → evaluate child → return proposal (lines 151-402)

#### GEPA instruction proposal signature

- Source: https://github.com/gepa-ai/gepa/blob/main/src/gepa/strategies/instruction_proposal.py
  - Prompt template with `<curr_param>` and `<side_info>` placeholders
  - Markdown rendering of reflective dataset examples
  - Backtick extraction for new instructions

#### GEPA core engine

- Source: https://github.com/gepa-ai/gepa/blob/main/src/gepa/core/engine.py
  - `GEPAEngine.run()` main optimization loop (line 254)
  - Evaluator wraps `adapter.evaluate()` including `objective_scores` (lines 93-98)
  - Reflective mutation and merge proposal scheduling

#### ax-llm AxAgent

- Source: https://github.com/ax-llm/ax/blob/main/src/ax/prompts/agent/AxAgent.ts
  - `_forwardForEvaluation()` returns rich `AxAgentEvalPrediction` (lines 2620-2786)
  - Judge metric consumes actionLog, functionCalls, toolErrors, turnCount, usage (lines 2580-2616)
  - `getTraces()`, `getUsage()` on agent (lines 2188-2201)

#### ax-llm trace types

- `AxProgramTrace`: `{ trace: OUT & Partial<IN>, programId: string }` — https://github.com/ax-llm/ax/blob/main/src/ax/dsp/types.ts#L127
- `AxProgramUsage`: per-model token usage — https://github.com/ax-llm/ax/blob/main/src/ax/dsp/types.ts#L324
- `AxStepUsage`: `{ promptTokens, completionTokens, totalTokens }` — https://github.com/ax-llm/ax/blob/main/src/ax/dsp/types.ts#L31
- OTel span attributes for LLM calls — https://github.com/ax-llm/ax/blob/main/src/ax/trace/trace.ts
