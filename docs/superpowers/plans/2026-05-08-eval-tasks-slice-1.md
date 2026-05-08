# Eval Tasks — Slice 1 Implementation Plan (#943)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `run_eval` task type and the generic `input.context` fragment (3 V1 bindings: `skill`, `prompt_prefix`, `user_inline`), with daemon-side per-binding resolution and a prompt builder. `judge_eval_variant` and Tier-2 bindings are deferred to Slice 2.

**Architecture:** Add a reusable `TaskContext` TypeBox fragment to `libs/tasks` and a new `run_eval` task type that consumes it. Register the type in `BUILT_IN_TASK_TYPES`. Add a daemon-side resolver that, on claim, fetches each `cid`, verifies it, and dispatches per binding kind (write `SKILL.md` to `/home/agent/.pi/skills/<slug>/`, prepend to system prompt, or append to first user message). Add a `run_eval` prompt builder mirroring the `fulfill-brief` shape but free-form (no git workflow, no commits).

**Tech Stack:** TypeBox + `@sinclair/typebox/value`, Vitest (AAA), pnpm workspaces, Drizzle (no schema changes — task input is JSONB), Fastify (no API surface change beyond OpenAPI regen), `@moltnet/tasks` + `@moltnet/agent-runtime` + `apps/agent-daemon`.

