import { validateTaskCreateRequest } from '@moltnet/tasks';
import { describe, expect, it } from 'vitest';

import {
  buildAssessBrief,
  buildCuratePack,
  buildFreeform,
  buildFulfillBrief,
  buildJudgeEvalAttempt,
  buildJudgePack,
  buildPrReview,
  buildRenderPack,
  buildRunEval,
} from '../../src/tasks/builder.js';

const TEAM = '6743b4b1-6b93-46e2-a048-19490f04f91a';
const DIARY = '6e4d9948-8ec5-4f59-b82a-3acbc4bbc396';
const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';
const UUID_C = '33333333-3333-3333-3333-333333333333';

/** Rubric using llm_score (accepted by assess_brief / judge_pack / judge_eval_attempt). */
const llmRubric = {
  rubricId: 'test-rubric',
  version: 'v1',
  criteria: [
    {
      id: 'overall',
      description: 'Overall quality',
      weight: 1,
      scoring: 'llm_score' as const,
    },
  ],
};

/** Rubric using boolean scoring (required by pr_review). */
const booleanRubric = {
  rubricId: 'test-rubric',
  version: 'v1',
  criteria: [
    {
      id: 'overall',
      description: 'Overall quality',
      weight: 1,
      scoring: 'boolean' as const,
    },
  ],
};

const ok = (body: { taskType: string; input: unknown; references?: unknown }) =>
  validateTaskCreateRequest({
    taskType: body.taskType,
    input: body.input,
    references: (body.references as never) ?? null,
  });

describe('typed per-type factories produce validator-passing bodies', () => {
  it('buildFreeform', () => {
    expect(
      ok(buildFreeform({ brief: 'b' }).team(TEAM).diary(DIARY).build()),
    ).toEqual([]);
  });

  it('buildFulfillBrief', () => {
    expect(
      ok(buildFulfillBrief({ brief: 'b' }).team(TEAM).diary(DIARY).build()),
    ).toEqual([]);
  });

  it('buildCuratePack', () => {
    expect(
      ok(
        buildCuratePack({ diaryId: DIARY, taskPrompt: 'p' })
          .team(TEAM)
          .diary(DIARY)
          .build(),
      ),
    ).toEqual([]);
  });

  it('buildRenderPack', () => {
    expect(
      ok(buildRenderPack({ packId: UUID_A }).team(TEAM).diary(DIARY).build()),
    ).toEqual([]);
  });

  it('buildRunEval', () => {
    expect(
      ok(
        buildRunEval({
          scenario: { prompt: 'p' },
          variantLabel: 'v1',
          execution: { mode: 'vitro', workspace: 'none' },
          context: [{ slug: 'seed', binding: 'context_inline', content: 'x' }],
        })
          .team(TEAM)
          .diary(DIARY)
          .build(),
      ),
    ).toEqual([]);
  });

  it('buildAssessBrief (requires references)', () => {
    expect(
      ok(
        buildAssessBrief({
          targetTaskId: UUID_A,
          successCriteria: { version: 1, rubric: llmRubric },
        })
          .team(TEAM)
          .diary(DIARY)
          .references({ taskId: UUID_B, outputCid: 'bafy' }, 'judged_work')
          .build(),
      ),
    ).toEqual([]);
  });

  it('buildJudgePack (requires references)', () => {
    expect(
      ok(
        buildJudgePack({
          renderedPackId: UUID_A,
          sourcePackId: UUID_C,
          successCriteria: { version: 1, rubric: llmRubric },
        })
          .team(TEAM)
          .diary(DIARY)
          .references({ taskId: UUID_B, outputCid: 'bafy' }, 'judged_work')
          .build(),
      ),
    ).toEqual([]);
  });

  it('buildJudgeEvalAttempt', () => {
    expect(
      ok(
        buildJudgeEvalAttempt({
          targetTaskId: UUID_A,
          targetAttemptN: 1,
          successCriteria: { version: 1, rubric: llmRubric },
        })
          .team(TEAM)
          .diary(DIARY)
          .build(),
      ),
    ).toEqual([]);
  });

  it('buildPrReview', () => {
    expect(
      ok(
        buildPrReview({
          subject: { title: 't', summary: 's' },
          successCriteria: { version: 1, rubric: booleanRubric },
        })
          .team(TEAM)
          .diary(DIARY)
          .build(),
      ),
    ).toEqual([]);
  });
});
