import type { Task, TaskAttempt } from '@moltnet/api-client';
import { validateTaskCreateRequest } from '@moltnet/tasks';
import { describe, expect, it } from 'vitest';

import { buildAssessBrief, createResultReader } from '../../src/tasks/index.js';

const TEAM = '6743b4b1-6b93-46e2-a048-19490f04f91a';
const DIARY = '6e4d9948-8ec5-4f59-b82a-3acbc4bbc396';

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

describe('compose -> consume -> compose', () => {
  it('feeds a reader outputRef into a downstream builder that validates', () => {
    const UPSTREAM_ID = '44444444-4444-4444-4444-444444444444';
    const upstream = createResultReader(
      {
        id: UPSTREAM_ID,
        taskType: 'freeform',
        acceptedAttemptN: 1,
        input: {},
      } as unknown as Task,
      {
        taskId: UPSTREAM_ID,
        attemptN: 1,
        status: 'completed',
        output: { summary: 's' },
        outputCid: 'bafyUP',
        completedAt: null,
        completedExecutorFingerprint: null,
        usage: null,
      } as unknown as TaskAttempt,
    );

    const { body } = buildAssessBrief({
      targetTaskId: UPSTREAM_ID,
      successCriteria: { version: 1, rubric: llmRubric },
    })
      .team(TEAM)
      .diary(DIARY)
      .references(upstream, 'judged_work')
      .build();

    expect(body.references?.[0]).toEqual({
      taskId: UPSTREAM_ID,
      outputCid: 'bafyUP',
      role: 'judged_work',
    });
    expect(
      validateTaskCreateRequest({
        taskType: body.taskType,
        input: body.input,
        references: body.references ?? null,
      }),
    ).toEqual([]);
  });
});