**Reference:** [issue #943 comment 4409231854](https://github.com/getlarge/themoltnet/issues/943#issuecomment-4409231854) is the spec; this plan executes its "Slice 1 implementation order".

---

## Scope guardrails

- **In scope:** `TaskContext`/`ContextRef`/`ContextBinding`, `run_eval` task type, registry entry, daemon binding resolver for the 3 V1 bindings, `run_eval` prompt builder, OpenAPI/client regen, tests.
- **Out of scope (Slice 2+):** `judge_eval_variant`, subagent isolation, Tier-2 bindings (`reference_file`, `mcp_resource`, `imported_file`, `tool_response_seed`, `additional_context_hook`), CLI `moltnet eval ...` wrappers, replacing `Task.skillPackCids` (closing #956 happens in Slice 2 PR).

## File map

**Create:**

- `libs/tasks/src/context.ts` — `ContextBinding`, `ContextRef`, `TaskContext` schemas
- `libs/tasks/src/context.test.ts` — schema round-trip + bounds tests
- `libs/tasks/src/task-types/run-eval.ts` — `RUN_EVAL_TYPE`, `RunEvalInput`, `RunEvalOutput`, cross-field validators
- `libs/tasks/src/task-types/run-eval.test.ts` — input/output validation tests
- `libs/agent-runtime/src/prompts/run-eval.ts` — `buildRunEvalPrompt`
- `libs/agent-runtime/src/prompts/run-eval.test.ts` — prompt assembly tests
- `apps/agent-daemon/src/lib/context-bindings.ts` — `resolveTaskContext` + per-binding dispatch
- `apps/agent-daemon/src/lib/context-bindings.test.ts` — unit tests with mocked fs + API client
- `apps/agent-daemon/src/lib/context-bindings.integration.test.ts` — integration test exercising all 3 bindings

**Modify:**

- `libs/tasks/src/task-types/index.ts` — add imports + `RUN_EVAL_TYPE` registry entry, export from `./run-eval.js`
- `libs/tasks/src/index.ts` — re-export `./context.js`
- `libs/agent-runtime/src/prompts/index.ts` — wire `buildRunEvalPrompt` into `buildPromptForTask` switch
- `apps/agent-daemon/src/lib/agent-context.ts` (or equivalent claim handler) — invoke `resolveTaskContext` before launching the executor
- `libs/api-client/openapi.json` (or generator output) — regenerated after task-type registration
- `apps/rest-api/src/openapi/...` — regenerated (if applicable)

**Test paths follow source paths.**

---

## Task 1 — `ContextBinding` / `ContextRef` / `TaskContext` schemas

**Files:**

- Create: `libs/tasks/src/context.ts`
- Test: `libs/tasks/src/context.test.ts`

- [ ] **Step 1.1: Write the failing test**

```ts
// libs/tasks/src/context.test.ts
import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import { ContextBinding, ContextRef, TaskContext } from './context.js';

describe('ContextBinding', () => {
  it('accepts the three V1 binding kinds', () => {
    expect(Value.Check(ContextBinding, 'skill')).toBe(true);
    expect(Value.Check(ContextBinding, 'prompt_prefix')).toBe(true);
    expect(Value.Check(ContextBinding, 'user_inline')).toBe(true);
  });

  it('rejects unknown bindings (Tier-2 names not yet enabled)', () => {
    expect(Value.Check(ContextBinding, 'reference_file')).toBe(false);
    expect(Value.Check(ContextBinding, 'mcp_resource')).toBe(false);
    expect(Value.Check(ContextBinding, 'arbitrary')).toBe(false);
  });
});

describe('ContextRef', () => {
  it('round-trips a valid ref', () => {
    const ref = { cid: 'bafyreigh2akiscaildc...', binding: 'skill' as const };
    expect(Value.Check(ContextRef, ref)).toBe(true);
  });

  it('rejects empty cid', () => {
    expect(Value.Check(ContextRef, { cid: '', binding: 'skill' })).toBe(false);
  });

  it('rejects extra fields', () => {
    expect(
      Value.Check(ContextRef, { cid: 'bafy...', binding: 'skill', extra: 1 }),
    ).toBe(false);
  });
});

describe('TaskContext', () => {
  it('accepts an empty array (baseline variant)', () => {
    expect(Value.Check(TaskContext, [])).toBe(true);
  });

  it('rejects more than 5 items', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({
      cid: `bafy-${i}`,
      binding: 'skill' as const,
    }));
    expect(Value.Check(TaskContext, six)).toBe(false);
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `pnpm --filter @moltnet/tasks exec vitest run src/context.test.ts`
Expected: FAIL — module `./context.js` not found.

- [ ] **Step 1.3: Write minimal implementation**

```ts
// libs/tasks/src/context.ts
import { type Static, Type } from '@sinclair/typebox';

/**
 * How an executor delivers a context CID to its underlying LLM.
 * V1 bindings only; Tier-2 (reference_file, mcp_resource, imported_file,
 * tool_response_seed, additional_context_hook) ship in a later slice.
 */
export const ContextBinding = Type.Union(
  [
    Type.Literal('skill'),
    Type.Literal('prompt_prefix'),
    Type.Literal('user_inline'),
  ],
  { $id: 'ContextBinding' },
);
export type ContextBinding = Static<typeof ContextBinding>;

export const ContextRef = Type.Object(
  {
    cid: Type.String({ minLength: 1 }),
    binding: ContextBinding,
  },
  { $id: 'ContextRef', additionalProperties: false },
);
export type ContextRef = Static<typeof ContextRef>;

/** Reusable input fragment for any task type. Soft cap at 5 items;
 *  per-VM total bytes enforced at injection time by the daemon. */
export const TaskContext = Type.Array(ContextRef, {
  $id: 'TaskContext',
  maxItems: 5,
});
export type TaskContext = Static<typeof TaskContext>;
```

- [ ] **Step 1.4: Re-export from package root**

Edit `libs/tasks/src/index.ts` — add `export * from './context.js';` next to the other re-exports.

- [ ] **Step 1.5: Run test to verify it passes**

Run: `pnpm --filter @moltnet/tasks exec vitest run src/context.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 1.6: Typecheck**

Run: `pnpm --filter @moltnet/tasks typecheck`
Expected: clean.

- [ ] **Step 1.7: Commit**

```bash
git add libs/tasks/src/context.ts libs/tasks/src/context.test.ts libs/tasks/src/index.ts
git commit -m "feat(tasks): add TaskContext shared input fragment

MoltNet-Diary: <fill-from-legreffier>
Task-Group: eval-tasks-slice-1
Task-Family: feature"
```

(Diary entry per the legreffier accountable-commit flow before commit; keep `Task-Completes` for the last commit in the chain.)

---

## Task 2 — `run_eval` task type schemas

**Files:**

- Create: `libs/tasks/src/task-types/run-eval.ts`
- Test: `libs/tasks/src/task-types/run-eval.test.ts`

- [ ] **Step 2.1: Write the failing test**

```ts
// libs/tasks/src/task-types/run-eval.test.ts
import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import {
  RUN_EVAL_TYPE,
  RunEvalInput,
  RunEvalOutput,
  validateRunEvalOutput,
} from './run-eval.js';

const minimalInput = {
  scenario: { prompt: 'Summarize the file.' },
  variantLabel: 'baseline',
  context: [],
  model: 'claude-opus-4-7',
};

const minimalOutput = {
  response: 'Here is the summary.',
  totalTokens: 1234,
  durationMs: 4321,
  traceparent: '00-aaaa-bbbb-01',
};

describe('RUN_EVAL_TYPE', () => {
  it('is the canonical name', () => {
    expect(RUN_EVAL_TYPE).toBe('run_eval');
  });
});

describe('RunEvalInput', () => {
  it('accepts a minimal baseline input (empty context)', () => {
    expect(Value.Check(RunEvalInput, minimalInput)).toBe(true);
  });

  it('accepts context entries', () => {
    expect(
      Value.Check(RunEvalInput, {
        ...minimalInput,
        context: [{ cid: 'bafy...', binding: 'skill' }],
      }),
    ).toBe(true);
  });

  it('rejects empty variantLabel', () => {
    expect(
      Value.Check(RunEvalInput, { ...minimalInput, variantLabel: '' }),
    ).toBe(false);
  });

  it('rejects unknown extra fields', () => {
    expect(
      Value.Check(RunEvalInput, { ...minimalInput, scenarioCid: 'x' }),
    ).toBe(false);
  });
});

describe('RunEvalOutput', () => {
  it('accepts a minimal output', () => {
    expect(Value.Check(RunEvalOutput, minimalOutput)).toBe(true);
  });

  it('accepts artifacts', () => {
    expect(
      Value.Check(RunEvalOutput, {
        ...minimalOutput,
        artifacts: [{ path: 'out.md', cid: 'bafy...' }],
      }),
    ).toBe(true);
  });
});

describe('validateRunEvalOutput (cross-field)', () => {
  it('requires verification when input.successCriteria present', () => {
    const input = {
      ...minimalInput,
      successCriteria: { rubric: { criteria: [] } },
    };
    expect(validateRunEvalOutput(minimalOutput, input)).toMatch(
      /verification is required/,
    );
  });

  it('rejects verification when input.successCriteria absent', () => {
    expect(
      validateRunEvalOutput(
        { ...minimalOutput, verification: { passed: true, notes: '' } },
        minimalInput,
      ),
    ).toMatch(/omit verification/);
  });

  it('passes when both are absent', () => {
    expect(validateRunEvalOutput(minimalOutput, minimalInput)).toBeNull();
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `pnpm --filter @moltnet/tasks exec vitest run src/task-types/run-eval.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2.3: Write minimal implementation**

```ts
// libs/tasks/src/task-types/run-eval.ts
/**
 * `run_eval` — execute a scenario prompt under a named variant for
 * later cross-variant grading by `judge_eval_variant` (Slice 2).
 *
 * output_kind: artifact
 * criteria: optional (when set, output.verification is required —
 *   producer self-assessment; the judge is the binding evaluator)
 * references: not required (scenario lives entirely in input)
 */
import { type Static, Type } from '@sinclair/typebox';

import { TaskContext } from '../context.js';
import { SuccessCriteria, VerificationRecord } from '../success-criteria.js';

export const RUN_EVAL_TYPE = 'run_eval' as const;

export const RunEvalInput = Type.Object(
  {
    scenario: Type.Object(
      {
        prompt: Type.String({ minLength: 1 }),
        inputFiles: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      },
      { additionalProperties: false },
    ),
    /** Variant identity. Joins variants under a correlation_id. */
    variantLabel: Type.String({ minLength: 1, maxLength: 64 }),
    /** Empty array IS the baseline. */
    context: TaskContext,
    /** Model identifier the eval runner should use. */
    model: Type.String({ minLength: 1 }),
    /** Optional self-assessment rubric (advisory; not the binding judge). */
    successCriteria: Type.Optional(SuccessCriteria),
  },
  { $id: 'RunEvalInput', additionalProperties: false },
);
export type RunEvalInput = Static<typeof RunEvalInput>;

export const RunEvalOutput = Type.Object(
  {
    response: Type.String({ minLength: 1 }),
    artifacts: Type.Optional(
      Type.Array(
        Type.Object(
          {
            path: Type.String({ minLength: 1 }),
            cid: Type.String({ minLength: 1 }),
          },
          { additionalProperties: false },
        ),
      ),
    ),
    totalTokens: Type.Integer({ minimum: 0 }),
    durationMs: Type.Integer({ minimum: 0 }),
    traceparent: Type.String(),
    /** Required iff input.successCriteria is set. */
    verification: Type.Optional(VerificationRecord),
  },
  { $id: 'RunEvalOutput', additionalProperties: false },
);
export type RunEvalOutput = Static<typeof RunEvalOutput>;

/** Cross-field rule mirroring the producer-side rule in `index.ts`. */
export function validateRunEvalOutput(
  output: unknown,
  input?: unknown,
): string | null {
  const hasCriteria =
    input != null &&
    (input as { successCriteria?: SuccessCriteria }).successCriteria !==
      undefined;
  const hasVerification =
    (output as { verification?: unknown }).verification !== undefined;
  if (hasCriteria && !hasVerification) {
    return (
      'output.verification is required because input.successCriteria is set; ' +
      'the producer LLM must self-assess against the criteria'
    );
  }
  if (!hasCriteria && hasVerification) {
    return (
      'output.verification was supplied but input.successCriteria is unset; ' +
      'omit verification when there are no criteria to assess against'
    );
  }
  return null;
}
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `pnpm --filter @moltnet/tasks exec vitest run src/task-types/run-eval.test.ts`
Expected: PASS.

- [ ] **Step 2.5: Commit**

```bash
git add libs/tasks/src/task-types/run-eval.ts libs/tasks/src/task-types/run-eval.test.ts
git commit -m "feat(tasks): add run_eval task type schemas

MoltNet-Diary: <fill>
Task-Group: eval-tasks-slice-1"
```

---

## Task 3 — Register `run_eval` in `BUILT_IN_TASK_TYPES`

**Files:**

- Modify: `libs/tasks/src/task-types/index.ts`

- [ ] **Step 3.1: Add a registry test**

Append to an existing test file (or create `libs/tasks/src/task-types/registry.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { BUILT_IN_TASK_TYPES, RUN_EVAL_TYPE } from './index.js';

describe('BUILT_IN_TASK_TYPES', () => {
  it('includes run_eval as an artifact-kind type', () => {
    const entry = BUILT_IN_TASK_TYPES[RUN_EVAL_TYPE];
    expect(entry).toBeDefined();
    expect(entry.outputKind).toBe('artifact');
    expect(entry.requiresReferences).toBe(false);
    expect(entry.validateOutput).toBeDefined();
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `pnpm --filter @moltnet/tasks exec vitest run src/task-types/registry.test.ts`
Expected: FAIL — `RUN_EVAL_TYPE` not exported / entry undefined.

- [ ] **Step 3.3: Wire the registry**

Edit `libs/tasks/src/task-types/index.ts`:

1. Add imports next to the others:
   ```ts
   import {
     RUN_EVAL_TYPE,
     RunEvalInput,
     RunEvalOutput,
     validateRunEvalOutput,
   } from './run-eval.js';
   ```
2. Add `export * from './run-eval.js';` next to the other re-exports.
3. Add the registry entry next to `[FULFILL_BRIEF_TYPE]`:
   ```ts
   [RUN_EVAL_TYPE]: {
     name: RUN_EVAL_TYPE,
     inputSchema: RunEvalInput,
     outputSchema: RunEvalOutput,
     outputKind: 'artifact',
     requiresReferences: false,
     validateOutput: validateRunEvalOutput,
   },
   ```

- [ ] **Step 3.4: Run all `@moltnet/tasks` tests**

Run: `pnpm --filter @moltnet/tasks test`
Expected: every test passes (including the new registry one).

- [ ] **Step 3.5: Commit**

```bash
git add libs/tasks/src/task-types/index.ts libs/tasks/src/task-types/registry.test.ts
git commit -m "feat(tasks): register run_eval in BUILT_IN_TASK_TYPES

MoltNet-Diary: <fill>
Task-Group: eval-tasks-slice-1"
```

---

## Task 4 — `run_eval` prompt builder

**Files:**

- Create: `libs/agent-runtime/src/prompts/run-eval.ts`
- Test: `libs/agent-runtime/src/prompts/run-eval.test.ts`
- Modify: `libs/agent-runtime/src/prompts/index.ts`

- [ ] **Step 4.1: Write the failing test**

```ts
// libs/agent-runtime/src/prompts/run-eval.test.ts
import { describe, expect, it } from 'vitest';

import { buildRunEvalPrompt } from './run-eval.js';

const baseInput = {
  scenario: { prompt: 'List the top 3 risks in this code.' },
  variantLabel: 'with-skill',
  context: [],
  model: 'claude-opus-4-7',
};

const ctx = { diaryId: 'd-1', taskId: 't-1' };

describe('buildRunEvalPrompt', () => {
  it('embeds the scenario prompt verbatim', () => {
    const out = buildRunEvalPrompt(baseInput, ctx);
    expect(out).toContain('List the top 3 risks in this code.');
  });

  it('includes the variantLabel for traceability', () => {
    const out = buildRunEvalPrompt(baseInput, ctx);
    expect(out).toContain('with-skill');
  });

  it('includes the task id (agent must echo it)', () => {
    expect(buildRunEvalPrompt(baseInput, ctx)).toContain('t-1');
  });

  it('omits the self-verification block when no successCriteria', () => {
    const out = buildRunEvalPrompt(baseInput, ctx);
    expect(out).not.toMatch(/self-assess|verification/i);
  });

  it('includes the self-verification block when successCriteria present', () => {
    const out = buildRunEvalPrompt(
      { ...baseInput, successCriteria: { rubric: { criteria: [] } } },
      ctx,
    );
    expect(out).toMatch(/verification/i);
  });

  it('lists scenario inputFiles when present', () => {
    const out = buildRunEvalPrompt(
      { ...baseInput, scenario: { prompt: 'x', inputFiles: ['a.md'] } },
      ctx,
    );
    expect(out).toContain('a.md');
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

Run: `pnpm --filter @moltnet/agent-runtime exec vitest run src/prompts/run-eval.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 4.3: Write the prompt builder**

```ts
// libs/agent-runtime/src/prompts/run-eval.ts
import type { RunEvalInput } from '@moltnet/tasks';

import { buildFinalOutputBlock } from './final-output.js';
import { buildSelfVerificationBlock } from './self-verification.js';

interface Ctx {
  diaryId: string;
  taskId: string;
}

/**
 * Build the system prompt for a `run_eval` task.
 *
 * Free-form: no git workflow, no commit ceremony. The executor produces
 * a textual response (and optional artifacts) for cross-variant grading
 * by `judge_eval_variant` in Slice 2.
 *
 * Context delivery is daemon-side (see `apps/agent-daemon/src/lib/
 * context-bindings.ts`) and lands before this prompt is rendered:
 * `prompt_prefix` items are concatenated ahead of this body, `skill`
 * items are written to disk, `user_inline` items are appended to the
 * first user message. This builder does NOT inline `input.context[]`
 * itself.
 */
export function buildRunEvalPrompt(input: RunEvalInput, ctx: Ctx): string {
  const { scenario, variantLabel, model, successCriteria } = input;

  const inputFilesSection = scenario.inputFiles?.length
    ? [
        '### Input files',
        '',
        ...scenario.inputFiles.map((f) => `- \`${f}\``),
        '',
      ].join('\n')
    : '';

  const verificationSection = successCriteria
    ? buildSelfVerificationBlock(successCriteria)
    : '';

  return [
    `You are running an evaluation scenario as variant \`${variantLabel}\` against model \`${model}\`.`,
    `Task id: ${ctx.taskId}.`,
    '',
    '### Scenario',
    '',
    scenario.prompt,
    '',
    inputFilesSection,
    verificationSection,
    buildFinalOutputBlock(ctx.taskId),
  ]
    .filter(Boolean)
    .join('\n');
}
```

- [ ] **Step 4.4: Wire into the dispatcher**

Edit `libs/agent-runtime/src/prompts/index.ts`:

1. Add `RUN_EVAL_TYPE` and `RunEvalInput` to the `@moltnet/tasks` import group.
2. Add `import { buildRunEvalPrompt } from './run-eval.js';` and `export * from './run-eval.js';`.
3. Add a new case to the `buildPromptForTask` switch:
   ```ts
   case RUN_EVAL_TYPE: {
     if (!Value.Check(RunEvalInput, task.input)) {
       const errors = [...Value.Errors(RunEvalInput, task.input)];
       throw new Error(
         `run_eval input failed validation: ${JSON.stringify(errors.slice(0, 3))}`,
       );
     }
     return buildRunEvalPrompt(task.input, {
       diaryId: ctx.diaryId,
       taskId: ctx.taskId,
     });
   }
   ```

- [ ] **Step 4.5: Run all agent-runtime prompt tests**

Run: `pnpm --filter @moltnet/agent-runtime test`
Expected: all pass.

- [ ] **Step 4.6: Commit**

```bash
git add libs/agent-runtime/src/prompts/run-eval.ts \
        libs/agent-runtime/src/prompts/run-eval.test.ts \
        libs/agent-runtime/src/prompts/index.ts
git commit -m "feat(agent-runtime): add run_eval prompt builder

MoltNet-Diary: <fill>
Task-Group: eval-tasks-slice-1"
```

---

## Task 5 — Daemon-side `resolveTaskContext` (the 3 V1 bindings)

**Files:**

- Create: `apps/agent-daemon/src/lib/context-bindings.ts`
- Test: `apps/agent-daemon/src/lib/context-bindings.test.ts`

This task gates skill-pack content fidelity (#977 prerequisite for `binding: 'skill'`). For Slice 1 we implement the dispatch + audit; the **flagged-content refusal gate** is wired but accepts any caller-supplied predicate so #956's gates can plug in unchanged.

- [ ] **Step 5.1: Write the failing tests**

```ts
// apps/agent-daemon/src/lib/context-bindings.test.ts
import { describe, expect, it, vi } from 'vitest';

import {
  resolveTaskContext,
  type ContextDeliverer,
  type FlaggedContentCheck,
} from './context-bindings.js';

const ok: FlaggedContentCheck = async () => ({ flagged: false });

function makeFetcher(map: Record<string, Uint8Array>) {
  return async (cid: string) => {
    const bytes = map[cid];
    if (!bytes) throw new Error(`cid ${cid} not found`);
    return { cid, bytes };
  };
}

describe('resolveTaskContext', () => {
  it('returns an empty result for an empty context array (baseline)', async () => {
    const deliverer = mockDeliverer();
    const out = await resolveTaskContext({
      context: [],
      fetch: makeFetcher({}),
      verifyCid: async () => true,
      isFlagged: ok,
      deliver: deliverer,
    });
    expect(out.injected).toHaveLength(0);
    expect(deliverer.skill).not.toHaveBeenCalled();
    expect(out.systemPromptPrefix).toBe('');
    expect(out.userInlineSuffix).toBe('');
  });

  it('writes skill bytes through the skill deliverer', async () => {
    const bytes = new TextEncoder().encode('# Skill body');
    const deliverer = mockDeliverer();
    const out = await resolveTaskContext({
      context: [{ cid: 'bafyabc', binding: 'skill' }],
      fetch: makeFetcher({ bafyabc: bytes }),
      verifyCid: async () => true,
      isFlagged: ok,
      deliver: deliverer,
    });
    expect(deliverer.skill).toHaveBeenCalledWith({
      slug: expect.any(String),
      bytes,
    });
    expect(out.injected).toEqual([
      expect.objectContaining({ cid: 'bafyabc', binding: 'skill' }),
    ]);
  });

  it('concatenates prompt_prefix items in declared order', async () => {
    const a = new TextEncoder().encode('AAA');
    const b = new TextEncoder().encode('BBB');
    const out = await resolveTaskContext({
      context: [
        { cid: 'a', binding: 'prompt_prefix' },
        { cid: 'b', binding: 'prompt_prefix' },
      ],
      fetch: makeFetcher({ a, b }),
      verifyCid: async () => true,
      isFlagged: ok,
      deliver: mockDeliverer(),
    });
    expect(out.systemPromptPrefix).toBe('AAA\n\n---\n\nBBB');
  });

  it('concatenates user_inline items in declared order', async () => {
    const a = new TextEncoder().encode('hello');
    const out = await resolveTaskContext({
      context: [{ cid: 'a', binding: 'user_inline' }],
      fetch: makeFetcher({ a }),
      verifyCid: async () => true,
      isFlagged: ok,
      deliver: mockDeliverer(),
    });
    expect(out.userInlineSuffix).toBe('hello');
  });

  it('throws when verifyCid returns false', async () => {
    await expect(
      resolveTaskContext({
        context: [{ cid: 'a', binding: 'skill' }],
        fetch: makeFetcher({ a: new TextEncoder().encode('x') }),
        verifyCid: async () => false,
        isFlagged: ok,
        deliver: mockDeliverer(),
      }),
    ).rejects.toThrow(/cid mismatch/i);
  });

  it('throws when isFlagged reports flagged content', async () => {
    await expect(
      resolveTaskContext({
        context: [{ cid: 'a', binding: 'skill' }],
        fetch: makeFetcher({ a: new TextEncoder().encode('x') }),
        verifyCid: async () => true,
        isFlagged: async () => ({ flagged: true, reason: 'injection_risk' }),
        deliver: mockDeliverer(),
      }),
    ).rejects.toThrow(/flagged/i);
  });

  it('rejects skill slug collisions on first 12 chars of cid', async () => {
    // Two distinct CIDs whose first 12 chars are identical — the slug
    // derivation must extend or fail; per-spec choice: fail loudly.
    const same = new TextEncoder().encode('x');
    await expect(
      resolveTaskContext({
        context: [
          { cid: 'bafyreiaaaaaa1', binding: 'skill' },
          { cid: 'bafyreiaaaaaa2', binding: 'skill' },
        ],
        fetch: makeFetcher({ bafyreiaaaaaa1: same, bafyreiaaaaaa2: same }),
        verifyCid: async () => true,
        isFlagged: ok,
        deliver: mockDeliverer(),
      }),
    ).rejects.toThrow(/slug collision/i);
  });
});

function mockDeliverer(): ContextDeliverer & {
  skill: ReturnType<typeof vi.fn>;
} {
  const skill = vi.fn(async () => undefined);
  return { skill };
}
```

- [ ] **Step 5.2: Run test to verify it fails**

Run: `pnpm --filter @themoltnet/agent-daemon exec vitest run src/lib/context-bindings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5.3: Write the resolver**

```ts
// apps/agent-daemon/src/lib/context-bindings.ts
import type { ContextRef, TaskContext } from '@moltnet/tasks';

const SLUG_PREFIX_LEN = 12;
const PROMPT_SEPARATOR = '\n\n---\n\n';

export interface FetchedBytes {
  cid: string;
  bytes: Uint8Array;
}

export type CidFetcher = (cid: string) => Promise<FetchedBytes>;

export type CidVerifier = (got: FetchedBytes) => Promise<boolean>;

export interface FlaggedResult {
  flagged: boolean;
  reason?: string;
}

export type FlaggedContentCheck = (got: FetchedBytes) => Promise<FlaggedResult>;

export interface ContextDeliverer {
  /** Persist skill bytes to the agent VM at the runtime's discovery path. */
  skill: (args: { slug: string; bytes: Uint8Array }) => Promise<void>;
}

export interface ResolveArgs {
  context: TaskContext;
  fetch: CidFetcher;
  verifyCid: CidVerifier;
  isFlagged: FlaggedContentCheck;
  deliver: ContextDeliverer;
}

export interface ResolvedContext {
  /** What was injected (for audit). Order matches input. */
  injected: ContextRef[];
  /** Prepended to the system prompt by the prompt assembler. */
  systemPromptPrefix: string;
  /** Appended to the first user message by the prompt assembler. */
  userInlineSuffix: string;
}

export async function resolveTaskContext(
  args: ResolveArgs,
): Promise<ResolvedContext> {
  const promptParts: string[] = [];
  const userParts: string[] = [];
  const injected: ContextRef[] = [];
  const usedSlugs = new Map<string, string>(); // slug -> cid

  for (const ref of args.context) {
    const got = await args.fetch(ref.cid);
    if (!(await args.verifyCid(got))) {
      throw new Error(`cid mismatch for ${ref.cid}`);
    }
    const flag = await args.isFlagged(got);
    if (flag.flagged) {
      throw new Error(
        `context ${ref.cid} flagged (${flag.reason ?? 'unknown'})`,
      );
    }

    switch (ref.binding) {
      case 'skill': {
        const slug = deriveSlug(ref.cid);
        const prior = usedSlugs.get(slug);
        if (prior && prior !== ref.cid) {
          throw new Error(
            `slug collision: ${slug} already used by ${prior}; refusing to overwrite`,
          );
        }
        usedSlugs.set(slug, ref.cid);
        await args.deliver.skill({ slug, bytes: got.bytes });
        break;
      }
      case 'prompt_prefix':
        promptParts.push(new TextDecoder().decode(got.bytes));
        break;
      case 'user_inline':
        userParts.push(new TextDecoder().decode(got.bytes));
        break;
    }
    injected.push(ref);
  }

  return {
    injected,
    systemPromptPrefix: promptParts.join(PROMPT_SEPARATOR),
    userInlineSuffix: userParts.join(PROMPT_SEPARATOR),
  };
}

/**
 * Slug derivation: first 12 chars of the CID. Refuses to overwrite on
 * collision (caller gets a clear error rather than silent shadowing).
 * CIDs are alphanumeric (base32) so path-traversal is naturally
 * impossible, but we still strip non-alphanumerics defensively.
 */
function deriveSlug(cid: string): string {
  const safe = cid.replace(/[^a-zA-Z0-9]/g, '');
  return safe.slice(0, SLUG_PREFIX_LEN);
}
```

- [ ] **Step 5.4: Run unit tests**

Run: `pnpm --filter @themoltnet/agent-daemon exec vitest run src/lib/context-bindings.test.ts`
Expected: 7 tests pass.

- [ ] **Step 5.5: Commit**

```bash
git add apps/agent-daemon/src/lib/context-bindings.ts \
        apps/agent-daemon/src/lib/context-bindings.test.ts
git commit -m "feat(agent-daemon): resolve TaskContext bindings (skill/prompt_prefix/user_inline)

MoltNet-Diary: <fill>
Task-Group: eval-tasks-slice-1"
```

---

## Task 6 — Wire `resolveTaskContext` into the claim path

**Files:**

- Modify: `apps/agent-daemon/src/lib/agent-context.ts` (or whichever module orchestrates claim → executor)

The exact integration point depends on the daemon's current claim handler — the implementing engineer must locate where the prompt is assembled and the executor is launched. Below is the contract; insert at that point.

- [ ] **Step 6.1: Find the integration point**

```bash
grep -rn "buildPromptForTask\|claimTask\|launchExecutor" apps/agent-daemon/src
```

The point of insertion is **after** the task is claimed and **before** the executor process is spawned. Identify the function (likely in `agent-context.ts` or `sandbox.ts`).

- [ ] **Step 6.2: Add an integration test asserting the wiring**

Mock `resolveTaskContext` and verify that for a `run_eval` task with non-empty `input.context`, it is invoked exactly once with the input's context array, and its `systemPromptPrefix` is prepended to the system prompt actually passed to the executor.

(Concrete code depends on the integration point identified in 6.1; mirror the existing test style in that file.)

- [ ] **Step 6.3: Implement the wiring**

Pseudocode:

```ts
const resolved = await resolveTaskContext({
  context: task.input.context ?? [],
  fetch: cidFetcherFromApi(client),
  verifyCid: defaultCidVerifier,
  isFlagged: defaultFlaggedContentCheck,
  deliver: { skill: writeSkillToVm },
});

const basePrompt = buildPromptForTask(task, ctx);
const systemPrompt = resolved.systemPromptPrefix
  ? `${resolved.systemPromptPrefix}${PROMPT_SEPARATOR}${basePrompt}`
  : basePrompt;
const firstUserMessage = resolved.userInlineSuffix
  ? `${userMessage}${PROMPT_SEPARATOR}${resolved.userInlineSuffix}`
  : userMessage;
```

`writeSkillToVm` writes to `/home/agent/.pi/skills/<slug>/SKILL.md` inside the executor's home (verify path against pi-coding-agent's actual discovery layout — see open question 5 in the issue spec; if different, adjust).

Audit: emit one `(taskAttemptId, cid, binding, injectedAt)` log row per `injected[]` entry through the daemon's existing structured logger.

- [ ] **Step 6.4: Run daemon test suite**

Run: `pnpm --filter @themoltnet/agent-daemon test`
Expected: all pass.

- [ ] **Step 6.5: Commit**

```bash
git add apps/agent-daemon/src/lib/<modified files>
git commit -m "feat(agent-daemon): inject TaskContext bindings before executor launch

MoltNet-Diary: <fill>
Task-Group: eval-tasks-slice-1"
```

---

## Task 7 — Integration test: full `run_eval` claim with all 3 bindings

**Files:**

- Create: `apps/agent-daemon/src/lib/context-bindings.integration.test.ts`

- [ ] **Step 7.1: Write the integration test**

Spin up an in-process synthetic task with one ref per binding kind (`skill`, `prompt_prefix`, `user_inline`), a stub fetcher returning known bytes for each CID, and a mock executor that records the system prompt + first user message it receives. Assert:

1. `SKILL.md` was written to a tmpdir at `<root>/.pi/skills/<slug>/SKILL.md` with the expected bytes.
2. The system prompt the executor saw starts with the `prompt_prefix` bytes followed by the separator and the base `run_eval` prompt body.
3. The first user message ends with the `user_inline` bytes (preceded by the separator).
4. The audit log contains three rows, one per ref, in declared order.

Use `vitest`'s `tmpdir` helpers and the daemon's existing test fixtures.

- [ ] **Step 7.2: Run it**

Run: `pnpm --filter @themoltnet/agent-daemon exec vitest run src/lib/context-bindings.integration.test.ts`
Expected: PASS.

- [ ] **Step 7.3: Commit**

```bash
git add apps/agent-daemon/src/lib/context-bindings.integration.test.ts
git commit -m "test(agent-daemon): integration coverage for all 3 V1 context bindings

MoltNet-Diary: <fill>
Task-Group: eval-tasks-slice-1"
```

---

## Task 8 — Regenerate OpenAPI + clients

**Files:**

- Modify: `libs/api-client/...` (generator outputs)
- Modify: any committed OpenAPI snapshot under `apps/rest-api/`

- [ ] **Step 8.1: Regenerate**

Run:

```bash
pnpm run generate:openapi
```

- [ ] **Step 8.2: Verify generated diff is the expected `run_eval` registration only**

Inspect `git diff` — should show new `RunEvalInput`/`RunEvalOutput`/`ContextRef`/`TaskContext` schemas surfaced by the registry. No other type drift.

- [ ] **Step 8.3: Run client + rest-api typechecks**

Run:

```bash
pnpm --filter @moltnet/api-client typecheck
pnpm --filter @moltnet/rest-api typecheck
```

Expected: clean.

- [ ] **Step 8.4: Commit**

```bash
git add libs/api-client apps/rest-api
git commit -m "chore: regenerate OpenAPI for run_eval task type

MoltNet-Diary: <fill>
Task-Group: eval-tasks-slice-1
Task-Family: codegen"
```

---

## Task 9 — Full validate + final commit

- [ ] **Step 9.1: Full validate**

Run:

```bash
pnpm run validate
```

Expected: lint + typecheck + test + build all pass.

- [ ] **Step 9.2: Diary `Task-Completes` trailer on the last commit**

After the validate gate passes, amend the last commit's message (or write a final no-op commit if more readable) to add `Task-Completes: true`.

- [ ] **Step 9.3: Push + open PR**

```bash
git push -u origin worktree-eval-tasks-943
GH_TOKEN=$($MOLTNET_CLI github token --credentials "$CREDS") gh pr create \
  --title "feat(tasks,agent-daemon): run_eval task type + TaskContext bindings (#943 slice 1)" \
  --body-file <(echo 'Closes part of #943. Slice 1 of 2 — see plan in docs/superpowers/plans/2026-05-08-eval-tasks-slice-1.md. Slice 2 (judge_eval_variant + subagent isolation, replacing #956) follows in a separate PR.')
```

---

## Self-review checklist (run before handing off)

- **Spec coverage** — every Slice 1 step in the issue maps to a task above:
  - `libs/tasks/src/context.ts` → Task 1 ✓
  - `libs/tasks/src/task-types/run-eval.ts` → Task 2 ✓
  - Registry entry → Task 3 ✓
  - Daemon binding resolver → Task 5 ✓
  - Pi-extension prompt builder → Task 4 ✓
  - OpenAPI regen → Task 8 ✓
  - No migration needed (TypeBox-only) — confirmed in Task 8 step 2 ✓
  - Tests: unit, repo round-trip (covered by registry+context tests against JSONB-shaped values), daemon per-binding (Task 5), e2e (Task 7) ✓
- **Open questions handled in code:** slug collision → fail loudly (Task 5 step 5.3); slug regex stripping path-traversal chars → in `deriveSlug` (Task 5).
- **Deferred to Slice 2 (explicitly out of scope):** `judge_eval_variant`, subagent isolation, Tier-2 bindings, closing #956.
