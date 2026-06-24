import { validateTaskCreateRequest } from '@moltnet/tasks';
import { describe, expect, it } from 'vitest';

import { buildTask } from '../../src/tasks/builder.js';
import { TaskBuildError } from '../../src/tasks/errors.js';

const TEAM = '6743b4b1-6b93-46e2-a048-19490f04f91a';
const DIARY = '6e4d9948-8ec5-4f59-b82a-3acbc4bbc396';

/**
 * A minimal valid success criteria for judgment task types, which require a
 * non-empty rubric (criterion weights summing to 1).
 */
const JUDGMENT_CRITERIA = {
  version: 1,
  rubric: {
    rubricId: 'test-rubric',
    version: 'v1',
    criteria: [
      {
        id: 'overall',
        description: 'Overall quality',
        weight: 1,
        scoring: 'llm_score',
      },
    ],
  },
};

describe('buildTask (generic core)', () => {
  it('assembles a valid freeform body that passes the shared validator', () => {
    const body = buildTask('freeform', { brief: 'Do the thing' })
      .team(TEAM)
      .diary(DIARY)
      .build();

    expect(body.taskType).toBe('freeform');
    expect(body.teamId).toBe(TEAM);
    expect(body.diaryId).toBe(DIARY);
    expect(
      validateTaskCreateRequest({
        taskType: body.taskType,
        input: body.input,
        references: body.references ?? null,
      }),
    ).toEqual([]);
  });

  it('throws TaskBuildError with field path when a required input field is missing', () => {
    expect(() =>
      buildTask('freeform', {}).team(TEAM).diary(DIARY).build(),
    ).toThrow(TaskBuildError);
    try {
      buildTask('freeform', {}).team(TEAM).diary(DIARY).build();
    } catch (e) {
      const err = e as TaskBuildError;
      expect(err.errors.some((x) => x.field.includes('brief'))).toBe(true);
    }
  });

  it('throws when team or diary is missing', () => {
    expect(() =>
      buildTask('freeform', { brief: 'x' }).diary(DIARY).build(),
    ).toThrow(/teamId/);
    expect(() =>
      buildTask('freeform', { brief: 'x' }).team(TEAM).build(),
    ).toThrow(/diaryId/);
  });

  it('injects the submit-output gate for producer types (normalization)', () => {
    const body = buildTask('freeform', { brief: 'x' })
      .team(TEAM)
      .diary(DIARY)
      .build();
    const gates = (
      body.input as { successCriteria?: { gates?: { id: string }[] } }
    ).successCriteria?.gates;
    expect(gates?.some((g) => g.id === 'submit-output')).toBe(true);
  });

  it('does NOT inject a gate for non-producer (judgment) types', () => {
    const body = buildTask('pr_review', {
      subject: { title: 't', summary: 's' },
      successCriteria: {
        version: 1,
        rubric: {
          rubricId: 'test-rubric',
          version: 'v1',
          // pr_review requires boolean scoring for every criterion.
          criteria: [
            {
              id: 'overall',
              description: 'Overall quality',
              weight: 1,
              scoring: 'boolean',
            },
          ],
        },
      },
    })
      .team(TEAM)
      .diary(DIARY)
      .build();
    const gates = (
      body.input as { successCriteria?: { gates?: { id: string }[] } }
    ).successCriteria?.gates;
    expect(gates?.some((g) => g.id === 'submit-output')).toBeFalsy();
  });

  it('contextInline JSON-stringifies objects and sets context_inline binding', () => {
    const body = buildTask('freeform', { brief: 'x' })
      .team(TEAM)
      .diary(DIARY)
      .contextInline('user-request', { city: 'Paris' })
      .build();
    const ctx = (
      body.input as {
        context?: { slug: string; binding: string; content: string }[];
      }
    ).context!;
    expect(ctx[0]).toEqual({
      slug: 'user-request',
      binding: 'context_inline',
      content: JSON.stringify({ city: 'Paris' }),
    });
  });

  it('references() pulls outputCid from a raw {taskId,outputCid}', () => {
    const body = buildTask('assess_brief', {
      targetTaskId: '11111111-1111-1111-1111-111111111111',
      successCriteria: JUDGMENT_CRITERIA,
    })
      .team(TEAM)
      .diary(DIARY)
      .references(
        { taskId: '22222222-2222-2222-2222-222222222222', outputCid: 'bafy123' },
        'judged_work',
      )
      .build();
    expect(body.references).toEqual([
      {
        taskId: '22222222-2222-2222-2222-222222222222',
        outputCid: 'bafy123',
        role: 'judged_work',
      },
    ]);
  });

  it('references() throws if outputCid is missing', () => {
    expect(() =>
      buildTask('assess_brief', {
        targetTaskId: '11111111-1111-1111-1111-111111111111',
        successCriteria: { version: 1 },
      })
        .team(TEAM)
        .diary(DIARY)
        // @ts-expect-error outputCid intentionally missing
        .references({ taskId: '2' }, 'judged_work')
        .build(),
    ).toThrow(/outputCid/);
  });
});
