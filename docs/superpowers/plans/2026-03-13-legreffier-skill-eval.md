# LeGreffier Skill Eval + GEPA Optimization — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a generic skill eval pipeline in `libs/context-evals/` and a LeGreffier-specific scorer + setup in `tools/src/skill-evals/legreffier/`, then wire them into the existing `gpack` pipeline so GEPA can optimize the commit workflow section of SKILL.md.

**Architecture:** Generic `SkillEvalAdapter` (worktree lifecycle, MCP injection, skill assembly, agent execution) + pluggable `SkillScorer` interface (scoring logic per skill). LeGreffier implements `CommitScorer` for accountable commit validation. Eval tasks live in `evals/legreffier-commit-*/`.

**Tech Stack:** TypeScript, `@ax-llm/ax` (AxGEPA), `@anthropic-ai/claude-agent-sdk` (query), `@moltnet/bootstrap` (genesis agent), `@themoltnet/sdk` (writeConfig, exportSSHKey), Docker Compose e2e stack, Vitest.

---

## File Structure

### New files

```
libs/context-evals/src/
  skill-types.ts              — SkillEvalTask, SkillEvalTrace, SkillScorer interface
  skill-adapter.ts            — SkillEvalAdapter class (AxGEPAAdapter)

tools/src/skill-evals/
  legreffier/
    eval-setup.ts             — pnpm eval:setup / eval:teardown scripts
    commit-scorer.ts          — CommitScorer implements SkillScorer (Group 1)
    chain-scorer.ts           — ChainScorer extends CommitScorer (Group 2 task-chain trailers)
    skill-sections.ts         — PREAMBLE / EPILOGUE string constants
    types.ts                  — CommitScoreResult, CommitExpected interfaces

evals/
  legreffier-commit-feat/
    scenario.json, task.md, patch.diff
  legreffier-commit-fix/
    scenario.json, task.md, patch.diff
  legreffier-commit-test/
    scenario.json, task.md, patch.diff
  legreffier-commit-chore/
    scenario.json, task.md, patch.diff
  legreffier-commit-docs/
    scenario.json, task.md, patch.diff
  legreffier-chain-fix-chore-test/
    scenario.json, task.md, patch-1-fix.diff, patch-2-chore.diff, patch-3-test.diff
```

### Modified files

```
libs/context-evals/src/anthropic.ts   — Add mcpServers + env options to ClaudeQueryOptions
libs/context-evals/src/index.ts       — Export new skill-eval types + re-export process helpers
libs/context-evals/src/pipeline.ts    — Add --skill-eval flag + SkillEvalTask schema
libs/context-evals/package.json       — Add ./process subpath export
tools/package.json                    — Add eval:setup / eval:teardown scripts + @themoltnet/sdk dep
```

---

## Chunk 1: Generic Skill Eval Infrastructure

### Task 1: Skill eval types

**Files:**

- Create: `libs/context-evals/src/skill-types.ts`
- Test: `libs/context-evals/src/skill-types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// libs/context-evals/src/skill-types.test.ts
import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';

import { SkillEvalTaskSchema } from './skill-types.js';

describe('SkillEvalTaskSchema', () => {
  it('validates a minimal skill eval task', () => {
    const task = {
      id: 'legreffier-commit-feat',
      baseCommit: '6486435',
      taskPrompt: 'Commit using legreffier.',
      patchFiles: ['patch.diff'],
      skillPath: '.claude/skills/legreffier/SKILL.md',
    };
    expect(Value.Check(SkillEvalTaskSchema, task)).toBe(true);
  });

  it('rejects task with empty patchFiles', () => {
    const task = {
      id: 'bad',
      baseCommit: '6486435',
      taskPrompt: 'Commit.',
      patchFiles: [],
      skillPath: '.claude/skills/legreffier/SKILL.md',
    };
    expect(Value.Check(SkillEvalTaskSchema, task)).toBe(false);
  });

  it('accepts optional env and expected fields', () => {
    const task = {
      id: 'with-extras',
      baseCommit: '6486435',
      taskPrompt: 'Commit.',
      patchFiles: ['p.diff'],
      skillPath: '.claude/skills/legreffier/SKILL.md',
      env: { FOO: 'bar' },
      expected: { riskLevel: 'medium' },
    };
    expect(Value.Check(SkillEvalTaskSchema, task)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @moltnet/context-evals test -- --run src/skill-types.test.ts`
Expected: FAIL — module `./skill-types.js` not found

- [ ] **Step 3: Write the types and schema**

```typescript
// libs/context-evals/src/skill-types.ts
import type { AxGEPAAdapter } from '@ax-llm/ax';
import { type Static, Type } from '@sinclair/typebox';

// ── Schema ────────────────────────────────────────────────────────────────────

const NonEmptyString = Type.String({ minLength: 1 });

export const SkillEvalTaskSchema = Type.Object({
  id: NonEmptyString,
  baseCommit: NonEmptyString,
  taskPrompt: NonEmptyString,
  patchFiles: Type.Array(NonEmptyString, { minItems: 1 }),
  skillPath: NonEmptyString,
  env: Type.Optional(Type.Record(Type.String(), Type.String())),
  expected: Type.Optional(Type.Unknown()),
});

export type SkillEvalTask = Static<typeof SkillEvalTaskSchema>;

// ── Trace ─────────────────────────────────────────────────────────────────────

export interface SkillEvalTrace {
  taskId: string;
  worktreeDir?: string;
  taskPrompt: string;
  executor: 'anthropic-sdk';
  sessionId?: string;
  turnCount?: number;
  durationMs?: number;
  costUsd?: number;
  toolCallCount?: number;
  toolSummaries?: string[];
  /** Opaque result from the skill-specific scorer. */
  scoreResult: unknown;
}

// ── Scorer interface ──────────────────────────────────────────────────────────

export interface SkillScorer<TExpected = unknown, TScoreResult = unknown> {
  /** Score the worktree state after the agent finishes. */
  score(worktreeDir: string, expected: TExpected): Promise<TScoreResult>;
  /** Extract a numeric score (0.0–1.0) from the scorer's result. */
  toNumeric(result: TScoreResult): number;
  /** Build reflective feedback string from the scorer's result. */
  toFeedback(result: TScoreResult, task: SkillEvalTask): string;
}

// ── Adapter options ───────────────────────────────────────────────────────────

export interface SkillEvalAdapterOptions {
  preamble: string;
  epilogue: string;
  mcpServers: Record<string, unknown>;
  agentConfigDir: string;
  agentName: string;
  scorer: SkillScorer;
  claudeModel?: string;
  verbose?: boolean;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @moltnet/context-evals test -- --run src/skill-types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add libs/context-evals/src/skill-types.ts libs/context-evals/src/skill-types.test.ts
git commit -m "feat(context-evals): add SkillEvalTask schema, SkillScorer interface, and SkillEvalTrace type"
```

---

### Task 2: Update `anthropic.ts` — add `mcpServers` and `env` options

**Files:**

- Modify: `libs/context-evals/src/anthropic.ts`
- Test: `libs/context-evals/src/anthropic.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// libs/context-evals/src/anthropic.test.ts
import { describe, expect, it } from 'vitest';

import type { ClaudeQueryOptions } from './anthropic.js';

describe('ClaudeQueryOptions', () => {
  it('accepts mcpServers option', () => {
    const opts: ClaudeQueryOptions = {
      cwd: '/tmp/test',
      prompt: 'test',
      maxTurns: 5,
      clientApp: 'test',
      mcpServers: {
        legreffier: {
          type: 'http',
          url: 'http://localhost:8001/mcp',
          headers: { 'X-Client-Id': 'abc' },
        },
      },
    };
    expect(opts.mcpServers).toBeDefined();
    expect(opts.mcpServers!['legreffier']).toHaveProperty('type', 'http');
  });

  it('accepts extraEnv option', () => {
    const opts: ClaudeQueryOptions = {
      cwd: '/tmp/test',
      prompt: 'test',
      maxTurns: 5,
      clientApp: 'test',
      extraEnv: { GIT_CONFIG_GLOBAL: '/tmp/.moltnet/eval-agent/gitconfig' },
    };
    expect(opts.extraEnv).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @moltnet/context-evals test -- --run src/anthropic.test.ts`
Expected: FAIL — `mcpServers` and `extraEnv` are not on the type

- [ ] **Step 3: Add mcpServers and extraEnv to ClaudeQueryOptions and wire into query()**

In `libs/context-evals/src/anthropic.ts`:

Add to `ClaudeQueryOptions`:

```typescript
  mcpServers?: Record<string, unknown>;
  extraEnv?: Record<string, string>;
```

In `createClaudeQuery()`, update the `query()` call:

- Add `mcpServers` as a top-level option (parallel to `cwd`, `model`).
- Merge `extraEnv` into the existing `env` object.

```typescript
return query({
  prompt,
  options: {
    cwd,
    model: resolvedModel,
    // ...existing options...
    ...(mcpServers ? { mcpServers } : {}),
    settings: { ...localSettings, disableAllHooks: true },
    env: {
      ...runtimeEnv,
      CLAUDE_AGENT_SDK_CLIENT_APP: clientApp,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      ...(config.ANTHROPIC_API_KEY
        ? { ANTHROPIC_API_KEY: config.ANTHROPIC_API_KEY }
        : {}),
      ...(config.ANTHROPIC_AUTH_TOKEN
        ? { ANTHROPIC_AUTH_TOKEN: config.ANTHROPIC_AUTH_TOKEN }
        : {}),
      ...extraEnv,
    },
    ...(stderr ? { stderr } : {}),
  },
}) as AsyncIterable<SDKMessage> & { close(): void };
```

