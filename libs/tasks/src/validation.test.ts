import { describe, expect, it } from 'vitest';

import { validateTaskCreateRequest, validateTaskOutput } from './validation.js';

describe('validateTaskCreateRequest', () => {
  it('rejects prototype task type keys as unknown', () => {
    const errors = validateTaskCreateRequest({
      taskType: 'constructor',
      input: {},
    });

    expect(errors).toEqual([
      {
        field: 'taskType',
        message: 'Unknown task type: constructor',
      },
    ]);
  });

  it('requires references for judge_pack', () => {
    const errors = validateTaskCreateRequest({
      taskType: 'judge_pack',
      input: {
        renderedPackId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        sourcePackId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        rubric: {
          rubricId: 'pack-fidelity-v2',
          version: 'v2',
          scope: 'packs',
          preamble: 'Judge the pack faithfully.',
          criteria: [
            {
              id: 'grounding',
              description: 'No unsupported claims.',
              weight: 1,
              scoring: 'llm_judged',
            },
          ],
        },
      },
      references: [],
    });

    expect(errors).toEqual([
      {
        field: 'references',
        message: 'At least one reference is required for task type: judge_pack',
      },
    ]);
  });
});

describe('validateTaskOutput', () => {
  it('rejects prototype task type keys as unknown', () => {
    const errors = validateTaskOutput('toString', {});

    expect(errors).toEqual([
      {
        field: 'taskType',
        message: 'Unknown task type: toString',
      },
    ]);
  });

  it('returns field-level errors for invalid fulfill_brief output', () => {
    const errors = validateTaskOutput('fulfill_brief', {
      branch: 'feat/tasks',
      commits: [],
      summary: 42,
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        {
          field: 'output/pullRequestUrl',
          message: 'Expected union value',
        },
        {
          field: 'output/diaryEntryIds',
          message: 'Expected array',
        },
      ]),
    );
  });
});
