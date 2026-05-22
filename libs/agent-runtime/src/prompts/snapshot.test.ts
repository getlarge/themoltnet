import {
  ASSESS_BRIEF_TYPE,
  CURATE_PACK_TYPE,
  JUDGE_EVAL_ATTEMPT_TYPE,
  JUDGE_PACK_TYPE,
  PR_REVIEW_TYPE,
  RENDER_PACK_TYPE,
  RUN_EVAL_TYPE,
} from '@moltnet/tasks';
import { describe, expect, it } from 'vitest';

import { makeFulfillBriefTask } from '../test-fixtures.js';
import { buildTaskUserPrompt } from './index.js';

/**
 * Byte-identical snapshots of every task-type prompt builder. These pin
 * the rendered output before/after the assemble.ts refactor (issue #1175,
 * area 5) — every builder must produce the exact same string after the
 * migration to `PromptSection[]`.
 *
 * If you intentionally change a prompt, regenerate the relevant snapshot
 * via `pnpm exec vitest --update libs/agent-runtime/src/prompts/snapshot.test.ts`
 * and make the change visible in the PR diff.
 */

const baseCtx = { diaryId: 'd-1', taskId: 't-1' };

const rubricSingle = {
  rubricId: 'r-1',
  version: 'v1' as const,
  criteria: [
    {
      id: 'c1',
      description: 'Pass condition',
      weight: 1,
      scoring: 'llm_score' as const,
    },
  ],
};

const rubricBinary = {
  rubricId: 'pr-binary',
  version: 'v1' as const,
  criteria: [
    {
      id: 'c1',
      description: 'Pass condition',
      weight: 1,
      scoring: 'boolean' as const,
    },
  ],
};

describe('prompt snapshots (assembler refactor pin)', () => {
  it('fulfill_brief — minimal', () => {
    const task = makeFulfillBriefTask({
      input: { brief: 'Do the thing', title: 'Thing', scopeHint: 'misc' },
    });
    expect(buildTaskUserPrompt(task, baseCtx).text).toMatchSnapshot();
  });

  it('fulfill_brief — correlation + dedicated worktree', () => {
    const task = makeFulfillBriefTask({
      correlationId: '22222222-3333-4444-8555-666666666666',
      input: { brief: 'Do the thing', title: 'Thing', scopeHint: 'misc' },
    });
    const prompt = buildTaskUserPrompt(task, {
      ...baseCtx,
      workspace: {
        mode: 'dedicated_worktree',
        branch: 'moltnet/22222222-3333-4444-8555-666666666666/thing',
      },
    });
    expect(prompt.text).toMatchSnapshot();
  });

  it('assess_brief — with dedicated worktree', () => {
    const task = makeFulfillBriefTask({
      taskType: ASSESS_BRIEF_TYPE,
      input: {
        targetTaskId: '11111111-1111-4111-8111-111111111111',
        successCriteria: { version: 1 as const, rubric: rubricSingle },
      },
    });
    const prompt = buildTaskUserPrompt(task, {
      ...baseCtx,
      workspace: {
        mode: 'dedicated_worktree',
        branch: 'task/assess-brief-11111111',
      },
    });
    expect(prompt.text).toMatchSnapshot();
  });

  it('curate_pack — minimal', () => {
    const task = makeFulfillBriefTask({
      taskType: CURATE_PACK_TYPE,
      input: {
        diaryId: '66666666-6666-4666-8666-666666666666',
        taskPrompt: 'Compile decisions about X',
        tokenBudget: 1500,
      },
    });
    expect(buildTaskUserPrompt(task, baseCtx).text).toMatchSnapshot();
  });

  it('curate_pack — pinned entry types + filters', () => {
    const task = makeFulfillBriefTask({
      taskType: CURATE_PACK_TYPE,
      input: {
        diaryId: '66666666-6666-4666-8666-666666666666',
        taskPrompt: 'Compile decisions about X',
        entryTypes: ['semantic'],
        tagFilters: {
          include: ['scope:auth'],
          exclude: ['scope:legacy'],
          prefix: 'scope:',
        },
        recipe: 'topic-focused-v1',
      },
    });
    expect(buildTaskUserPrompt(task, baseCtx).text).toMatchSnapshot();
  });

  it('render_pack — minimal', () => {
    const task = makeFulfillBriefTask({
      taskType: RENDER_PACK_TYPE,
      input: {
        packId: '33333333-3333-4333-8333-333333333333',
        persist: true,
        pinned: false,
      },
    });
    expect(buildTaskUserPrompt(task, baseCtx).text).toMatchSnapshot();
  });

  it('judge_pack — minimal', () => {
    const task = makeFulfillBriefTask({
      taskType: JUDGE_PACK_TYPE,
      input: {
        renderedPackId: '44444444-4444-4444-8444-444444444444',
        sourcePackId: '55555555-5555-4555-8555-555555555555',
        successCriteria: { version: 1 as const, rubric: rubricSingle },
      },
    });
    expect(buildTaskUserPrompt(task, baseCtx).text).toMatchSnapshot();
  });

  it('judge_eval_attempt — attached scratch_mount', () => {
    const task = makeFulfillBriefTask({
      taskType: JUDGE_EVAL_ATTEMPT_TYPE,
      input: {
        targetTaskId: '11111111-1111-4111-8111-111111111111',
        targetAttemptN: 1,
        successCriteria: { version: 1 as const, rubric: rubricSingle },
      },
    });
    const prompt = buildTaskUserPrompt(task, {
      ...baseCtx,
      workspace: {
        mode: 'scratch_mount',
        attached: true,
        source: 'producer_copy',
      },
    });
    expect(prompt.text).toMatchSnapshot();
  });

  it('pr_review — full subject', () => {
    const task = makeFulfillBriefTask({
      taskType: PR_REVIEW_TYPE,
      input: {
        subject: {
          title: 'Generated change review',
          summary: 'Review this change artifact for complexity.',
          resourceUrls: ['https://example.test/review/123'],
          inspectionHints: ['Inspect the local checkout before scoring.'],
        },
        taskPrompt: 'Use the consumer-supplied review flow.',
        successCriteria: { version: 1 as const, rubric: rubricBinary },
      },
    });
    expect(buildTaskUserPrompt(task, baseCtx).text).toMatchSnapshot();
  });

  it('run_eval — baseline (no context, no successCriteria)', () => {
    const task = makeFulfillBriefTask({
      taskType: RUN_EVAL_TYPE,
      input: {
        scenario: {
          prompt: 'List the top 3 risks in this code.',
          inputFiles: ['a.ts'],
        },
        variantLabel: 'baseline',
        execution: { mode: 'vitro' as const, workspace: 'none' as const },
        context: [],
      },
    });
    expect(buildTaskUserPrompt(task, baseCtx).text).toMatchSnapshot();
  });

  it('run_eval — with-context + correlation + successCriteria', () => {
    const task = makeFulfillBriefTask({
      taskType: RUN_EVAL_TYPE,
      correlationId: 'corr-abc',
      input: {
        scenario: { prompt: 'List the top 3 risks in this code.' },
        variantLabel: 'with-pack',
        execution: {
          mode: 'vivo' as const,
          workspace: 'dedicated_worktree' as const,
        },
        context: [
          {
            slug: 'ctx-pack',
            binding: 'context_inline' as const,
            content: '# Context Pack',
          },
        ],
        successCriteria: { version: 1 as const },
      },
    });
    expect(buildTaskUserPrompt(task, baseCtx).text).toMatchSnapshot();
  });
});