This also resolves the existing TODO at line 58-60.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @moltnet/context-evals test -- --run src/anthropic.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add libs/context-evals/src/anthropic.ts libs/context-evals/src/anthropic.test.ts
git commit -m "feat(context-evals): add mcpServers and extraEnv options to ClaudeQueryOptions"
```

---

### Task 3: `SkillEvalAdapter` class

**Files:**

- Create: `libs/context-evals/src/skill-adapter.ts`
- Test: `libs/context-evals/src/skill-adapter.test.ts`

- [ ] **Step 1: Write the failing test**

The adapter orchestrates worktree lifecycle + agent execution + scoring. We test the structural parts (skill assembly, reflective dataset building) and mock the heavy I/O.

```typescript
// libs/context-evals/src/skill-adapter.test.ts
import { describe, expect, it, vi } from 'vitest';

// We'll test the pure functions extracted from the adapter:
// - assembleSkill(preamble, candidate, epilogue)
// - buildReflectiveEntry(scorer, trace, task)
// The full evaluate() requires mocking too many I/O layers for a unit test.

import { assembleSkill } from './skill-adapter.js';

describe('assembleSkill', () => {
  it('concatenates preamble + candidate instruction + epilogue', () => {
    const result = assembleSkill(
      '# Preamble\n',
      '## Commit workflow\n',
      '# Epilogue\n',
    );
    expect(result).toBe('# Preamble\n## Commit workflow\n# Epilogue\n');
  });

  it('handles empty candidate', () => {
    const result = assembleSkill('PRE\n', '', 'POST\n');
    expect(result).toBe('PRE\nPOST\n');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @moltnet/context-evals test -- --run src/skill-adapter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement SkillEvalAdapter**

```typescript
// libs/context-evals/src/skill-adapter.ts
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { AxGEPAAdapter, AxGEPAEvaluationBatch } from '@ax-llm/ax';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import { createClaudeQuery } from './anthropic.js';
import { createWorktree, removeWorktree } from './evaluate.js';
import { execFileText, runShellCommand } from './process.js';
import type {
  SkillEvalAdapterOptions,
  SkillEvalTask,
  SkillEvalTrace,
} from './skill-types.js';

import type { GpackOutput } from './adapter.js';

// ── Pure helpers ──────────────────────────────────────────────────────────────

export function assembleSkill(
  preamble: string,
  candidate: string,
  epilogue: string,
): string {
  return preamble + candidate + epilogue;
}

// ── Adapter ───────────────────────────────────────────────────────────────────

interface ResultPayload {
  subtype?: string;
  is_error?: boolean;
  result?: string;
  errors?: string[];
  num_turns?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  total_cost_usd?: number;
  session_id?: string;
}

export class SkillEvalAdapter implements AxGEPAAdapter<
  SkillEvalTask,
  SkillEvalTrace,
  GpackOutput
> {
  private lastBatch: readonly SkillEvalTask[] = [];

  constructor(private options: SkillEvalAdapterOptions) {}

  async evaluate(
    batch: readonly SkillEvalTask[],
    candidate: Readonly<Record<string, string>>,
    captureTraces?: boolean,
  ): Promise<AxGEPAEvaluationBatch<SkillEvalTrace, GpackOutput>> {
    const {
      preamble,
      epilogue,
      mcpServers,
      agentConfigDir,
      agentName,
      scorer,
      claudeModel,
      verbose,
    } = this.options;

    const skillText = assembleSkill(
      preamble,
      candidate['instruction'] ?? '',
      epilogue,
    );
    this.lastBatch = batch;

    const outputs: GpackOutput[] = [];
    const scores: number[] = [];
    const trajectories: SkillEvalTrace[] = [];

    for (const task of batch) {
      if (verbose) {
        console.log(`[skill-eval] task=${task.id}`);
      }

      let worktreeDir: string | undefined;
      try {
        // 1. Create worktree
        worktreeDir = await createWorktree(task.baseCommit, task.id);

        // 2. Copy agent config
        const targetMoltnet = resolve(worktreeDir, '.moltnet', agentName);
        await mkdir(targetMoltnet, { recursive: true });
        await cp(agentConfigDir, targetMoltnet, { recursive: true });

        // 3. Write assembled skill
        const skillDir = resolve(
          worktreeDir,
          ...task.skillPath.split('/').slice(0, -1),
        );
        await mkdir(skillDir, { recursive: true });
        await writeFile(
          resolve(worktreeDir, task.skillPath),
          skillText,
          'utf8',
        );

        // 4. Apply patches
        for (const patchFile of task.patchFiles) {
          const patchPath = resolve(process.cwd(), patchFile);
          await execFileText('git', ['apply', patchPath], { cwd: worktreeDir });
        }

        // 5. Run Claude Code agent
        const agentResult = await this.runAgent(
          worktreeDir,
          task,
          mcpServers,
          agentName,
          claudeModel,
        );

        // 6. Score
        const scoreResult = await scorer.score(worktreeDir, task.expected);
        const numericScore = scorer.toNumeric(scoreResult);

        outputs.push({ taskId: task.id, score: numericScore });
        scores.push(numericScore);

        if (captureTraces) {
          trajectories.push({
            taskId: task.id,
            worktreeDir,
            taskPrompt: task.taskPrompt,
            executor: 'anthropic-sdk',
            sessionId: agentResult.sessionId,
            turnCount: agentResult.turnCount,
            durationMs: agentResult.durationMs,
            costUsd: agentResult.costUsd,
            toolCallCount: agentResult.toolCallCount,
            toolSummaries: agentResult.toolSummaries,
            scoreResult,
          });
        }
      } catch (err) {
        console.error(`[skill-eval] task=${task.id} error:`, err);
        outputs.push({ taskId: task.id, score: 0 });
        scores.push(0);
        if (captureTraces) {
          trajectories.push({
            taskId: task.id,
            taskPrompt: task.taskPrompt,
            executor: 'anthropic-sdk',
            scoreResult: { error: String(err) },
          });
        }
      } finally {
        if (worktreeDir) {
          await removeWorktree(worktreeDir);
        }
      }
    }

    return {
      outputs,
      scores,
      trajectories: captureTraces ? trajectories : null,
    };
  }

  make_reflective_dataset(
    candidate: Readonly<Record<string, string>>,
    evalBatch: Readonly<AxGEPAEvaluationBatch<SkillEvalTrace, GpackOutput>>,
    componentsToUpdate: readonly string[],
  ): Record<string, unknown[]> {
    const { scorer } = this.options;
    const dataset: Record<string, unknown[]> = {};

    for (const component of componentsToUpdate) {
      dataset[component] = [];

      const traces = evalBatch.trajectories ?? [];
      const batchOutputs = evalBatch.outputs;

      for (let i = 0; i < batchOutputs.length; i++) {
        const output = batchOutputs[i];
        const trace = traces[i];
        const task = this.lastBatch.find((t) => t.id === output.taskId);
        if (!task) continue;

        const feedback =
          output.score >= 1
            ? `✅ All criteria passed (score=${output.score.toFixed(2)})`
            : scorer.toFeedback(trace?.scoreResult, task);

        dataset[component].push({
          Inputs: {
            task_id: output.taskId,
            task_prompt: task.taskPrompt,
            expected: task.expected,
          },
          'Generated Outputs': {
            score: output.score,
          },
          Feedback: feedback,
        });
      }
    }

    return dataset;
  }

  private async runAgent(
    worktreeDir: string,
    task: SkillEvalTask,
    mcpServers: Record<string, unknown>,
    agentName: string,
    claudeModel?: string,
  ): Promise<{
    sessionId?: string;
    turnCount?: number;
    durationMs?: number;
    costUsd?: number;
    toolCallCount?: number;
    toolSummaries?: string[];
  }> {
    let sessionId: string | undefined;
    let finalResult: ResultPayload | null = null;
    let toolCallCount = 0;
    const toolSummaries: string[] = [];

    const q = await createClaudeQuery({
      cwd: worktreeDir,
      prompt: task.taskPrompt,
      model: claudeModel,
      maxTurns: 30,
      clientApp: '@moltnet/tools:skill-eval',
      mcpServers,
      extraEnv: {
        GIT_CONFIG_GLOBAL: resolve(
          worktreeDir,
          '.moltnet',
          agentName,
          'gitconfig',
        ),
        MOLTNET_CREDENTIALS_PATH: resolve(
          worktreeDir,
          '.moltnet',
          agentName,
          'moltnet.json',
        ),
        ...task.env,
      },
    });

    try {
      for await (const message of q as AsyncIterable<SDKMessage>) {
        sessionId ??= message.session_id;
        if (message.type === 'assistant') {
          const payload = message as unknown as {
            message: { content: Array<{ type: string }> };
          };
          toolCallCount += payload.message.content.filter(
            (b) => b.type === 'tool_use',
          ).length;
        } else if (message.type === 'tool_use_summary') {
          toolSummaries.push(
            (message as unknown as { summary: string }).summary,
          );
        } else if (message.type === 'result') {
          finalResult = message as unknown as ResultPayload;
        }
      }
    } finally {
      q.close();
    }

    return {
      sessionId,
      turnCount: finalResult?.num_turns,
      durationMs: finalResult?.duration_ms,
      costUsd: finalResult?.total_cost_usd,
      toolCallCount,
      toolSummaries,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @moltnet/context-evals test -- --run src/skill-adapter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add libs/context-evals/src/skill-adapter.ts libs/context-evals/src/skill-adapter.test.ts
git commit -m "feat(context-evals): add SkillEvalAdapter with worktree lifecycle and GEPA integration"
```

---

### Task 4: Update exports and add `./process` subpath

**Files:**

- Modify: `libs/context-evals/src/index.ts`
- Modify: `libs/context-evals/package.json`

- [ ] **Step 1: Add exports for new skill eval types**

Append to `libs/context-evals/src/index.ts`:

```typescript
export { assembleSkill, SkillEvalAdapter } from './skill-adapter.js';
export {
  type SkillEvalAdapterOptions,
  type SkillEvalTask,
  SkillEvalTaskSchema,
  type SkillEvalTrace,
  type SkillScorer,
} from './skill-types.js';
// Re-export process helpers for use by external scorers
export { execFileText, runShellCommand } from './process.js';
```

- [ ] **Step 2: Add `./process` subpath export to `package.json`**

Add to `libs/context-evals/package.json` exports:

```json
"./process": {
  "import": "./src/process.ts",
  "types": "./src/process.ts"
}
```

This allows `tools/` scorers to `import { runShellCommand } from '@moltnet/context-evals/process'` or `from '@moltnet/context-evals'` without broken import paths.

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @moltnet/context-evals typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add libs/context-evals/src/index.ts
git commit -m "feat(context-evals): export skill eval types and adapter"
```

---

## Chunk 2: LeGreffier-Specific Code

### Task 5: LeGreffier types and skill section boundaries

**Files:**

- Create: `tools/src/skill-evals/legreffier/types.ts`
- Create: `tools/src/skill-evals/legreffier/skill-sections.ts`

The SKILL.md split boundaries (from reading the file):

- **PREAMBLE**: lines 1–332 (frontmatter through "## Session activation" section 7, ending before "## Accountable commit workflow")
- **COMMIT SECTION** (GEPA-variable): lines 333–455 ("## Accountable commit workflow" through "## Hard gate: no ship without diary" including "### Pre-push checklist")
- **EPILOGUE**: lines 456–602 ("## Semantic entry workflow" through end of file)

- [ ] **Step 1: Create types**

```typescript
// tools/src/skill-evals/legreffier/types.ts

export interface CommitExpected {
  /** Expected conventional commit type (feat, fix, test, chore, docs). */
  commitType: string;
  /** Expected risk level from the skill's classification. */
  riskLevel: 'low' | 'medium' | 'high';
  /** Expected scope(s) for tags. */
  scopes: string[];
  /** Whether this is a task-chain eval (Group 2). */
  isChain?: boolean;
  /** For chains: expected number of commits. */
  expectedCommitCount?: number;
}

export interface CommitScoreResult {
  total: number; // 0.0 to 1.0
  tiers: {
    mustHave: boolean;
    shouldHave: boolean;
    niceToHave: boolean;
  };
  details: string[];
  commitMessages: string[];
  diaryEntryIds: string[];
  diaryEntryContent: string[];
}
```

- [ ] **Step 2: Create skill sections**

Read the current SKILL.md at the pinned commit and extract the three sections. The boundaries use markdown headings as delimiters.

```typescript
// tools/src/skill-evals/legreffier/skill-sections.ts
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Split SKILL.md into PREAMBLE, COMMIT_SECTION, and EPILOGUE.
 *
 * Boundaries:
 * - PREAMBLE: everything before "## Accountable commit workflow"
 * - COMMIT_SECTION: from "## Accountable commit workflow" through
 *   the line before "## Semantic entry workflow"
 * - EPILOGUE: from "## Semantic entry workflow" to end of file
 */
export async function loadSkillSections(
  skillPath: string,
): Promise<{ preamble: string; commitSection: string; epilogue: string }> {
  const content = await readFile(skillPath, 'utf8');
  return splitSkillContent(content);
}

export function splitSkillContent(content: string): {
  preamble: string;
  commitSection: string;
  epilogue: string;
} {
  const commitStart = content.indexOf('\n## Accountable commit workflow');
  if (commitStart === -1) {
    throw new Error(
      'SKILL.md missing "## Accountable commit workflow" heading',
    );
  }

  const epilogueStart = content.indexOf('\n## Semantic entry workflow');
  if (epilogueStart === -1) {
    throw new Error('SKILL.md missing "## Semantic entry workflow" heading');
  }

  return {
    preamble: content.slice(0, commitStart + 1), // include trailing newline
    commitSection: content.slice(commitStart + 1, epilogueStart + 1),
    epilogue: content.slice(epilogueStart + 1),
  };
}
```

- [ ] **Step 3: Write test for splitSkillContent**

```typescript
// tools/src/skill-evals/legreffier/skill-sections.test.ts
import { describe, expect, it } from 'vitest';

import { splitSkillContent } from './skill-sections.js';

const MOCK_SKILL = `# LeGreffier Skill
## Agent name
Some agent name content.
## Session activation
Session steps.
## Accountable commit workflow
Step 0. Resolve credentials.
Step 1. Inspect staged changes.
## Hard gate: no ship without diary
Gate content.
## Semantic entry workflow
Semantic content.
## Episodic entry workflow
Episodic content.
## Reminders
Reminder content.
`;

describe('splitSkillContent', () => {
  it('splits at the correct boundaries', () => {
    const { preamble, commitSection, epilogue } = splitSkillContent(MOCK_SKILL);
    expect(preamble).toContain('## Session activation');
    expect(preamble).not.toContain('## Accountable commit workflow');
    expect(commitSection).toContain('## Accountable commit workflow');
    expect(commitSection).toContain('## Hard gate');
    expect(commitSection).not.toContain('## Semantic entry workflow');
    expect(epilogue).toContain('## Semantic entry workflow');
    expect(epilogue).toContain('## Reminders');
  });

  it('throws if commit heading is missing', () => {
    expect(() =>
      splitSkillContent('# No commit section\n## Semantic entry workflow\n'),
    ).toThrow('Accountable commit workflow');
  });

  it('throws if epilogue heading is missing', () => {
    expect(() =>
      splitSkillContent('# Skill\n## Accountable commit workflow\nStuff.\n'),
    ).toThrow('Semantic entry workflow');
  });
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @moltnet/tools test -- --run src/skill-evals/legreffier/skill-sections.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/src/skill-evals/legreffier/types.ts tools/src/skill-evals/legreffier/skill-sections.ts tools/src/skill-evals/legreffier/skill-sections.test.ts
git commit -m "feat(tools): add LeGreffier skill eval types and SKILL.md section splitter"
```

---

### Task 6: CommitScorer

**Files:**

- Create: `tools/src/skill-evals/legreffier/commit-scorer.ts`
- Test: `tools/src/skill-evals/legreffier/commit-scorer.test.ts`

- [ ] **Step 1: Write the failing test**

Test the pure scoring logic using mock git log output and mock API responses. The scorer calls:

1. `git log` in the worktree to extract commit messages + trailers
2. REST API `entries_list` to find diary entries by tags
3. REST API `entries/:id/verify` for signature verification

We mock the shell commands and HTTP calls.

```typescript
// tools/src/skill-evals/legreffier/commit-scorer.test.ts
import { describe, expect, it, vi } from 'vitest';

import { scoreCommitTiers } from './commit-scorer.js';

describe('scoreCommitTiers', () => {
  it('returns 1.0 when all tiers pass (Group 1)', () => {
    const result = scoreCommitTiers({
      commitMessages: [
        'fix(diary-service): fix pagination offset\n\nMoltNet-Diary: abc-123',
      ],
      diaryEntries: [
        {
          id: 'abc-123',
          entryType: 'procedural',
          tags: [
            'accountable-commit',
            'risk:medium',
            'branch:eval',
            'scope:diary',
          ],
          content:
            '<moltnet-signed><content>rationale</content><metadata>signer: ABCD\noperator: edouard\ntool: claude\nrisk-level: medium\nfiles-changed: 2\nrefs: libs/diary-service/src/pagination.ts\ntimestamp: 2026-03-13T00:00:00Z\nbranch: eval\nscope: scope:diary</metadata><signature>base64sig==</signature></moltnet-signed>',
          signatureValid: true,
        },
      ],
      expected: {
        commitType: 'fix',
        riskLevel: 'medium',
        scopes: ['scope:diary'],
        isChain: false,
      },
    });

    expect(result.total).toBe(1.0);
    expect(result.tiers.mustHave).toBe(true);
    expect(result.tiers.shouldHave).toBe(true);
    expect(result.tiers.niceToHave).toBe(true);
  });

  it('returns 0.6 when only must-have passes', () => {
    const result = scoreCommitTiers({
      commitMessages: ['fix(diary): fix pagination\n\nMoltNet-Diary: abc-123'],
      diaryEntries: [
        {
          id: 'abc-123',
          entryType: 'semantic', // wrong type
          tags: ['accountable-commit'], // missing risk, branch
          content: 'no metadata block',
          signatureValid: false,
        },
      ],
      expected: {
        commitType: 'fix',
        riskLevel: 'medium',
        scopes: ['scope:diary'],
        isChain: false,
      },
    });

    expect(result.total).toBe(0.6);
    expect(result.tiers.mustHave).toBe(true);
    expect(result.tiers.shouldHave).toBe(false);
    expect(result.tiers.niceToHave).toBe(false);
  });

  it('returns 0 when must-have fails (no diary entry)', () => {
    const result = scoreCommitTiers({
      commitMessages: ['fix(diary): fix pagination'],
      diaryEntries: [],
      expected: {
        commitType: 'fix',
        riskLevel: 'medium',
        scopes: ['scope:diary'],
        isChain: false,
      },
    });

    expect(result.total).toBe(0);
    expect(result.tiers.mustHave).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @moltnet/tools test -- --run src/skill-evals/legreffier/commit-scorer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement CommitScorer**

```typescript
// tools/src/skill-evals/legreffier/commit-scorer.ts
import type { SkillEvalTask, SkillScorer } from '@moltnet/context-evals';

import type { CommitExpected, CommitScoreResult } from './types.js';

// ── Pure scoring function (testable without I/O) ──────────────────────────────

interface DiaryEntryInfo {
  id: string;
  entryType: string;
  tags: string[];
  content: string;
  signatureValid: boolean;
}

interface ScoreInput {
  commitMessages: string[];
  diaryEntries: DiaryEntryInfo[];
  expected: CommitExpected;
}

export function scoreCommitTiers(input: ScoreInput): CommitScoreResult {
  const { commitMessages, diaryEntries, expected } = input;
  const details: string[] = [];

  // ── Must-have (60%) ──────────────────────────────────────────
  // 1. At least one diary entry exists
  const hasDiaryEntry = diaryEntries.length > 0;
  details.push(
    hasDiaryEntry ? '✅ Diary entry exists' : '❌ No diary entry found',
  );

  // 2. MoltNet-Diary trailer in commit message
  const hasTrailer = commitMessages.some((msg) =>
    /MoltNet-Diary:\s*\S+/.test(msg),
  );
  details.push(
    hasTrailer
      ? '✅ MoltNet-Diary trailer present'
      : '❌ Missing MoltNet-Diary trailer',
  );

  const mustHave = hasDiaryEntry && hasTrailer;

  // ── Should-have (30%) ────────────────────────────────────────
  let shouldHave = false;
  if (mustHave && diaryEntries.length > 0) {
    const entry = diaryEntries[0];

    const hasAccountableTag = entry.tags.includes('accountable-commit');
    details.push(
      hasAccountableTag
        ? '✅ accountable-commit tag'
        : `❌ Missing accountable-commit tag (found: ${entry.tags.join(', ')})`,
    );

    const hasRiskTag = entry.tags.some((t) => t.startsWith('risk:'));
    details.push(
      hasRiskTag
        ? '✅ risk:<level> tag present'
        : '❌ Missing risk:<level> tag',
    );

    const hasBranchTag = entry.tags.some((t) => t.startsWith('branch:'));
    details.push(
      hasBranchTag
        ? '✅ branch:<branch> tag present'
        : '❌ Missing branch:<branch> tag',
    );

    const isProcedural = entry.entryType === 'procedural';
    details.push(
      isProcedural
        ? '✅ entry_type is procedural'
        : `❌ entry_type is "${entry.entryType}" (expected procedural)`,
    );

    shouldHave =
      hasAccountableTag && hasRiskTag && hasBranchTag && isProcedural;
  }

  // ── Nice-to-have (10%) ───────────────────────────────────────
  let niceToHave = false;
  if (shouldHave && diaryEntries.length > 0) {
    const entry = diaryEntries[0];

    const hasSig = entry.signatureValid;
    details.push(
      hasSig ? '✅ Signature valid' : '❌ Signature missing or invalid',
    );

    const hasMetadata =
      /\brefs:/.test(entry.content) &&
      /\boperator:/.test(entry.content) &&
      /\btool:/.test(entry.content) &&
      /\btimestamp:/.test(entry.content);
    details.push(
      hasMetadata
        ? '✅ Metadata block complete'
        : '❌ Metadata block incomplete',
    );

    niceToHave = hasSig && hasMetadata;
  }

  const total =
    (mustHave ? 0.6 : 0) + (shouldHave ? 0.3 : 0) + (niceToHave ? 0.1 : 0);

  return {
    total,
    tiers: { mustHave, shouldHave, niceToHave },
    details,
    commitMessages,
    diaryEntryIds: diaryEntries.map((e) => e.id),
    diaryEntryContent: diaryEntries.map((e) => e.content),
  };
}

// ── Full scorer (with I/O: reads git log, calls REST API) ─────────────────────

export class CommitScorer implements SkillScorer<
  CommitExpected,
  CommitScoreResult
> {
  constructor(
    private apiBaseUrl: string,
    private diaryId: string,
    private clientId: string,
    private clientSecret: string,
  ) {}

  /** Acquire an OAuth2 access token for REST API calls. */
  private async getAccessToken(): Promise<string> {
    const res = await fetch(`${this.apiBaseUrl}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: 'diary:read diary:write crypto:sign agent:profile',
      }),
    });
    const data = (await res.json()) as { access_token: string };
    return data.access_token;
  }

  async score(
    worktreeDir: string,
    expected: CommitExpected,
  ): Promise<CommitScoreResult> {
    // Import process helpers via the subpath export added in Task 4
    const { runShellCommand } = await import('@moltnet/context-evals/process');

    const token = await this.getAccessToken();
    const authHeaders = { Authorization: `Bearer ${token}` };

    // 1. Get commit messages
    const gitLog = await runShellCommand(
      'git log --format="%B---COMMIT_SEP---" -10',
      worktreeDir,
      30_000,
    );
    const commitMessages = gitLog.output
      .split('---COMMIT_SEP---')
      .map((m) => m.trim())
      .filter(Boolean);

    // 2. List diary entries (authenticated)
    const entriesRes = await fetch(
      `${this.apiBaseUrl}/diaries/${this.diaryId}/entries?tags=accountable-commit&limit=10`,
      { headers: authHeaders },
    );
    const entriesData = (await entriesRes.json()) as {
      items: Array<{
        id: string;
        entryType: string;
        tags: string[];
        content: string;
      }>;
    };

    // 3. Verify signatures (authenticated)
    const diaryEntries: DiaryEntryInfo[] = await Promise.all(
      (entriesData.items ?? []).map(async (entry) => {
        let signatureValid = false;
        try {
          const verifyRes = await fetch(
            `${this.apiBaseUrl}/entries/${entry.id}/verify`,
            { headers: authHeaders },
          );
          const verifyData = (await verifyRes.json()) as { valid?: boolean };
          signatureValid = verifyData.valid === true;
        } catch {
          // signature verification failed
        }
        return {
          id: entry.id,
          entryType: entry.entryType,
          tags: entry.tags,
          content: entry.content,
          signatureValid,
        };
      }),
    );

    return scoreCommitTiers({ commitMessages, diaryEntries, expected });
  }

  toNumeric(result: CommitScoreResult): number {
    return result.total;
  }

  toFeedback(result: CommitScoreResult, task: SkillEvalTask): string {
    const sections: string[] = [];

    // Group failed details by tier for clear GEPA feedback
    // Details are ordered: must-have items first, then should-have, then nice-to-have
    // Must-have: indices 0-1 (diary entry exists, MoltNet-Diary trailer)
    // Should-have: indices 2-5 (accountable-commit tag, risk tag, branch tag, procedural type)
    // Nice-to-have: indices 6-7 (signature, metadata block)
    const mustHaveDetails = result.details
      .slice(0, 2)
      .filter((d) => d.startsWith('❌'));
    const shouldHaveDetails = result.details
      .slice(2, 6)
      .filter((d) => d.startsWith('❌'));
    const niceToHaveDetails = result.details
      .slice(6)
      .filter((d) => d.startsWith('❌'));

    if (!result.tiers.mustHave && mustHaveDetails.length > 0) {
      sections.push(
        'MUST-HAVE FAILED:',
        ...mustHaveDetails.map((d) => `  ${d}`),
      );
    }
    if (!result.tiers.shouldHave && shouldHaveDetails.length > 0) {
      sections.push(
        'SHOULD-HAVE FAILED:',
        ...shouldHaveDetails.map((d) => `  ${d}`),
      );
    }
    if (!result.tiers.niceToHave && niceToHaveDetails.length > 0) {
      sections.push(
        'NICE-TO-HAVE FAILED:',
        ...niceToHaveDetails.map((d) => `  ${d}`),
      );
    }

    if (result.commitMessages.length > 0) {
      sections.push(
        `\nACTUAL COMMIT MESSAGE:\n${result.commitMessages[0].slice(0, 500)}`,
      );
    }

    if (result.diaryEntryContent.length > 0) {
      sections.push(
        `\nACTUAL ENTRY CONTENT (truncated):\n${result.diaryEntryContent[0].slice(0, 500)}`,
      );
    }

    return sections.join('\n');
  }
}
```

Note: The `CommitScorer.score()` method imports `runShellCommand` via the `@moltnet/context-evals/process` subpath export added in Task 4. This is one of the rare legitimate cases for dynamic import — the scorer runs in a different package (`@moltnet/tools`) and the import is resolved at runtime. The pure `scoreCommitTiers` function is statically imported and fully tested.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @moltnet/tools test -- --run src/skill-evals/legreffier/commit-scorer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/src/skill-evals/legreffier/commit-scorer.ts tools/src/skill-evals/legreffier/commit-scorer.test.ts
git commit -m "feat(tools): add CommitScorer with tiered rubric for accountable commit eval"
```

---

### Task 6b: ChainScorer for Group 2 task-chain trailers

**Files:**

- Create: `tools/src/skill-evals/legreffier/chain-scorer.ts`
- Test: `tools/src/skill-evals/legreffier/chain-scorer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tools/src/skill-evals/legreffier/chain-scorer.test.ts
import { describe, expect, it } from 'vitest';

import { scoreChainTiers } from './chain-scorer.js';

describe('scoreChainTiers', () => {
  it('returns 1.0 when all chain criteria pass', () => {
    const result = scoreChainTiers({
      commitMessages: [
        'fix(diary): fix pagination\n\nTask-Group: bugfix-pagination\nTask-Family: bugfix\nMoltNet-Diary: entry-1',
        'chore(diary): clean error message\n\nTask-Group: bugfix-pagination\nMoltNet-Diary: entry-2',
        'test(diary): add regression test\n\nTask-Group: bugfix-pagination\nTask-Completes: true\nMoltNet-Diary: entry-3',
      ],
      diaryEntries: [
        {
          id: 'entry-1',
          entryType: 'procedural',
          tags: [
            'accountable-commit',
            'risk:medium',
            'branch:eval',
            'scope:diary',
          ],
          content:
            '<metadata>operator: edouard\ntool: claude\nrefs: file.ts\ntimestamp: 2026-03-13T00:00:00Z</metadata>',
          signatureValid: true,
        },
        {
          id: 'entry-2',
          entryType: 'procedural',
          tags: [
            'accountable-commit',
            'risk:medium',
            'branch:eval',
            'scope:diary',
          ],
          content:
            '<metadata>operator: edouard\ntool: claude\nrefs: file.ts\ntimestamp: 2026-03-13T00:00:00Z</metadata>',
          signatureValid: true,
        },
        {
          id: 'entry-3',
          entryType: 'procedural',
          tags: [
            'accountable-commit',
            'risk:low',
            'branch:eval',
            'scope:diary',
          ],
          content:
            '<metadata>operator: edouard\ntool: claude\nrefs: file.ts\ntimestamp: 2026-03-13T00:00:00Z</metadata>',
          signatureValid: true,
        },
      ],
      expected: {
        commitType: 'fix',
        riskLevel: 'medium',
        scopes: ['scope:diary'],
        isChain: true,
        expectedCommitCount: 3,
      },
    });

    expect(result.total).toBe(1.0);
  });

  it('fails must-have if Task-Group is inconsistent', () => {
    const result = scoreChainTiers({
      commitMessages: [
        'fix(diary): fix\n\nTask-Group: slug-a\nMoltNet-Diary: e1',
        'chore(diary): clean\n\nTask-Group: slug-b\nMoltNet-Diary: e2',
        'test(diary): test\n\nTask-Group: slug-a\nTask-Completes: true\nMoltNet-Diary: e3',
      ],
      diaryEntries: [
        {
          id: 'e1',
          entryType: 'procedural',
          tags: ['accountable-commit', 'risk:medium', 'branch:eval'],
          content: '',
          signatureValid: false,
        },
        {
          id: 'e2',
          entryType: 'procedural',
          tags: ['accountable-commit', 'risk:medium', 'branch:eval'],
          content: '',
          signatureValid: false,
        },
        {
          id: 'e3',
          entryType: 'procedural',
          tags: ['accountable-commit', 'risk:low', 'branch:eval'],
          content: '',
          signatureValid: false,
        },
      ],
      expected: {
        commitType: 'fix',
        riskLevel: 'medium',
        scopes: ['scope:diary'],
        isChain: true,
        expectedCommitCount: 3,
      },
    });

    expect(result.tiers.mustHave).toBe(false);
    expect(result.total).toBe(0);
  });

  it('fails must-have if Task-Completes not on last commit', () => {
    const result = scoreChainTiers({
      commitMessages: [
        'fix(diary): fix\n\nTask-Group: slug\nTask-Completes: true\nMoltNet-Diary: e1',
        'test(diary): test\n\nTask-Group: slug\nMoltNet-Diary: e2',
      ],
      diaryEntries: [
        {
          id: 'e1',
          entryType: 'procedural',
          tags: ['accountable-commit', 'risk:medium', 'branch:eval'],
          content: '',
          signatureValid: false,
        },
        {
          id: 'e2',
          entryType: 'procedural',
          tags: ['accountable-commit', 'risk:low', 'branch:eval'],
          content: '',
          signatureValid: false,
        },
      ],
      expected: {
        commitType: 'fix',
        riskLevel: 'medium',
        scopes: ['scope:diary'],
        isChain: true,
        expectedCommitCount: 2,
      },
    });

    expect(result.tiers.mustHave).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @moltnet/tools test -- --run src/skill-evals/legreffier/chain-scorer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ChainScorer**

```typescript
// tools/src/skill-evals/legreffier/chain-scorer.ts
import type { SkillEvalTask, SkillScorer } from '@moltnet/context-evals';

import {
  type CommitScoreResult,
  scoreCommitTiers,
  type DiaryEntryInfo,
} from './commit-scorer.js';
import type { CommitExpected } from './types.js';

interface ChainScoreInput {
  commitMessages: string[];
  diaryEntries: DiaryEntryInfo[];
  expected: CommitExpected;
}

function extractTrailer(msg: string, key: string): string | undefined {
  const match = msg.match(new RegExp(`${key}:\\s*(.+)`, 'm'));
  return match?.[1]?.trim();
}

/**
 * Score a task-chain across multiple commits.
 * Extends Group 1 scoring with chain-specific must-have and should-have criteria.
 */
export function scoreChainTiers(input: ChainScoreInput): CommitScoreResult {
  const { commitMessages, diaryEntries, expected } = input;
  const details: string[] = [];

  // ── Must-have (60%) ──────────────────────────────────────────
  const allHaveTrailers = commitMessages.every((msg) =>
    /MoltNet-Diary:\s*\S+/.test(msg),
  );
  const hasEnoughEntries =
    diaryEntries.length >=
    (expected.expectedCommitCount ?? commitMessages.length);
  details.push(
    allHaveTrailers
      ? '✅ All commits have MoltNet-Diary trailer'
      : '❌ Some commits missing MoltNet-Diary trailer',
  );
  details.push(
    hasEnoughEntries
      ? `✅ ${diaryEntries.length} diary entries found`
      : `❌ Expected ${expected.expectedCommitCount} entries, found ${diaryEntries.length}`,
  );

  const taskGroups = commitMessages.map((msg) =>
    extractTrailer(msg, 'Task-Group'),
  );
  const uniqueGroups = new Set(taskGroups.filter(Boolean));
  const consistentGroup = uniqueGroups.size === 1 && taskGroups.every(Boolean);
  details.push(
    consistentGroup
      ? `✅ Task-Group consistent: ${[...uniqueGroups][0]}`
      : `❌ Task-Group inconsistent: ${JSON.stringify(taskGroups)}`,
  );

  const completesFlags = commitMessages.map((msg) =>
    extractTrailer(msg, 'Task-Completes'),
  );
  const lastHasCompletes = completesFlags.at(-1) === 'true';
  const onlyLastHasCompletes =
    completesFlags.slice(0, -1).every((f) => !f) && lastHasCompletes;
  details.push(
    onlyLastHasCompletes
      ? '✅ Task-Completes: true on last commit only'
      : `❌ Task-Completes placement wrong: ${JSON.stringify(completesFlags)}`,
  );

  const mustHave =
    allHaveTrailers &&
    hasEnoughEntries &&
    consistentGroup &&
    onlyLastHasCompletes;

  // ── Should-have (30%) ────────────────────────────────────────
  let shouldHave = false;
  if (mustHave) {
    const allProcedural = diaryEntries.every(
      (e) => e.entryType === 'procedural',
    );
    details.push(
      allProcedural
        ? '✅ All entries are procedural'
        : '❌ Some entries not procedural',
    );

    const allHaveRequiredTags = diaryEntries.every(
      (e) =>
        e.tags.includes('accountable-commit') &&
        e.tags.some((t) => t.startsWith('risk:')) &&
        e.tags.some((t) => t.startsWith('branch:')),
    );
    details.push(
      allHaveRequiredTags
        ? '✅ All entries have required tags'
        : '❌ Some entries missing tags',
    );

    const firstHasFamily = !!extractTrailer(commitMessages[0], 'Task-Family');
    details.push(
      firstHasFamily
        ? '✅ Task-Family on first commit'
        : '❌ Missing Task-Family on first commit',
    );

    const othersLackFamily = commitMessages
      .slice(1)
      .every((msg) => !extractTrailer(msg, 'Task-Family'));
    details.push(
      othersLackFamily
        ? '✅ Task-Family absent from non-first commits'
        : '❌ Task-Family found on non-first commit',
    );

    shouldHave =
      allProcedural &&
      allHaveRequiredTags &&
      firstHasFamily &&
      othersLackFamily;
  }

  // ── Nice-to-have (10%) ───────────────────────────────────────
  let niceToHave = false;
  if (shouldHave) {
    const allSigned = diaryEntries.every((e) => e.signatureValid);
    const allHaveMetadata = diaryEntries.every(
      (e) =>
        /\brefs:/.test(e.content) &&
        /\boperator:/.test(e.content) &&
        /\btool:/.test(e.content) &&
        /\btimestamp:/.test(e.content),
    );
    details.push(
      allSigned
        ? '✅ All signatures valid'
        : '❌ Some signatures missing/invalid',
    );
    details.push(
      allHaveMetadata
        ? '✅ All metadata blocks complete'
        : '❌ Some metadata blocks incomplete',
    );
    niceToHave = allSigned && allHaveMetadata;
  }

  const total =
    (mustHave ? 0.6 : 0) + (shouldHave ? 0.3 : 0) + (niceToHave ? 0.1 : 0);

  return {
    total,
    tiers: { mustHave, shouldHave, niceToHave },
    details,
    commitMessages,
    diaryEntryIds: diaryEntries.map((e) => e.id),
    diaryEntryContent: diaryEntries.map((e) => e.content),
  };
}
```

The `CommitScorer.score()` method should dispatch to `scoreChainTiers()` when `expected.isChain === true`. Add this branch at the end of `score()`:

```typescript
if (expected.isChain) {
  const { scoreChainTiers } = await import('./chain-scorer.js');
  return scoreChainTiers({ commitMessages, diaryEntries, expected });
}
return scoreCommitTiers({ commitMessages, diaryEntries, expected });
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @moltnet/tools test -- --run src/skill-evals/legreffier/chain-scorer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/src/skill-evals/legreffier/chain-scorer.ts tools/src/skill-evals/legreffier/chain-scorer.test.ts
git commit -m "feat(tools): add ChainScorer for Group 2 task-chain trailer validation"
```

---

### Task 7: Eval environment setup script

**Files:**

- Create: `tools/src/skill-evals/legreffier/eval-setup.ts`
- Modify: `tools/package.json` (add scripts)

This script:

1. Starts the e2e docker stack
2. Bootstraps a genesis eval agent via `@moltnet/bootstrap`
3. Writes `.moltnet/eval-agent/` (moltnet.json, gitconfig, SSH keys)
4. Creates a diary via REST API
5. Writes `.eval-env.json` with credentials for the eval runner

- [ ] **Step 1: Implement eval-setup.ts**

```typescript
// tools/src/skill-evals/legreffier/eval-setup.ts
/* eslint-disable no-console */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  bootstrapGenesisAgents,
  type BootstrapConfig,
} from '@moltnet/bootstrap';
import { createDatabase } from '@moltnet/database';
import { writeConfig } from '@themoltnet/sdk';
import { exportSSHKey } from '@themoltnet/sdk';

const { values } = parseArgs({
  options: {
    teardown: { type: 'boolean', default: false },
    'repo-root': { type: 'string' },
  },
  strict: false,
});

const repoRoot = values['repo-root'] ?? process.cwd();

// ── Ports matching docker-compose.e2e.yaml ────────────────────
const DB_URL = 'postgresql://moltnet:moltnet_secret@localhost:5433/moltnet';
const API_URL = 'http://localhost:8080';
const MCP_URL = 'http://localhost:8001/mcp';
const KRATOS_ADMIN = 'http://localhost:4434';
const HYDRA_ADMIN = 'http://localhost:4445';
const HYDRA_PUBLIC = API_URL; // Hydra public goes through the combined server
const KETO_READ = 'http://localhost:4466';
const KETO_WRITE = 'http://localhost:4467';

const AGENT_NAME = 'eval-agent';
const SCOPES = 'diary:read diary:write crypto:sign agent:profile';

async function waitForHealth(url: string, maxWaitMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Health check timed out for ${url}`);
}

async function setup(): Promise<void> {
  console.log('[eval-setup] Waiting for e2e stack health...');
  await waitForHealth(API_URL);
  console.log('[eval-setup] REST API healthy');

  // 1. Bootstrap genesis agent
  const { db, pool } = createDatabase(DB_URL);
  const bootstrapConfig: BootstrapConfig = {
    databaseUrl: DB_URL,
    ory: {
      mode: 'split',
      kratosAdminUrl: KRATOS_ADMIN,
      hydraAdminUrl: HYDRA_ADMIN,
      hydraPublicUrl: HYDRA_PUBLIC,
      ketoReadUrl: KETO_READ,
      ketoWriteUrl: KETO_WRITE,
    },
  };

  const result = await bootstrapGenesisAgents({
    config: bootstrapConfig,
    db,
    names: [AGENT_NAME],
    scopes: SCOPES,
    log: (msg) => console.log(`[eval-setup] ${msg}`),
  });

  if (result.agents.length === 0) {
    const errorMsg = result.errors.map((e) => e.error).join('; ');
    throw new Error(`Bootstrap failed: ${errorMsg}`);
  }

  const agent = result.agents[0];
  console.log(
    `[eval-setup] Agent bootstrapped: ${agent.name} (${agent.keyPair.fingerprint})`,
  );

  // 2. Write .moltnet/eval-agent/ config
  const configDir = resolve(repoRoot, '.moltnet', AGENT_NAME);
  await mkdir(configDir, { recursive: true });

  await writeConfig(
    {
      identity_id: agent.identityId,
      registered_at: new Date().toISOString(),
      oauth2: {
        client_id: agent.clientId,
        client_secret: agent.clientSecret,
      },
      keys: {
        public_key: agent.keyPair.publicKey,
        private_key: agent.keyPair.privateKey,
        fingerprint: agent.keyPair.fingerprint,
      },
      endpoints: {
        api: API_URL,
        mcp: MCP_URL,
      },
    },
    configDir,
  );

  // 3. Export SSH keys
  await exportSSHKey({ configDir });

  // 4. Write gitconfig
  const sshKeyPath = resolve(configDir, 'ssh', 'id_ed25519.pub');
  const email = `${agent.identityId}+${AGENT_NAME}[bot]@users.noreply.github.com`;
  const gitconfigContent = [
    '[user]',
    `\tname = ${AGENT_NAME}`,
    `\temail = ${email}`,
    '[gpg]',
    '\tformat = ssh',
    '[gpg "ssh"]',
    `\tsigningKey = ${sshKeyPath}`,
    '[commit]',
    '\tgpgsign = true',
    '',
  ].join('\n');
  await writeFile(resolve(configDir, 'gitconfig'), gitconfigContent, 'utf8');

  // 5. Create diary via REST API
  const tokenRes = await fetch(`${API_URL}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: agent.clientId,
      client_secret: agent.clientSecret,
      scope: SCOPES,
    }),
  });
  const tokenData = (await tokenRes.json()) as { access_token: string };

  const diaryRes = await fetch(`${API_URL}/diaries`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenData.access_token}`,
    },
    body: JSON.stringify({ name: 'eval-workspace', visibility: 'moltnet' }),
  });
  const diaryData = (await diaryRes.json()) as { id: string };
  console.log(`[eval-setup] Diary created: ${diaryData.id}`);

  // 6. Write .eval-env.json
  const evalEnv = {
    agentName: AGENT_NAME,
    clientId: agent.clientId,
    clientSecret: agent.clientSecret,
    diaryId: diaryData.id,
    fingerprint: agent.keyPair.fingerprint,
    apiUrl: API_URL,
    mcpUrl: MCP_URL,
    configDir,
  };
  await writeFile(
    resolve(repoRoot, '.eval-env.json'),
    JSON.stringify(evalEnv, null, 2),
    'utf8',
  );
  console.log(`[eval-setup] Eval env written to .eval-env.json`);

  await pool.end();
  console.log('[eval-setup] Done.');
}

async function teardown(): Promise<void> {
  console.log(
    '[eval-teardown] Nothing to clean — docker compose down handles it.',
  );
}

if (values['teardown']) {
  teardown().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  setup().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Add scripts and `@themoltnet/sdk` dependency to tools/package.json**

Add to `tools/package.json` scripts:

```json
"eval:setup": "tsx src/skill-evals/legreffier/eval-setup.ts",
"eval:teardown": "tsx src/skill-evals/legreffier/eval-setup.ts --teardown"
```

Add to `tools/package.json` dependencies:

```json
"@themoltnet/sdk": "workspace:*"
```

This is required because `eval-setup.ts` imports `writeConfig` and `exportSSHKey` from `@themoltnet/sdk`.

- [ ] **Step 3: Add root-level script aliases to `package.json`**

The spec's example commands use root-level `pnpm eval:setup`, `pnpm eval:teardown`, and `pnpm gpack:skill-eval`. Add these as passthrough scripts to the root `package.json`:

```json
"eval:setup": "pnpm --filter @moltnet/tools eval:setup",
"eval:teardown": "pnpm --filter @moltnet/tools eval:teardown",
"gpack:skill-eval": "pnpm --filter @moltnet/tools gpack -- --skill-eval"
```

This ensures the spec's documented commands work from the repo root.

- [ ] **Step 4: Add `.eval-env.json` and `.moltnet/eval-agent/` to `.gitignore`**

Append to the root `.gitignore`:

```
.eval-env.json
.moltnet/eval-agent/
```

- [ ] **Step 5: Verify typecheck passes**

Run: `pnpm --filter @moltnet/tools typecheck`
Expected: PASS (or known pre-existing errors only)

- [ ] **Step 6: Commit**

```bash
git add tools/src/skill-evals/legreffier/eval-setup.ts tools/package.json package.json .gitignore
git commit -m "feat(tools): add eval:setup script for LeGreffier skill eval environment"
```

---

## Chunk 3: Eval Task Definitions

### Task 8: Create synthetic patch diffs and scenario files

**Files:**

- Create: `evals/legreffier-commit-feat/scenario.json`
- Create: `evals/legreffier-commit-feat/task.md`
- Create: `evals/legreffier-commit-feat/patch.diff`
- Create: (same pattern for fix, test, chore, docs)
- Create: `evals/legreffier-chain-fix-chore-test/scenario.json`
- Create: `evals/legreffier-chain-fix-chore-test/task.md`
- Create: `evals/legreffier-chain-fix-chore-test/patch-1-fix.diff` (etc.)

The scenario.json schema for skill evals differs from gpack scenarios. It uses `SkillEvalTaskSchema` fields:

```json
{
  "baseCommit": "6486435",
  "expected": {
    "commitType": "feat",
    "riskLevel": "medium",
    "scopes": ["scope:observability"]
  },
  "id": "legreffier-commit-feat",
  "patchFiles": ["evals/legreffier-commit-feat/patch.diff"],
  "skillPath": ".claude/skills/legreffier/SKILL.md",
  "taskPrompt": "I've added a health detail function to the observability lib. Commit using legreffier."
}
```

- [ ] **Step 1: Create feat eval**

`evals/legreffier-commit-feat/scenario.json` — as above.

`evals/legreffier-commit-feat/task.md`:

```
I've added a health detail function to the observability lib. Commit using legreffier.
```

`evals/legreffier-commit-feat/patch.diff` — synthetic diff adding a `healthDetail()` function to `libs/observability/src/health.ts`:

```diff
diff --git a/libs/observability/src/health.ts b/libs/observability/src/health.ts
new file mode 100644
index 0000000..abcdef1
--- /dev/null
+++ b/libs/observability/src/health.ts
@@ -0,0 +1,22 @@
+/**
+ * Health detail helper — returns structured health info for
+ * downstream monitoring dashboards.
+ */
+
+export interface HealthDetail {
+  service: string;
+  version: string;
+  uptime: number;
+  checks: Record<string, { status: 'ok' | 'degraded' | 'down'; latencyMs?: number }>;
+}
+
+export function healthDetail(
+  service: string,
+  version: string,
+  startTime: number,
+  checks: HealthDetail['checks'] = {},
+): HealthDetail {
+  return {
+    service,
+    version,
+    uptime: Date.now() - startTime,
+    checks,
+  };
+}
```

- [ ] **Step 2: Create fix eval**

`evals/legreffier-commit-fix/scenario.json`:

```json
{
  "baseCommit": "6486435",
  "expected": {
    "commitType": "fix",
    "riskLevel": "medium",
    "scopes": ["scope:diary"]
  },
  "id": "legreffier-commit-fix",
  "patchFiles": ["evals/legreffier-commit-fix/patch.diff"],
  "skillPath": ".claude/skills/legreffier/SKILL.md",
  "taskPrompt": "Fixed the pagination offset bug. Commit using legreffier."
}
```

`evals/legreffier-commit-fix/task.md`:

```
Fixed the pagination offset bug. Commit using legreffier.
```

`evals/legreffier-commit-fix/patch.diff` — fix an off-by-one in a pagination helper (synthetic, valid against the pinned commit):

```diff
diff --git a/libs/diary-service/src/diary-repository.ts b/libs/diary-service/src/diary-repository.ts
index 1234567..abcdef2 100644
--- a/libs/diary-service/src/diary-repository.ts
+++ b/libs/diary-service/src/diary-repository.ts
@@ -1,1 +1,1 @@
-// Placeholder: actual patch will be generated against pinned commit
+// TODO: generate real patch against commit 6486435
```

**Note:** The actual patch content must be generated against the pinned commit `6486435`. This step documents the structure; the real diffs need to be crafted by checking out that commit and creating minimal, valid changes. This is a manual step during implementation — the implementer should:

1. `git worktree add /tmp/eval-patches 6486435`
2. Make the described change in each file
3. `git diff > evals/legreffier-commit-<type>/patch.diff`
4. `git worktree remove /tmp/eval-patches`

- [ ] **Step 3: Create remaining eval scenarios (test, chore, docs)**

Same pattern. Key details:

| Eval  | Patch target                                    | Change description         | Risk |
| ----- | ----------------------------------------------- | -------------------------- | ---- |
| test  | Existing test file in `libs/diary-service/src/` | Add a test case            | low  |
| chore | `pnpm-workspace.yaml`                           | Bump a catalog dep version | high |
| docs  | `docs/ARCHITECTURE.md`                          | Add a paragraph            | low  |

- [ ] **Step 4: Create chain eval (Group 2)**

`evals/legreffier-chain-fix-chore-test/scenario.json`:

```json
{
  "baseCommit": "6486435",
  "expected": {
    "commitType": "fix",
    "expectedCommitCount": 3,
    "isChain": true,
    "riskLevel": "medium",
    "scopes": ["scope:diary"]
  },
  "id": "legreffier-chain-fix-chore-test",
  "patchFiles": [
    "evals/legreffier-chain-fix-chore-test/patch-1-fix.diff",
    "evals/legreffier-chain-fix-chore-test/patch-2-chore.diff",
    "evals/legreffier-chain-fix-chore-test/patch-3-test.diff"
  ],
  "skillPath": ".claude/skills/legreffier/SKILL.md",
  "taskPrompt": "I've made three related changes: fixed the pagination offset bug, cleaned up the error message, and added a regression test. Commit them as a proper task chain using legreffier."
}
```

- [ ] **Step 5: Commit**

```bash
git add evals/legreffier-commit-feat/ evals/legreffier-commit-fix/ evals/legreffier-commit-test/ evals/legreffier-commit-chore/ evals/legreffier-commit-docs/ evals/legreffier-chain-fix-chore-test/
git commit -m "feat(evals): add LeGreffier commit eval scenarios (Group 1 + Group 2)"
```

---

## Chunk 4: Pipeline Integration

### Task 9: Add `--skill-eval` flag to pipeline.ts

**Files:**

- Modify: `libs/context-evals/src/pipeline.ts`

- [ ] **Step 1: Add skill-eval arg parsing**

Add to `parseArgs` options:

```typescript
'skill-eval': { type: 'boolean', default: false },
'scorer': { type: 'string' },
'skill-preamble': { type: 'string' },
'skill-epilogue': { type: 'string' },
'agent-config-dir': { type: 'string' },
'agent-name': { type: 'string' },
'mcp-url': { type: 'string' },
'mcp-client-id': { type: 'string' },
'mcp-client-secret': { type: 'string' },
```

- [ ] **Step 2: Add skill eval task loading**

Add a `loadSkillEvalInputs()` function that reads `evals/<name>/scenario.json`, validates against `SkillEvalTaskSchema`, and returns `SkillEvalTask[]`. This bypasses the existing `GpackTaskSchema` validation path.

```typescript
async function loadSkillEvalInputs(spec: string): Promise<SkillEvalTask[]> {
  const names =
    spec === 'all'
      ? (await readdir(resolve(repoRoot, 'evals'), { withFileTypes: true }))
          // Generic: validate each dir's scenario.json against SkillEvalTaskSchema
          // instead of hardcoding a prefix. Non-skill-eval dirs will fail validation.
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
      : spec
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean);

  const tasks: SkillEvalTask[] = [];
  for (const name of names) {
    const dir = resolve(repoRoot, 'evals', name);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(`${dir}/scenario.json`, 'utf8'));
    } catch {
      continue; // skip dirs without scenario.json
    }
    if (!Value.Check(SkillEvalTaskSchema, raw)) {
      if (spec === 'all') continue; // skip non-skill-eval scenarios in 'all' mode
      throw new Error(`Invalid skill eval task: ${name}`);
    }
    tasks.push(raw);
  }
  return tasks;
}
```

- [ ] **Step 3: Add skill eval execution path in main()**

When `--skill-eval` is set, the pipeline:

1. Loads `SkillEvalTask[]` from evals
2. Dynamically imports the `--scorer` module (factory function)
3. Reads the SKILL.md via `--skill-file` and splits it into preamble/commit-section/epilogue
4. Uses the commit section as the seed `instruction` for baseline/GEPA
5. Creates `SkillEvalAdapter` with the scorer, preamble, epilogue, and MCP config
6. Runs baseline or GEPA optimization

New args:

```typescript
'skill-file': { type: 'string' },  // path to SKILL.md (splits into preamble/commit/epilogue)
```

```typescript
if (skillEval) {
  const tasks = await loadSkillEvalInputs(evalSpec);
  // Dynamic import of scorer factory
  const scorerModule = await import(resolve(repoRoot, scorerPath));
  const evalEnv = JSON.parse(
    await readFile(resolve(repoRoot, '.eval-env.json'), 'utf8'),
  );
  const scorer = scorerModule.createScorer(
    evalEnv.apiUrl,
    evalEnv.diaryId,
    evalEnv.clientId,
    evalEnv.clientSecret,
  );

  // Split SKILL.md into fixed preamble/epilogue + variable commit section
  const skillFile =
    str(values['skill-file']) || '.claude/skills/legreffier/SKILL.md';
  const skillContent = await readFile(resolve(repoRoot, skillFile), 'utf8');
  const { splitSkillContent } = await import(
    resolve(repoRoot, scorerPath.replace(/index\.ts$/, 'skill-sections.ts'))
  );
  const { preamble, commitSection, epilogue } = splitSkillContent(skillContent);
  // commitSection is the seed instruction text for GEPA
  const seedInstruction = commitSection;

  const adapter = new SkillEvalAdapter({
    preamble,
    epilogue,
    mcpServers: {
      legreffier: {
        type: 'http',
        url: mcpUrl,
        headers: {
          'X-Client-Id': mcpClientId,
          'X-Client-Secret': mcpClientSecret,
        },
      },
    },
    agentConfigDir: agentConfigDir,
    agentName: agentName,
    scorer,
    claudeModel,
    verbose,
  });

  // Baseline: evaluate with current commit section as-is
  if (runBaseline) {
    const result = await adapter.evaluate(
      tasks,
      { instruction: seedInstruction },
      true,
    );
    const avgScore =
      result.scores.reduce((a, b) => a + b, 0) /
      Math.max(1, result.scores.length);
    console.log(
      `[skill-eval] baseline scores: ${result.scores.map((s) => s.toFixed(2)).join(', ')} avg=${avgScore.toFixed(3)}`,
    );
    return;
  }

  // GEPA optimization: seedInstruction is the starting candidate
  // Same GEPA flow as context-pack optimization but using SkillEvalAdapter
  const studentAI = buildAI();
  const passthrough = ax('taskPrompt:string -> skillSection:string');
  passthrough.setInstruction(seedInstruction);

  const optimizer = new AxGEPA({ studentAI, numTrials, verbose, seed: 42 });
  // ... (same compile() call pattern as existing gpack main)
  return;
}
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter @moltnet/context-evals typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add libs/context-evals/src/pipeline.ts
git commit -m "feat(context-evals): add --skill-eval pipeline flag with SkillEvalAdapter integration"
```

---

### Task 10: Add scorer factory for LeGreffier

**Files:**

- Create: `tools/src/skill-evals/legreffier/index.ts`

This is the entry point that `--scorer` points to. It exports a `createScorer()` factory.

- [ ] **Step 1: Create factory**

```typescript
// tools/src/skill-evals/legreffier/index.ts
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { CommitScorer } from './commit-scorer.js';
import { splitSkillContent } from './skill-sections.js';

