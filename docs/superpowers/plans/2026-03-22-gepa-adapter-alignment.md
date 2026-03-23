# GEPA Adapter Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Revision Note — 2026-03-23

This plan is still useful, but it needs a reset in scope.

After reviewing the upstream Ax examples:

- `src/examples/gepa.ts`
- `src/examples/gepa-flow.ts`
- `src/examples/gepa-quality-vs-speed-optimization.ts`

the main conclusion is that we should **prefer the default Ax GEPA path first**
and only keep a custom adapter when the optimized object is truly an external
artifact rather than an Ax program/flow.

The original plan over-rotated toward custom adapters because we had a real
constraint: we wanted local testing through our own Claude/Codex agent runners
instead of paying Anthropic/OpenAI API costs during iteration. That constraint
was valid when `libs/context-evals` owned the local agent wrappers directly.

Now that we have `ax-agents`, the design space changes:

- student and teacher can be local `AxAIService` implementations
- multi-objective optimization can remain in `metricFn`, matching upstream Ax
- custom adapter logic should become the exception, not the default

**Updated goal:** simplify our GEPA architecture around two explicit modes:

- **Flow mode**: use upstream-style `AxGEPA` / `AxGEPAFlow` with local
  `@moltnet/ax-agents` student/teacher services and a plain `metricFn`
- **Artifact mode**: use one thin adapter only when the optimized object is
  external text (for example a compiled context pack or whole static skill file)

**Updated architecture direction:** extract all local Ax agent wrappers into
`libs/ax-agents` first, then run a viability study before expanding adapter
logic further. The central question is no longer "how do we enrich our custom
adapters?" but rather "which of our optimization targets can be expressed as an
Ax flow or program closely enough to use default GEPA?"

**Tech Stack:** `@ax-llm/ax` (AxAgent, AxGEPA, AxFunction), `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`, TypeBox, Vitest

**Tracker:** https://github.com/getlarge/themoltnet/issues/393#issuecomment-4106333180

## New Sequencing

### Phase 0: Extract `ax-agents` into its own lib

Small PR only:

- move `AxAIClaudeAgentSDK`, `AxAICodexAgentSDK`, shared helpers, and tests out
  of `libs/context-evals` into `libs/ax-agents`
- update `context-evals` and experiment tools to import from `@moltnet/ax-agents`
- do **not** redesign GEPA execution in the same PR

### Phase 1: Viability experiments against upstream-style GEPA

We need concrete cases, not more theory.

#### Skill experiments

1. **Single-program skill eval**
   - Optimize one `ax(...)` program instruction.
   - `metricFn` runs the existing worktree harness and scorer.
   - Purpose: test whether default `AxGEPA` is enough when the optimized object
     is a single instruction rather than a whole adapter.

2. **Flow-shaped skill eval**
   - Model the skill as a small `flow(...)` with 2–3 nodes, for example:
     task framing, patch strategy, commit/diary discipline.
   - Use `AxGEPAFlow` like `gepa-flow.ts`.
   - Purpose: test whether skills are better treated as a flow tree than a
     monolithic `SKILL.md`.

3. **Local student/teacher validation**
   - Run the same skill eval with `@moltnet/ax-agents` as both student and
     teacher, no Anthropic/OpenAI API keys.
   - Purpose: validate the original local-testing requirement now that the
     wrappers live outside `context-evals`.

#### Context-pack experiments

1. **Selection-policy flow**
   - Optimize a flow that decides what context to load or compose, not the final
     markdown blob itself.
   - Purpose: see whether default `AxGEPAFlow` works when the optimized object
     is a retrieval/composition policy rather than raw pack text.

2. **Static pack artifact**
   - Optimize a compiled markdown pack injected into a worktree.
   - Purpose: confirm whether this still truly needs an adapter.
   - Expected outcome: likely yes, but the adapter should be thin and generic.

3. **Hybrid pack policy**
   - Keep the pack body externally generated, but optimize the compile/query
     instructions or tag-selection instructions via default GEPA.
   - Purpose: test whether only part of the context-pack problem needs to stay
     in artifact mode.

### Phase 2: Thin adapter only if Phase 1 fails

Only after the above experiments:

- keep one generic artifact adapter for external text targets
- put multi-objective scores in `metricFn`
- keep cache ownership minimal and explicit
- avoid separate "adapter score path" and "metricFn score path" unless Ax
  forces it

---

## File Structure

### New files

- `libs/context-evals/src/noop-ai.ts` — No-op `AxAIService` mock for studentAI bypass
- `libs/context-evals/src/noop-ai.test.ts` — Tests for no-op AI
- `libs/context-evals/src/eval-cache.ts` — Shared evaluation cache consulted by both `metricFn` and `adapter.evaluate()`
- `libs/context-evals/src/eval-cache.test.ts` — Tests for eval cache
- `libs/context-evals/src/ax-agent-executor.ts` — AxAgent-based task executor with tool functions (replaces direct `runAgentTask` calls)
- `libs/context-evals/src/ax-agent-executor.test.ts` — Tests for the executor
- `libs/context-evals/src/criteria-scorer.ts` — `CriteriaItem`, `CriteriaItemSchema` (canonical location) + machine-checkable evaluation
- `libs/context-evals/src/criteria-scorer.test.ts` — Tests for criteria scorer
- `libs/context-evals/src/propose-texts.ts` — Shared `propose_new_texts` implementation used by both adapters
- `libs/context-evals/src/propose-texts.test.ts` — Tests for propose_new_texts

