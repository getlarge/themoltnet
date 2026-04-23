import { describe, expect, it } from 'vitest';

import { validateTaskCreateRequest, validateTaskOutput } from './validation.js';

describe('validateTaskCreateRequest', () => {
  it('requires references for judge_pack', () => {
    const errors = validateTaskCreateRequest({
      taskType: 'judge_pack',
      input: {
        rendered_pack_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        source_pack_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        rubric: {
          rubric_id: 'pack-fidelity-v2',
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
  it('returns field-level errors for invalid fulfill_brief output', () => {
    const errors = validateTaskOutput('fulfill_brief', {
      branch: 'feat/tasks',
      commits: [],
      summary: 42,
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        {
          field: 'output/pull_request_url',
          message: 'Expected union value',
        },
        {
          field: 'output/diary_entry_ids',
          message: 'Expected array',
        },
      ]),
    );
  });
});
