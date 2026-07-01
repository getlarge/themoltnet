import { validateTaskCreateRequest } from '@moltnet/tasks';
import { describe, expect, it } from 'vitest';

import {
  buildAssessBrief,
  buildCuratePack,
  buildFreeform,
  buildFulfillBrief,
  buildJudgeEvalAttempt,
  buildJudgeEvalAttemptForRunEval,
  buildRubricSuccessCriteria,
  buildJudgePack,
  buildPrReview,
  buildRenderPack,
  buildRunEval,
  normalizeRubricCriteria,
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

const ok = (built: {
  body: { taskType: string; input: unknown; references?: unknown };
}) =>
  validateTaskCreateRequest({
    taskType: built.body.taskType,
    input: built.body.input,
    references: (built.body.references as never) ?? null,
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

  it('buildRubricSuccessCriteria normalizes rubric criteria', () => {
    expect(
      buildRubricSuccessCriteria({
        rubricId: 'eval-rubric',
        criteria: [
          {
            id: 'workflow-started-after-transaction-commits',
            title: 'Workflow started after transaction commits',
            weight: 0.35,
            description: 'Workflow starts after runTransaction resolves',
          },
          {
            id: 'notes-name-both-systems',
            title: 'Notes name both systems',
            weight: 0.65,
            description: 'Notes mention DBOS and Drizzle/Postgres',
          },
        ],
      }),
    ).toEqual({
      version: 1,
      rubric: {
        rubricId: 'eval-rubric',
        version: 'v1',
        criteria: [
          {
            id: 'workflow-started-after-transaction-commits',
            description: 'Workflow starts after runTransaction resolves',
            weight: 0.35,
            scoring: 'llm_score',
          },
          {
            id: 'notes-name-both-systems',
            description: 'Notes mention DBOS and Drizzle/Postgres',
            weight: 0.65,
            scoring: 'llm_score',
          },
        ],
      },
    });
  });

  it('normalizes criteria.json style max_score values', () => {
    expect(
      normalizeRubricCriteria([
        { name: 'Does X', description: 'Agent does X', max_score: 60 },
        { name: 'Does Y', description: 'Agent does Y', max_score: 40 },
      ]),
    ).toEqual([
      {
        id: 'Does X',
        description: 'Agent does X',
        weight: 0.6,
        scoring: 'llm_score',
      },
      {
        id: 'Does Y',
        description: 'Agent does Y',
        weight: 0.4,
        scoring: 'llm_score',
      },
    ]);
  });

  it('buildJudgeEvalAttemptForRunEval derives target and normalized rubric', () => {
    expect(
      ok(
        buildJudgeEvalAttemptForRunEval(
          { targetTaskId: UUID_A, targetAttemptN: 1 },
          {
            rubricId: 'eval-rubric',
            criteria: [
              {
                id: 'workflow-started-after-transaction-commits',
                title: 'Workflow started after transaction commits',
                weight: 1,
                description: 'Workflow starts after runTransaction resolves',
              },
            ],
          },
        )
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