export { CommitScorer } from './commit-scorer.js';
export { splitSkillContent, loadSkillSections } from './skill-sections.js';
export type { CommitExpected, CommitScoreResult } from './types.js';

interface EvalEnv {
  apiUrl: string;
  diaryId: string;
  mcpUrl: string;
  clientId: string;
  clientSecret: string;
  configDir: string;
  agentName: string;
}

export async function loadEvalEnv(repoRoot: string): Promise<EvalEnv> {
  const raw = await readFile(resolve(repoRoot, '.eval-env.json'), 'utf8');
  return JSON.parse(raw) as EvalEnv;
}

export function createScorer(
  apiUrl: string,
  diaryId: string,
  clientId: string,
  clientSecret: string,
): CommitScorer {
  return new CommitScorer(apiUrl, diaryId, clientId, clientSecret);
}
```

- [ ] **Step 2: Commit**

```bash
git add tools/src/skill-evals/legreffier/index.ts
git commit -m "feat(tools): add LeGreffier scorer factory and eval env loader"
```

---

### Task 11: Add `gpack:skill-eval` convenience script

**Files:**

- Modify: `tools/package.json`

- [ ] **Step 1: Add script**

```json
"gpack:skill-eval": "tsx ../libs/context-evals/src/pipeline.ts --skill-eval"
```

- [ ] **Step 2: Commit**

```bash
git add tools/package.json
git commit -m "chore(tools): add gpack:skill-eval convenience script"
```

---

## Chunk 5: Integration Smoke Test

### Task 12: End-to-end integration test

This is a manual verification step. It requires the Docker e2e stack running.

- [ ] **Step 1: Start e2e stack**

```bash
COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml up -d --build
```

- [ ] **Step 2: Run eval:setup**

```bash
pnpm --filter @moltnet/tools eval:setup
```

Expected: `.eval-env.json` created, `.moltnet/eval-agent/` directory populated.

- [ ] **Step 3: Run a single baseline eval**

```bash
pnpm --filter @moltnet/tools gpack:skill-eval \
  --eval legreffier-commit-feat \
  --baseline \
  --agent-config-dir .moltnet/eval-agent \
  --agent-name eval-agent \
  --mcp-url http://localhost:8001/mcp \
  --mcp-client-id <from .eval-env.json> \
  --mcp-client-secret <from .eval-env.json> \
  --scorer tools/src/skill-evals/legreffier/index.ts \
  --skill-preamble /tmp/preamble.md \
  --skill-epilogue /tmp/epilogue.md \
  --verbose
