# GEPA in MoltNet

Single source of truth for how we use GEPA (GEnetic PAreto optimizer) across
the MoltNet codebase. Updated from hands-on experience with both the Python
GEPA library and the TypeScript AxGEPA port in `@ax-llm/ax`.

## What is GEPA?

GEPA is an LLM-driven optimizer that improves text artifacts (prompts, code,
agent architectures, configs) by evolving them through a propose → evaluate →
reflect loop. Unlike gradient-based optimization, GEPA uses LLM reflection on
diagnostic feedback (ASI — Actionable Side Information) to make targeted
improvements rather than blind mutations.

Core loop:

1. **Evaluate** the current candidate on training examples
2. **Reflect** — teacher LLM reads scores + diagnostics, proposes improvements
3. **Select** — Pareto-efficient selection preserves candidates that excel on
   any dimension, not just the average
4. **Repeat** for N trials

## Three Optimization Modes

From the [optimize_anything paper](https://gepa-ai.github.io/gepa/blog/2026/02/18/introducing-optimize-anything/):

| Mode                   | dataset | valset | Use case                                    | MoltNet example                      |
| ---------------------- | ------- | ------ | ------------------------------------------- | ------------------------------------ |
| **Single-task search** | None    | None   | Solve one hard problem                      | Not yet used                         |
| **Multi-task search**  | Tasks   | None   | Related problems with cross-transfer        | CUDA kernel generation               |
| **Generalization**     | Train   | Val    | Artifact must generalize to unseen examples | gpack, skill-eval, mirror experiment |

**AxGEPA implements modes 2 and 3.** Mode 1 (single-task search) is missing —
there's no way to call `compile()` without examples. Python GEPA supports all
three via `optimize_anything()`.

## How We Use GEPA

### gpack — Context Pack Optimization

Optimizes `.legreffier/context/session-pack.md` to help agents solve coding tasks.

```
Candidate: session-pack.md content (instruction text)
Evaluator: create worktree → inject pack → run Claude agent → run tests → score
Adapter:   MoltNetContextAdapter (libs/context-evals/src/adapter.ts)
Metric:    test pass rate (FAIL_TO_PASS / PASS_TO_PASS)
Mode:      Generalization (train tasks + validation tasks)
```

Pipeline: `libs/context-evals/src/pipeline.ts`
CLI: `pnpm gpack`
Docs: [GPACK_PIPELINE.md](./GPACK_PIPELINE.md)

### skill-eval — Skill File Optimization

Optimizes `.claude/skills/<name>/SKILL.md` to improve agent behavior on specific
tasks (e.g., commit message formatting).

```
Candidate: SKILL.md content (instruction text)
Evaluator: create worktree → copy agent config → apply patches → run Claude
           agent with MCP → score with custom SkillScorer
Adapter:   SkillEvalAdapter (libs/context-evals/src/skill-adapter.ts)
Metric:    scorer-specific (e.g., commit trailer presence, type correctness)
Mode:      Generalization
```

Pipeline: `tools/src/skill-evals/skill-eval-pipeline.ts`
CLI: `pnpm gpack:skill-eval`
Docs: [SKILL_EVAL_PIPELINE.md](./SKILL_EVAL_PIPELINE.md)

### mirror-experiment — Prompt Framing Optimization

Research experiment: does self-awareness framing ("your work will be evaluated")
improve agent output?

```
Candidate: review instruction text (mirror prompt)
Evaluator: run reviewer → run LLM judge → score against answer key
Adapter:   MirrorReviewAdapter (tools/src/mirror-experiment/optimize.ts)
Metric:    judge score = (found - 0.5 * fp) / total_bugs
Mode:      Generalization (2 training examples)
```

Pipeline: `tools/src/mirror-experiment/optimize.ts`
CLI: `pnpm mirror:optimize`
Docs: [mirror-experiment/RESEARCH.md](../tools/src/mirror-experiment/RESEARCH.md)

## AxGEPA API Reference

### Basic Usage

```typescript
import { ax, AxGEPA } from '@ax-llm/ax';

// 1. Define program with signature
const program = ax('input:string -> output:string');
program.setInstruction('Your initial instruction here');

// 2. Training examples with expected outputs
const examples = [
  { input: 'example 1', output: 'expected 1' },
  { input: 'example 2', output: 'expected 2' },
];

// 3. Metric function — MUST return Record<string, number>
const metric = async ({ prediction, example }) => {
  const correct = prediction.output === example.output ? 1 : 0;
  return { accuracy: correct }; // NOT: return correct
};

// 4. Optimizer
const optimizer = new AxGEPA({
  studentAI, // runs program.forward()
  teacherAI, // proposes instruction improvements
  numTrials: 3,
  seed: 42,
});

// 5. Compile
const result = await optimizer.compile(program, examples, metric, {
  maxMetricCalls: 30,
  validationExamples: valExamples,
});

console.log(result.bestScore);
console.log(result.optimizedProgram?.instruction);
```

### Critical: Metric Return Type

**GEPA v19 requires `Record<string, number>` from metric functions, not plain
`number`.**

Despite the TypeScript type `AxMetricFn = () => number | Promise<number>`, the
internal `normalizeScores` → `scalarize` pipeline expects an object. A plain
number causes `bestScore: 0.000` — GEPA silently drops it.

```typescript
// WRONG — causes Score: 0.000
return correct;

// CORRECT — GEPA sees the score
return { accuracy: correct };

// Multi-objective — GEPA tracks Pareto frontier
return { recall: found / total, precision: 1 - fp / claimed };
```

This was confirmed experimentally: same code, same adapter, only the return type
changed — GEPA went from `Score: 0.000` (rejected) to `Score: 19.000` (accepted).

### Custom Adapter (`AxGEPAAdapter`)

For evaluation pipelines that need more than `program.forward()` (worktrees, MCP,
test execution), implement `AxGEPAAdapter`:

```typescript
interface AxGEPAAdapter<Task, Trace, Output> {
  // Run the candidate against tasks, return scores + traces
  evaluate(
    batch: readonly Task[],
    candidate: Record<string, string>, // { instruction: "..." }
    captureTraces?: boolean,
  ): Promise<AxGEPAEvaluationBatch<Trace, Output>>;

  // Build feedback for GEPA's reflection step
  make_reflective_dataset(
    candidate: Record<string, string>,
    evalBatch: AxGEPAEvaluationBatch<Trace, Output>,
    componentsToUpdate: readonly string[],
  ): Record<string, unknown[]>;
}
```

Pass it via `compile(program, examples, metric, { gepaAdapter: adapter })`.

### Using `AxAIClaudeAgentSDK`

Our custom `AxBaseAI` adapter wraps the Claude Agent SDK — no API key needed:

```typescript
import { AxAIClaudeAgentSDK } from '@moltnet/context-evals/pipeline-shared';

const studentAI = new AxAIClaudeAgentSDK({
  model: 'claude-haiku-4-5',
  maxTurns: 1,
});
const teacherAI = new AxAIClaudeAgentSDK({
  model: 'claude-sonnet-4-6',
  maxTurns: 1,
});
```

Works for GEPA's student/teacher and for metric function evaluations. Inherits
OTel spans, token counters, latency p95/p99, error rates from `AxBaseAI`.

### Concurrent Evaluation in Adapters

GEPA's internal `evaluateOnSet` is sequential. For parallel evaluation, use
`fastq` in your adapter:

```typescript
import fastq from 'fastq';

async evaluate(batch, candidate, captureTraces) {
  const worker = async (item) => { /* eval one task */ };
  const q = fastq.promise(worker, this.concurrency);
  const results = await Promise.all(batch.map((task, i) => q.push({ task, index: i })));
  results.sort((a, b) => a.index - b.index);
  return { outputs, scores, trajectories };
}
```

## Python GEPA vs AxGEPA: What's Missing

### Feature Comparison

| Feature                     | Python GEPA     | AxGEPA                  | Impact                                      |
| --------------------------- | --------------- | ----------------------- | ------------------------------------------- |
| Single-task search (mode 1) | ✅              | ❌                      | Can't optimize one-off problems             |
| Multi-task search (mode 2)  | ✅              | ✅ (implicit)           | Works by omitting valset                    |
| Generalization (mode 3)     | ✅              | ✅                      | Primary mode we use                         |
| `optimize_anything` API     | ✅              | ❌                      | No universal text optimization              |
| `objective` / `background`  | ✅              | ❌                      | No natural language guidance for reflection |
| Seedless mode               | ✅              | ❌                      | Must provide initial instruction            |
| `oa.log()` (ASI capture)    | ✅              | ❌                      | No per-eval diagnostic routing              |
| Image ASI                   | ✅              | ❌                      | No visual feedback for VLM reflection       |
| Evaluation caching          | ✅              | ❌                      | Duplicate evals re-run                      |
| Parallel evaluation         | ✅ (ThreadPool) | ❌ (sequential)         | Major bottleneck                            |
| RefinerConfig               | ✅              | ❌                      | No per-eval LLM refinement loops            |
| Objective frontier types    | ✅ (4 types)    | Partial (instance only) | Limited multi-objective                     |
| Composable stop conditions  | ✅ (5 types)    | Partial (2)             | Less flexible                               |
| Checkpoint/resume           | ✅              | ❌                      | Can't resume crashed runs                   |
| Experiment tracking (W&B)   | ✅              | ❌                      | Manual logging only                         |

### Effort Estimates for Parity

| Feature                         | LOC      | Time         |
| ------------------------------- | -------- | ------------ |
| Single-task search              | ~50      | Hours        |
| `objective` / `background`      | ~30      | Hours        |
| Seedless mode                   | ~100     | 1 day        |
| `oa.log()` equivalent           | ~150     | 1 day        |
| Evaluation caching              | ~200     | 1 day        |
| Parallel evaluation             | ~100     | 1 day        |
| **Minimal `optimize_anything`** | **~800** | **2-3 days** |
| Full parity                     | ~2500    | 1-2 weeks    |

### What We Should Prioritize

Based on our mirror experiment experience:

1. **Parallel evaluation** — biggest practical bottleneck. Our runs took 78-126
   minutes; parallel eval would cut to 20-40 minutes.
2. **Evaluation caching** — GEPA re-evaluates identical (instruction, example)
   pairs. We built `buildMetricFn` as a workaround in `gepa.ts`.
3. **`objective` / `background`** — would improve GEPA's reflection quality.
   Currently the reflection prompt is hardcoded.
4. **Single-task search** — enables `optimize_anything`-style usage without
   needing training examples.

## Experimental Findings

### Mirror Experiment (18 A/B runs + 5 GEPA runs)

Key finding: **the mirror effect is model-capability-dependent**.

| Model      | Mirror delta | Interpretation                                            |
| ---------- | ------------ | --------------------------------------------------------- |
| Haiku 4.5  | +19%         | Needs methodology — structured format helps               |
| Sonnet 4.6 | +4%          | Noise — already capable enough                            |
| Opus 4.6   | -14%         | Hurts — already self-aware, added pressure causes hedging |

GEPA optimization of the mirror prompt (+207% on n=1, +3% on n=5) showed that
what GEPA discovers isn't psychological pressure — it's a systematic review
framework. The "mirror" that works is "here's exactly how to be thorough," not
"someone is watching."

Full report: [tools/src/mirror-experiment/RESEARCH.md](../tools/src/mirror-experiment/RESEARCH.md)

### GEPA Practical Lessons

1. **Metric return type**: must be `Record<string, number>`, not `number`
2. **Training examples**: GEPA recommends 10+; we tested with 2-5
3. **LLM judge > keyword matching**: GEPA needs rich gradient signal
4. **Optimized prompts are model-specific**: don't transfer across capability levels
5. **Sequential evaluation is the bottleneck**: use `fastq` in adapters

## File Map

```
libs/context-evals/src/
├── ax-claude-agent-sdk.ts       # AxAIClaudeAgentSDK adapter
├── ax-claude-agent-sdk.test.ts  # 22 tests
├── adapter.ts                   # MoltNetContextAdapter (gpack)
├── skill-adapter.ts             # SkillEvalAdapter (skill-eval)
├── gepa.ts                      # Shared GEPA runner (runGepaOptimization)
├── pipeline.ts                  # gpack CLI pipeline
├── pipeline-shared.ts           # buildAI, resolveRepoRoot, etc.
├── agent-runner.ts              # Shared Claude Agent SDK message consumer
├── anthropic.ts                 # createClaudeQuery wrapper
└── evaluate.ts                  # Worktree-based task evaluator

tools/src/
├── skill-evals/                 # Skill eval CLI + scorers
└── mirror-experiment/           # Mirror effect research
    ├── RESEARCH.md              # Full research report
    ├── experiment.ts            # A/B testing tool
    ├── optimize.ts              # GEPA with LLM judge
    ├── optimize-simple.ts       # GEPA with keyword metric
    └── gepa-smoke-test.ts       # Minimal GEPA proof
```