### Modified files

- `libs/context-evals/src/adapter.ts` — `MoltNetContextAdapter`: add `reflectionAI`, `evalAI`, `evalCache`, criteria scoring, wire `propose_new_texts`
- `libs/context-evals/src/skill-adapter.ts` — `SkillEvalAdapter`: add `reflectionAI`, `evalAI`, `evalCache`, criteria scoring, wire `propose_new_texts`
- `libs/context-evals/src/skill-types.ts` — Add `reflectionAI`, `evalAI`, `evalCache`, `criteria` to `SkillEvalAdapterOptions` and `SkillEvalTask`
- `libs/context-evals/src/evaluate.ts` — Add optional `CriteriaItem[]` to `GpackTask`, accept optional executor for the `runAgentTask()` call (not replacing the whole function)
- `libs/context-evals/src/gepa.ts` — Multi-objective `metricFn`, wire shared cache, accept noop studentAI
- `libs/context-evals/src/pipeline.ts` — Wire criteria, noop student, multi-objective, eval-provider
- `libs/context-evals/src/index.ts` — Export new modules (NOT pipeline-shared — noop-ai exports from index only)
- `libs/context-evals/src/gepa.test.ts` — Multi-objective tests
- `libs/context-evals/src/gepa-integration.test.ts` — Update tests for propose_new_texts + multi-objective
- `tools/src/tasksmith/types.ts` — Remove `CriteriaItem` / `CriteriaItemSchema` definitions, import from `@moltnet/context-evals` instead

---

## Task 0: ESLint boundary rule — nothing imports from tools/

**Why first:** `CriteriaItem` currently lives in `tools/src/tasksmith/types.ts` and needs to move to `libs/context-evals`. Before moving it, add an ESLint rule that prevents any workspace package (`apps/`, `libs/`, `packages/`) from importing `@moltnet/tools`. `tools/` is a leaf package — it consumes libs, nothing consumes it.

**Files:**

- Modify: ESLint config (check which format the project uses first)

- [ ] **Step 1: Check current ESLint config**

Run: `ls /Users/edouard/Dev/getlarge/themoltnet/eslint* /Users/edouard/Dev/getlarge/themoltnet/.eslint*`

- [ ] **Step 2: Add `no-restricted-imports` rule for all non-tools workspaces**

```json
{
  "overrides": [
    {
      "files": ["apps/**/*.ts", "libs/**/*.ts", "packages/**/*.ts"],
      "rules": {
        "no-restricted-imports": [
          "error",
          {
            "patterns": [
              {
                "group": ["@moltnet/tools", "@moltnet/tools/*"],
                "message": "tools/ is a leaf package — nothing else may import from it. Move shared types to a lib."
              }
            ]
          }
        ]
      }
    }
  ]
}
```

- [ ] **Step 3: Verify lint passes (no current violations)**

Run: `pnpm run lint`

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: add ESLint boundary — nothing imports from tools/"
```

---

## Task 1: No-op AxAIService for studentAI bypass

**Why:** Zero-risk foundation. Every subsequent task benefits from not needing `--student-provider`.

**Files:**

- Create: `libs/context-evals/src/noop-ai.ts`
- Create: `libs/context-evals/src/noop-ai.test.ts`
- Modify: `libs/context-evals/src/pipeline-shared.ts`
- Modify: `libs/context-evals/src/index.ts`

- [ ] **Step 1: Write failing test for noop AI**

```typescript
// libs/context-evals/src/noop-ai.test.ts
import type { AxAIService } from '@ax-llm/ax';
import { describe, expect, it } from 'vitest';

import { buildNoopAI } from './noop-ai.js';