```

Expected: Score between 0.0 and 1.0 printed. Agent should have created a commit with diary entry.

- [ ] **Step 4: Review agent output**

Check:

- Was a diary entry created? (`curl http://localhost:8080/diaries/<id>/entries`)
- Does the commit have a `MoltNet-Diary:` trailer? (`git log` in the worktree — may need to preserve it for debugging)
- Does the score match expectations?

- [ ] **Step 5: Teardown**

```bash
COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml down -v
```

- [ ] **Step 6: Commit any integration fixes**

```bash
git add -A
git commit -m "fix(skill-eval): integration fixes from smoke test"
```

---

## Implementation Notes (added during implementation)

### Pipeline split (deviation from original Task 9)

The original plan called for adding `--skill-eval` flag to `libs/context-evals/src/pipeline.ts`. This was rejected because `libs/context-evals` must remain **generic** — it knows nothing about LeGreffier, SKILL.md sections, or `.eval-env.json`.

Instead:

- **`libs/context-evals/src/pipeline-shared.ts`** — extracted shared utilities (`buildAI`, `buildAverage`, `buildCacheKey`, `resolveRepoRoot`, `loadEnvLocal`, `str`, `writeDebugArtifact`, `resolveAIKey`, `loadPackFile`)
- **`libs/context-evals/src/pipeline.ts`** — refactored to import from `pipeline-shared.ts` (no functional changes, just extraction)
- **`tools/src/skill-evals/legreffier/skill-eval-pipeline.ts`** — NEW standalone entrypoint for skill eval. Domain-specific to LeGreffier. Imports generic types/adapter from `@moltnet/context-evals` and scorer/splitting from the legreffier module.

