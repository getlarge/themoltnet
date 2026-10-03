import { Type } from 'typebox';
import { describe, expect, it } from 'vitest';

import { alignToSchema } from './align-to-schema.js';
import { validateAgentTaskSubmission } from './output-contract.js';
import { getSubmitOutputContract } from './output-tools.js';

const schema = getSubmitOutputContract('fulfill_brief')!.parametersSchema;
const valid = {
  branch: 'feat/align',
  commits: [],
  pullRequestUrl: null,
  diaryEntryIds: [],
  summary: 'Done.',
};
const commit = {
  sha: 'abcdef123',
  message: 'feat: align',
  diaryEntryId: null,
};

describe('alignToSchema', () => {
  it.each([
    ['valid payload', valid, [], true],
    ['output envelope', { output: valid }, ['output_envelope'], true],
    ['stringified array', { ...valid, commits: '[]' }, ['json_string'], true],
    ['single commit', { ...valid, commits: commit }, ['single_to_array'], true],
    [
      'bare diary id',
      { ...valid, diaryEntryIds: '11111111-1111-4111-8111-111111111111' },
      ['single_to_array'],
      true,
    ],
    [
      'stringified commit item',
      { ...valid, commits: [JSON.stringify(commit)] },
      ['json_string'],
      true,
    ],
    ['unknown key', { ...valid, extra: true }, [], false],
  ] as const)('%s', (_name, value, kinds, accepted) => {
    // Arrange: the same schema is advertised to every executor.
    // Act
    const aligned = alignToSchema(value, schema);
    const errors = validateAgentTaskSubmission('fulfill_brief', aligned.value);
    // Assert
    expect(errors.length === 0).toBe(accepted);
    expect(aligned.repairs.map((r) => r.kind)).toEqual(kinds);
  });

  it('aligns nested arrays, numeric and boolean strings, and enum case', () => {
    const nested = Type.Object(
      {
        rows: Type.Array(
          Type.Object(
            {
              score: Type.Number(),
              enabled: Type.Boolean(),
              verdict: Type.Union([Type.Literal('pass'), Type.Literal('fail')]),
            },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    );
    const aligned = alignToSchema(
      { rows: [{ score: '0.8', enabled: 'true', verdict: 'PASS' }] },
      nested,
    );
    expect(aligned.value).toEqual({
      rows: [{ score: 0.8, enabled: true, verdict: 'pass' }],
    });
    expect(aligned.repairs).toEqual([
      { kind: 'json_string', path: '/rows/0/score' },
      { kind: 'json_string', path: '/rows/0/enabled' },
      { kind: 'case_insensitive_match', path: '/rows/0/verdict' },
    ]);
  });
});