describe('buildNoopAI', () => {
  it('returns an AxAIService', () => {
    const ai = buildNoopAI();
    expect(ai.getName()).toBe('noop');
    expect(ai.getId()).toBe('noop');
  });

  it('chat returns empty content with zero tokens', async () => {
    const ai = buildNoopAI();
    const result = await ai.chat({
      chatPrompt: [{ role: 'user', content: 'hello' }],
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].content).toBe('{}');
    expect(result.modelUsage?.tokens.totalTokens).toBe(0);
  });

  it('getFeatures reports no capabilities', () => {
    const ai = buildNoopAI();
    const features = ai.getFeatures();
    expect(features.functions).toBe(false);
    expect(features.streaming).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @moltnet/context-evals vitest run src/noop-ai.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement noop AI**

```typescript
// libs/context-evals/src/noop-ai.ts
import type { AxAIService, AxModelInfo } from '@ax-llm/ax';

const NOOP_MODEL_INFO: AxModelInfo[] = [
  {
    name: 'noop',
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1M: 0,
    completionTokenCostPer1M: 0,
  },
];

/**
 * No-op AxAIService that returns instantly with zero cost.
 *
 * Used as the studentAI when an adapter is configured — ax-llm's
 * evalBatch() unconditionally calls program.forward(studentAI) but
 * our metricFn ignores the prediction. This avoids wasting real LLM
 * calls on a dummy scaffold program.
 */
export function buildNoopAI(): AxAIService {
  return {
    getId: () => 'noop',
    getName: () => 'noop',
    getFeatures: () => ({ functions: false, streaming: false }),
    getModelList: () => [],
    getMetrics: () => ({
      latency: {
        chat: { mean: 0, p95: 0, p99: 0, samples: [] },
        embed: { mean: 0, p95: 0, p99: 0, samples: [] },
      },
      errors: {
        chat: { count: 0, rate: 0, total: 0 },
        embed: { count: 0, rate: 0, total: 0 },
      },
    }),
    getLogger: () => () => {},
    getLastUsedChatModel: () => 'noop',
    getLastUsedEmbedModel: () => undefined,
    getLastUsedModelConfig: () => ({}),
    getOptions: () => ({}),
    setOptions: () => {},
    getModelInfo: () => NOOP_MODEL_INFO,
    embed: async () => ({ embeddings: [] }),
    chat: async () => ({
      results: [{ content: '{}', finishReason: 'stop' as const, index: 0 }],
      modelUsage: {
        ai: 'noop',
        model: 'noop',
        tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      },
    }),
  } as unknown as AxAIService;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @moltnet/context-evals vitest run src/noop-ai.test.ts`
Expected: PASS

- [ ] **Step 5: Export from pipeline-shared and index**

Add `export { buildNoopAI } from './noop-ai.js';` to `pipeline-shared.ts` and `index.ts`.

- [ ] **Step 6: Commit**

```bash
git add libs/context-evals/src/noop-ai.ts libs/context-evals/src/noop-ai.test.ts libs/context-evals/src/pipeline-shared.ts libs/context-evals/src/index.ts
git commit -m "feat(context-evals): add no-op AxAIService for studentAI bypass"
```

---

## Task 2: Shared evaluation cache

**Why:** Eliminates redundant Claude Code agent runs when both `evalBatch()` and `adapter.evaluate()` score the same (taskId, instruction) pair.

**Files:**

- Create: `libs/context-evals/src/eval-cache.ts`
- Create: `libs/context-evals/src/eval-cache.test.ts`
- Modify: `libs/context-evals/src/gepa.ts` — wire cache into metricFn
- Modify: `libs/context-evals/src/index.ts`

- [ ] **Step 1: Write failing tests for eval cache**

```typescript
// libs/context-evals/src/eval-cache.test.ts
import { describe, expect, it } from 'vitest';

import { EvalCache } from './eval-cache.js';

describe('EvalCache', () => {
  it('returns undefined on cache miss', () => {
    const cache = new EvalCache();
    expect(cache.get('task-1', 'instruction-a')).toBeUndefined();
  });

  it('returns cached result on hit', () => {
    const cache = new EvalCache();
    const result = { score: 0.8, trace: { taskId: 'task-1' } };
    cache.set('task-1', 'instruction-a', result);
    expect(cache.get('task-1', 'instruction-a')).toBe(result);
  });

  it('does not collide across different instructions', () => {
    const cache = new EvalCache();
    cache.set('task-1', 'instruction-a', { score: 0.5 });
    cache.set('task-1', 'instruction-b', { score: 0.9 });
    expect(cache.get('task-1', 'instruction-a')?.score).toBe(0.5);
    expect(cache.get('task-1', 'instruction-b')?.score).toBe(0.9);
  });

  it('does not collide across different task IDs', () => {
    const cache = new EvalCache();
    cache.set('task-a', 'same', { score: 0.3 });
    cache.set('task-b', 'same', { score: 0.7 });
    expect(cache.get('task-a', 'same')?.score).toBe(0.3);
    expect(cache.get('task-b', 'same')?.score).toBe(0.7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @moltnet/context-evals vitest run src/eval-cache.test.ts`

- [ ] **Step 3: Implement eval cache**

```typescript
// libs/context-evals/src/eval-cache.ts
import { buildCacheKey } from './pipeline-shared.js';

export interface CachedEvalResult<TTrace = unknown> {
  score: number;
  trace?: TTrace;
}

/**
 * Content-hash cache shared between metricFn and adapter.evaluate().
 *
 * Both paths in ax-llm's GEPA compile loop evaluate the same
 * (taskId, instruction) pairs. This cache ensures the expensive
 * agent run happens at most once per unique input.
 */
export class EvalCache<TTrace = unknown> {
  private cache = new Map<string, CachedEvalResult<TTrace>>();

  get(
    taskId: string,
    instruction: string,
  ): CachedEvalResult<TTrace> | undefined {
    return this.cache.get(buildCacheKey(taskId, instruction));
  }

  set(
    taskId: string,
    instruction: string,
    result: CachedEvalResult<TTrace>,
  ): void {
    this.cache.set(buildCacheKey(taskId, instruction), result);
  }

  get size(): number {
    return this.cache.size;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @moltnet/context-evals vitest run src/eval-cache.test.ts`

- [ ] **Step 5: Wire into `gepa.ts`**

Add optional `evalCache?: EvalCache<TTrace>` to `GepaRunnerOptions`. In `runGepaOptimization`, replace the internal `buildMetricFn` cache with the shared cache when provided. The adapter will also read/write from this cache in Task 5.

- [ ] **Step 6: Commit**

```bash
git add libs/context-evals/src/eval-cache.ts libs/context-evals/src/eval-cache.test.ts libs/context-evals/src/gepa.ts libs/context-evals/src/index.ts
git commit -m "feat(context-evals): add shared evaluation cache for metricFn + adapter dedup"
```

---

## Task 3: AxAgent-based task executor

**Why:** This is the key enabler. Replaces opaque `runAgentTask()` with an AxAgent whose tool calls are observable. Both Claude and Codex SDKs work through the same `AxAIService` interface. Rich traces (actionLog, functionCalls, toolErrors, turnCount, usage) flow into both adapters' reflective datasets.

**Files:**

- Create: `libs/context-evals/src/ax-agent-executor.ts`
- Create: `libs/context-evals/src/ax-agent-executor.test.ts`

- [ ] **Step 1: Define the executor interface and result type**

```typescript
// libs/context-evals/src/ax-agent-executor.ts

import type { AxAIService, AxFunction } from '@ax-llm/ax';

/** Result from an AxAgent-based task execution with observable traces. */
export interface AgentExecutorResult {
  passed: boolean;
  output: string;
  /** AxAgent action log — full decision chain. */
  actionLog: string;
  /** Per-tool-call records. */
  functionCalls: Array<{
    name: string;
    args: Record<string, unknown>;
    result: string;
    error?: string;
  }>;
  toolErrors: string[];
  turnCount: number;
  usage: Array<{
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }>;
}

export interface AgentExecutorOptions {
  /** The AxAIService to use (Claude Agent SDK, Codex SDK, or direct API). */
  ai: AxAIService;
  /** Working directory for the task. */
  cwd: string;
  /** Task prompt. */
  prompt: string;
  /** Max agent turns. */
  maxTurns?: number;
  /** Extra tools beyond the defaults (runShellCommand, readFile, writeFile). */
  extraTools?: AxFunction[];
  /** Extra env vars for shell commands. */
  env?: Record<string, string>;
}
```

- [ ] **Step 2: Write failing tests for the executor**

Test that the executor creates tool functions, calls the AI, and returns structured results. Use a mock `AxAIService` that returns predetermined responses.

- [ ] **Step 3: Implement the executor**

Create an AxAgent (or an `ax()` program with function calling if AxAgent is too heavyweight) with tools:

- `runShellCommand(cmd, cwd)` — wraps `execFileText` / `runShellCommand`
- `readFile(path)` — wraps `fs.readFile`
- `writeFile(path, content)` — wraps `fs.writeFile`

The executor calls the agent, collects traces from function call history, and returns `AgentExecutorResult`.

**Structured output reference:** Follow the `f()` fluent API pattern from `tools/src/tasksmith/task-extractor.ts` lines 20-75. That extractor uses `f.object()`, `f.string().array()`, `f.boolean()`, `f.class()` for typed structured outputs with ax-llm. The executor's output signature should use the same approach — define the result shape via `f()` so ax-llm enforces JSON schema validation on the response.

**Integration point:** The executor replaces the `runAgentTask()` call INSIDE `evaluateTask()` (evaluate.ts line 312) and inside `SkillEvalAdapter.evaluate()` (skill-adapter.ts line 96) — NOT the entire `evaluateTask()` function. `evaluateTask()` still owns worktree creation, pack injection, setup commands, test execution, and scoring. The executor only replaces the agent subprocess step. Both `evaluateTask()` and `SkillEvalAdapter.evaluate()` should accept an optional `AgentExecutorFn` parameter that defaults to the current `runAgentTask` behavior.

**Key design decision:** If full AxAgent actor loop is too complex for initial implementation, start with `AxGen` + function calling (same observable tool traces, simpler wiring). The interface stays the same — callers don't care which Ax primitive is used internally.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @moltnet/context-evals vitest run src/ax-agent-executor.test.ts`

- [ ] **Step 5: Commit**

```bash
git add libs/context-evals/src/ax-agent-executor.ts libs/context-evals/src/ax-agent-executor.test.ts
git commit -m "feat(context-evals): add AxAgent-based task executor with observable traces"
```

---

## Task 4: Criteria-based scorer

**Why:** Enables scoring beyond binary pass/fail for both adapters. Machine-checkable criteria (`file_exists`, `pattern_present`, `type_checks`, `export_exists`) are free. `behavioral` uses an LLM judge. Both `GpackTask` and `SkillEvalTask` gain a `criteria` field.

**Important:** `CriteriaItem` and `CriteriaItemSchema` currently live in `tools/src/tasksmith/types.ts`. This task moves the canonical definition to `libs/context-evals/src/criteria-scorer.ts` and updates `tools/` to import from `@moltnet/context-evals`. Nothing may import from `@moltnet/tools` (enforced by Task 0).

**Files:**

- Create: `libs/context-evals/src/criteria-scorer.ts`
- Create: `libs/context-evals/src/criteria-scorer.test.ts`
- Modify: `libs/context-evals/src/evaluate.ts` — add `criteria?: CriteriaItem[]` to `GpackTask`
- Modify: `libs/context-evals/src/skill-types.ts` — add `criteria?: CriteriaItem[]` to `SkillEvalTask`
- Modify: `tools/src/tasksmith/types.ts` — remove `CriteriaItem` / `CriteriaItemSchema`, import from `@moltnet/context-evals`
- Modify: `tools/src/tasksmith/task-extractor.ts` — update import path
- Modify: `libs/context-evals/src/index.ts` — export `CriteriaItem`, `CriteriaItemSchema`

- [ ] **Step 1: Define criteria types (canonical location, TypeBox)**

Move from `tools/src/tasksmith/types.ts` to `libs/context-evals/src/criteria-scorer.ts`:

```typescript
// libs/context-evals/src/criteria-scorer.ts
import { type Static, Type } from '@sinclair/typebox';

export const CriteriaItemSchema = Type.Object({
  description: Type.String(),
  check_type: Type.Union([
    Type.Literal('test_passes'),
    Type.Literal('file_exists'),
    Type.Literal('export_exists'),
    Type.Literal('pattern_present'),
    Type.Literal('type_checks'),
    Type.Literal('behavioral'),
  ]),
  weight: Type.Number({ minimum: 0, maximum: 1 }),
  module: Type.Optional(Type.String()),
  symbol: Type.Optional(Type.String()),
  path: Type.Optional(Type.String()),
  pattern: Type.Optional(Type.String()),
  command: Type.Optional(Type.String()),
});

export type CriteriaItem = Static<typeof CriteriaItemSchema>;

export interface CriteriaResult {
  item: CriteriaItem;
  passed: boolean;
  score: number;
  evidence: string;
}
```

- [ ] **Step 2: Write failing tests for machine-checkable criteria**

Test each check_type: `file_exists` (file present vs absent), `pattern_present` (grep match vs no match), `type_checks` (tsc exit code), `test_passes` (command pass/fail).

- [ ] **Step 3: Implement machine-checkable criteria evaluators**

Each check_type maps to a simple shell/fs operation:

- `file_exists` → `fs.access(resolve(cwd, path))`
- `pattern_present` → `grep -r pattern cwd` exit code
- `type_checks` → `pnpm typecheck` exit code
- `export_exists` → `grep -r 'export.*symbol' module`
- `test_passes` → run command, check exit code
- `behavioral` → return `{ passed: false, score: 0, evidence: 'requires LLM judge' }` (deferred to future LLM-as-judge integration)

- [ ] **Step 4: Implement weighted composite scoring**

```typescript
export function computeCriteriaScore(results: CriteriaResult[]): number {
  const totalWeight = results.reduce((sum, r) => sum + r.item.weight, 0);
  if (totalWeight === 0) return 0;
  return (
    results.reduce((sum, r) => sum + r.score * r.item.weight, 0) / totalWeight
  );
}
```

- [ ] **Step 5: Add `criteria` to both task types**

In `evaluate.ts`, add `criteria?: CriteriaItem[]` to `GpackTask`.
In `skill-types.ts`, add `criteria?: CriteriaItem[]` to `SkillEvalTask` (via `SkillEvalTaskSchema`).

- [ ] **Step 6: Migrate tools/src/tasksmith/types.ts**

Remove `CriteriaItem` and `CriteriaItemSchema` from `tools/src/tasksmith/types.ts`. Replace with:

```typescript
export { type CriteriaItem, CriteriaItemSchema } from '@moltnet/context-evals';
```

Update `tools/src/tasksmith/task-extractor.ts` import accordingly.

- [ ] **Step 7: Run all tests across both packages**

Run: `pnpm --filter @moltnet/context-evals vitest run src/criteria-scorer.test.ts && pnpm --filter @moltnet/tools vitest run`

- [ ] **Step 8: Commit**

```bash
git add libs/context-evals/src/criteria-scorer.ts libs/context-evals/src/criteria-scorer.test.ts libs/context-evals/src/evaluate.ts libs/context-evals/src/skill-types.ts libs/context-evals/src/index.ts tools/src/tasksmith/types.ts tools/src/tasksmith/task-extractor.ts
git commit -m "feat(context-evals): add criteria-based scorer, move CriteriaItem from tools to lib"
```

---

## Task 5: Wire AxAgent executor + shared cache into both adapters

**Why:** Both adapters now use the AxAgent executor for observable eval, consult the shared cache, and produce richer traces.

**Files:**

- Modify: `libs/context-evals/src/adapter.ts`
- Modify: `libs/context-evals/src/skill-adapter.ts`
- Modify: `libs/context-evals/src/skill-types.ts`

- [ ] **Step 1: Add `evalAI`, `evalCache`, and `reflectionAI` to both adapter constructors**

Both adapters gain the same new options:

```typescript
// Shared new options for both adapters:
/** AI service for task execution (Claude/Codex SDK). When set, uses AxAgent executor. */
evalAI?: AxAIService;
/** Shared cache — also consulted by metricFn via gepa.ts. */
evalCache?: EvalCache;
/** AI service for propose_new_texts reflection. Typically the teacher model. */
reflectionAI?: AxAIService;
```

For `MoltNetContextAdapter`: add to constructor options object.
For `SkillEvalAdapter`: add to `SkillEvalAdapterOptions` in `skill-types.ts`.

- [ ] **Step 2: Update `evaluate()` on both adapters to use AxAgent executor**

When `evalAI` is set, replace the `evaluateTask()` / `runAgentTask()` call with the AxAgent executor. Map `AgentExecutorResult` to the adapter's trace type (`EvalTrace` / `SkillEvalTrace`). Check the shared cache first — if hit, skip the agent run. Write results back to cache after evaluation.

- [ ] **Step 3: Update `make_reflective_dataset()` on both adapters to include agent traces**

When traces contain `actionLog` and `functionCalls` (from AxAgent executor), include them in the reflective dataset feedback:

- Tool call summaries
- Error summaries
- Turn count, cost, duration as plain-language feedback

For `MoltNetContextAdapter`: add `toolSummaries`, `agentActionLog` to the `Feedback` field.
For `SkillEvalAdapter`: add `toolSummaries`, `turnCount`, `costUsd` to the `Feedback` field.

- [ ] **Step 4: Wire criteria scoring into both adapters' `evaluate()`**

When the task has `criteria`, run `evaluateCriteria()` after the agent task. Include `criteria_score` in the trace. The adapter's score becomes a composite: `failToPass` score + criteria score (weighted).

- [ ] **Step 5: Update existing tests**

Update `gepa-integration.test.ts` mock adapters to accept the new constructor options. Ensure backward compatibility — all new options are optional.

- [ ] **Step 6: Commit**

```bash
git add libs/context-evals/src/adapter.ts libs/context-evals/src/skill-adapter.ts libs/context-evals/src/skill-types.ts libs/context-evals/src/gepa-integration.test.ts
git commit -m "feat(context-evals): wire AxAgent executor, shared cache, criteria into both adapters"
```

---

## Task 6: Implement `propose_new_texts` (shared by both adapters)

**Why:** Unblocks the adapter's reflective dataset for GEPA instruction mutation. Without it, ax-llm falls back to reflecting on dummy student predictions.

**Files:**

- Create: `libs/context-evals/src/propose-texts.ts`
- Create: `libs/context-evals/src/propose-texts.test.ts`
- Modify: `libs/context-evals/src/adapter.ts`
- Modify: `libs/context-evals/src/skill-adapter.ts`

- [ ] **Step 1: Write failing test for shared propose_new_texts helper**

```typescript
// libs/context-evals/src/propose-texts.test.ts
import type { AxAIService } from '@ax-llm/ax';
import { describe, expect, it, vi } from 'vitest';

import { proposeNewTexts } from './propose-texts.js';

/** Mock AxAIService that returns a predetermined instruction string. */
function createMockReflectionAI(responseText: string): AxAIService {
  return {
    getId: () => 'mock-reflection',
    getName: () => 'mock-reflection',
    getFeatures: () => ({ functions: false, streaming: false }),
    getModelList: () => [],
    getMetrics: () => ({
      latency: {
        chat: { mean: 0, p95: 0, p99: 0, samples: [] },
        embed: { mean: 0, p95: 0, p99: 0, samples: [] },
      },
      errors: {
        chat: { count: 0, rate: 0, total: 0 },
        embed: { count: 0, rate: 0, total: 0 },
      },
    }),
    getLogger: () => () => {},
    getLastUsedChatModel: () => 'mock',
    getLastUsedEmbedModel: () => undefined,
    getLastUsedModelConfig: () => ({}),
    getOptions: () => ({}),
    setOptions: () => {},
    getModelInfo: () => [
      { name: 'mock', promptTokenCostPer1M: 0, completionTokenCostPer1M: 0 },
    ],
    embed: vi.fn().mockResolvedValue({ embeddings: [] }),
    chat: vi.fn().mockResolvedValue({
      results: [
        {
          content: JSON.stringify({ newInstruction: responseText }),
          finishReason: 'stop',
          index: 0,
        },
      ],
      modelUsage: {
        ai: 'mock',
        model: 'mock',
        tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      },
    }),
  } as unknown as AxAIService;
}

describe('proposeNewTexts', () => {
  it('returns empty when no reflectionAI is provided', async () => {
    const result = await proposeNewTexts({
      candidate: { instruction: 'current' },
      reflectiveDataset: { instruction: [{ Feedback: 'test failed' }] },
      componentsToUpdate: ['instruction'],
    });
    expect(result).toEqual({});
  });

  it('calls reflectionAI with formatted dataset and returns instruction', async () => {
    const mockAI = createMockReflectionAI('improved instruction text');
    const result = await proposeNewTexts({
      reflectionAI: mockAI,
      candidate: { instruction: 'current instruction' },
      reflectiveDataset: {
        instruction: [
          {
            Inputs: { task_id: 'task-1' },
            'Generated Outputs': { score: 0.5 },
            Feedback: 'Test X failed: expected Y',
          },
        ],
      },
      componentsToUpdate: ['instruction'],
    });
    expect(result['instruction']).toBe('improved instruction text');
  });

  it('skips components with empty reflective dataset', async () => {
    const mockAI = createMockReflectionAI('new text');
    const result = await proposeNewTexts({
      reflectionAI: mockAI,
      candidate: { instruction: 'current' },
      reflectiveDataset: { instruction: [] },
      componentsToUpdate: ['instruction'],
    });
    expect(result).toEqual({});
  });
});
```

- [ ] **Step 2: Implement shared `proposeNewTexts` helper**

Mirrors Python GEPA's `InstructionProposalSignature`:

```typescript
// libs/context-evals/src/propose-texts.ts
import type { AxAIService } from '@ax-llm/ax';
import { ax } from '@ax-llm/ax';

const REFLECTION_PROMPT = `I provided an assistant with the following instructions to perform a task for me.
Read the inputs carefully and identify the input format and infer detailed task description.
Read all the assistant responses and the corresponding feedback.
Identify all niche and domain specific factual information about the task and include it in the instruction.
The assistant may have utilized a generalizable strategy to solve the task, if so, include that in the instruction as well.`;

export interface ProposeNewTextsOptions {
  reflectionAI?: AxAIService;
  candidate: Readonly<Record<string, string>>;
  reflectiveDataset: Readonly<Record<string, unknown[]>>;
  componentsToUpdate: readonly string[];
}

export async function proposeNewTexts(
  options: ProposeNewTextsOptions,
): Promise<Record<string, string>> {
  const { reflectionAI, candidate, reflectiveDataset, componentsToUpdate } =
    options;
  if (!reflectionAI) return {};

  const result: Record<string, string> = {};

  for (const component of componentsToUpdate) {
    const entries = reflectiveDataset[component];
    if (!entries?.length) continue;

    const currentInstruction = candidate[component] ?? '';
    const formattedFeedback = formatReflectiveDataset(entries);

    const program = ax(
      'currentInstruction:string, feedback:string -> newInstruction:string "Improved instruction"',
    );
    program.setInstruction(REFLECTION_PROMPT);

    const out = await program.forward(reflectionAI, {
      currentInstruction,
      feedback: formattedFeedback,
    });

    const instruction = (
      out as { newInstruction?: string }
    )?.newInstruction?.trim();
    if (instruction && instruction.length > 16) {
      result[component] = instruction;
    }
  }

  return result;
}

function formatReflectiveDataset(entries: unknown[]): string {
  return entries
    .map((entry, i) => {
      const record = entry as Record<string, unknown>;
      const parts = [`# Example ${i + 1}`];
      for (const [key, value] of Object.entries(record)) {
        parts.push(`## ${key}`);
        parts.push(
          typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        );
      }
      return parts.join('\n');
    })
    .join('\n\n');
}
```

- [ ] **Step 3: Wire into `MoltNetContextAdapter.propose_new_texts`**

```typescript
async propose_new_texts(
  candidate: Readonly<Record<string, string>>,
  reflectiveDataset: Readonly<Record<string, unknown[]>>,
  componentsToUpdate: readonly string[],
): Promise<Record<string, string>> {
  return proposeNewTexts({
    reflectionAI: this.reflectionAI,
    candidate,
    reflectiveDataset,
    componentsToUpdate,
  });
}
```

- [ ] **Step 4: Wire into `SkillEvalAdapter.propose_new_texts`**

Same implementation — both adapters delegate to the shared `proposeNewTexts` helper.

- [ ] **Step 5: Run all tests**

Run: `pnpm --filter @moltnet/context-evals vitest run`

- [ ] **Step 6: Commit**

```bash
git add libs/context-evals/src/propose-texts.ts libs/context-evals/src/propose-texts.test.ts libs/context-evals/src/adapter.ts libs/context-evals/src/skill-adapter.ts
git commit -m "feat(context-evals): implement propose_new_texts on both GEPA adapters"
```

---

## Task 7: Multi-objective metricFn

**Why:** Agent telemetry + criteria scores are already captured in traces. Promoting them to Pareto objectives costs zero at evaluation time.

**Files:**

- Modify: `libs/context-evals/src/gepa.ts`
- Modify: `libs/context-evals/src/gepa.test.ts`

- [ ] **Step 1: Extend `EvalOneResult` with objectives**

```typescript
export interface EvalOneResult<TTrace> {
  score: number;
  /** Multi-objective scores. When present, metricFn returns this map instead of { score }. */
  objectives?: Record<string, number>;
  trace?: TTrace;
}
```

- [ ] **Step 2: Write failing test for multi-objective metricFn**

```typescript
it('metricFn returns full objective map when evaluateOne provides objectives', async () => {
  const result = await runGepaOptimization({
    tasks: createTasks(2),
    adapter: createMockAdapter(() => 0.8),
    seedInstruction: 'seed',
    studentAI: createMockAI(),
    numTrials: 0,
    maxMetricCalls: 4,
    buildExamples,
    evaluateOne: () =>
      Promise.resolve({
        score: 0.8,
        objectives: {
          task_success: 0.8,
          turn_efficiency: 0.6,
          cost_efficiency: 0.9,
        },
      }),
  });
  expect(result.bestScore).toBeGreaterThan(0);
  if (result.paretoFront.length > 0) {
    expect(result.paretoFront[0].scores).toHaveProperty('task_success');
  }
});
```

- [ ] **Step 3: Update `metricFn` in `runGepaOptimization`**

When `evalResult.objectives` is present, return it instead of `{ score }`:

```typescript
const objectiveMap = evalResult.objectives ?? { score: evalResult.score };
return objectiveMap as unknown as number;
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @moltnet/context-evals vitest run src/gepa.test.ts src/gepa-integration.test.ts`

- [ ] **Step 5: Commit**

```bash
git add libs/context-evals/src/gepa.ts libs/context-evals/src/gepa.test.ts
git commit -m "feat(context-evals): multi-objective metricFn for Pareto optimization"
```

---

## Task 8: Wire everything into pipeline CLI

**Why:** Make all the pieces accessible from `pnpm gpack` and `pnpm gskill` commands.

**Files:**

- Modify: `libs/context-evals/src/pipeline.ts`
- Modify: `libs/context-evals/src/pipeline-shared.ts`
- Modify: `libs/context-evals/src/index.ts`

- [ ] **Step 1: Use noop studentAI when adapter is present and no `--student-provider`**

When `--student-provider` is not specified and an adapter is configured, use `buildNoopAI()`. Log: `[gpack] using no-op student (adapter handles evaluation)`.

- [ ] **Step 2: Add `--eval-provider` flag**

Defaults to `claude-agent-sdk`. Build the eval AI service and pass it to both adapter constructors as `evalAI`.

- [ ] **Step 3: Wire `reflectionAI` for both adapters**

The `teacherAI` (already exists) doubles as the reflection AI for `propose_new_texts`. Pass it to both adapter constructors as `reflectionAI`.

- [ ] **Step 4: Wire shared `EvalCache`**

Create one `EvalCache` instance. Pass to both the adapter and `runGepaOptimization`.

- [ ] **Step 5: Wire criteria from tasksmith tasks**

When tasks have `criteria` fields, pass them through to both adapters. The adapters' `evaluateOne` uses criteria scoring alongside test scoring. Return multi-objective map when criteria are present:

```typescript
objectives: {
  test_pass_rate: ftpScore,
  regression_score: allPTPPassed ? 1.0 : 0.0,
  criteria_score: criteriaScore,  // from CriteriaItem evaluation
  turn_efficiency: normalizedTurnEfficiency,
  cost_efficiency: normalizedCostEfficiency,
}
```

- [ ] **Step 6: Run `pnpm run typecheck` and `pnpm run test`**

Verify everything compiles and all existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add libs/context-evals/src/pipeline.ts libs/context-evals/src/pipeline-shared.ts libs/context-evals/src/index.ts
git commit -m "feat(context-evals): wire noop student, eval cache, criteria, and multi-objective into pipeline"
```

---

## Task 9: Run `pnpm run validate` and fix any issues

- [ ] **Step 1: Run full validation**

```bash
pnpm run validate
```

- [ ] **Step 2: Fix any lint, typecheck, or test failures**

- [ ] **Step 3: Final commit**

```bash
git commit -m "fix(context-evals): address lint and type issues from GEPA adapter alignment"
```

---

## Dependency graph

```
Task 0 (ESLint boundary) ─────────────────────┐
                                               │
Task 1 (noop AI) ─────────────────────────────┤
Task 2 (eval cache) ──────────────────────────┤── can run in parallel (after Task 0)
Task 3 (AxAgent executor) ────────────────────┤
Task 4 (criteria scorer + CriteriaItem move) ─┤
                                               │
                                               └─→ Task 5 (wire into both adapters)
                                                        │
                                                        └─→ Task 6 (propose_new_texts — shared)
                                                                │
                                                                └─→ Task 7 (multi-objective metricFn)
                                                                        │
                                                                        └─→ Task 8 (pipeline CLI wiring)
                                                                                │
                                                                                └─→ Task 9 (validate)
```

Task 0 runs first (boundary rule). Tasks 1-4 are independent and can run in parallel. Tasks 5-9 are strictly sequential (each modifies the same adapter files).