New subpath exports added to `libs/context-evals/package.json`:

- `./pipeline-shared` — shared pipeline utilities
- `./config` — `loadContextEvalsConfig`
- `./skill-adapter` — `SkillEvalAdapter`

### GEPA studentAI vs teacherAI

**Inspiration**: [gskill](https://github.com/itsmostafa/gskill) by @itsmostafa — a Python tool that generates repo-specific SKILL.md files using GEPA's `optimize_anything`. gskill uses the Python `gepa` package which abstracts away student/teacher roles. Our TypeScript `@ax-llm/ax` uses the lower-level `AxGEPA` class.

**GEPA terminology** (from [ax-llm examples](https://github.com/ax-llm/ax/blob/main/src/examples/gepa-train-inference.ts)):

- `studentAI`: the model whose prompts/instructions are being optimized (cheaper/faster, e.g. GPT-4o Mini)
- `teacherAI`: optional more capable model that proposes better instructions during the reflection step (e.g. GPT-4o)

In our pipeline, the `ax()` program is a **passthrough** — we don't run it on `studentAI`. The real execution happens in `SkillEvalAdapter.evaluate()` which runs Claude Code agents. `studentAI` is still required by AxGEPA for the program scaffold, and `teacherAI` (when provided) improves the quality of proposed instruction improvements.

Both pipelines (gpack and skill-eval) now support `--teacher-model` flag:

```bash
pnpm gpack:skill-eval --eval all --ai-key $KEY --model gpt-4o-mini --teacher-model gpt-4o
```

### gskill reference architecture

gskill's pipeline (`src/pipeline.py`):

1. Load tasks from SWE-smith dataset → train/val/test split
2. Generate initial skill via LLM (README + config analysis)
3. Run `optimize_anything(seed_candidate, evaluator, dataset, valset, objective, config)`
4. Each evaluation: run mini-SWE-agent in Docker → apply patch → check FAIL_TO_PASS tests → binary 0/1 score
5. Save best candidate to `.claude/skills/{repo}/SKILL.md`

Our approach differs:

- We optimize a **section** of SKILL.md (not the whole file)
- Our scorer is **tiered** (must-have/should-have/nice-to-have → 0.0–1.0), not binary
- We score **behavioral compliance** (diary entries, trailers, tags, signatures), not test pass/fail
- We use the Anthropic Agent SDK to run Claude Code, not mini-SWE-agent

## Summary

| Chunk | Tasks | What it delivers                                                                     |
| ----- | ----- | ------------------------------------------------------------------------------------ |
| 1     | 1–4   | Generic `SkillEvalAdapter`, `SkillScorer` interface, `ClaudeQueryOptions.mcpServers` |
| 2     | 5–7   | LeGreffier scorer, skill section splitter, eval setup script                         |
| 3     | 8     | Eval task definitions (5 Group 1 + 1 Group 2) with synthetic patches                 |
| 4     | 9–11  | Pipeline split, scorer factory, convenience scripts, teacherAI support               |
| 5     | 12    | Integration smoke test against local e2e stack                                       |

After Chunk 5, the pipeline supports `pnpm gpack:skill-eval --eval legreffier-commit-feat --baseline` for single-eval runs and GEPA optimization with `--model` / `--teacher-model` for instruction improvement.
