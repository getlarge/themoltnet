import { describe, expect, it } from 'vitest';

import { parseStructuredTaskOutput } from './task-output.js';

const validBrief = {
  branch: 'feat/x',
  commits: [],
  pullRequestUrl: null,
  diaryEntryIds: [],
  summary: 'Done.',
};

describe('schema aligned final-message parsing', () => {
  it.each([
    ['valid', JSON.stringify(validBrief), true, []],
    [
      'envelope',
      JSON.stringify({ output: validBrief }),
      true,
      ['output_envelope'],
    ],
    [
      'stringified array',
      JSON.stringify({ ...validBrief, commits: '[]' }),
      true,
      ['json_string'],
    ],
    [
      'single object',
      JSON.stringify({
        ...validBrief,
        commits: { sha: 'abcdef123', message: 'm', diaryEntryId: null },
      }),
      true,
      ['single_to_array'],
    ],
    [
      'bare diary id',
      JSON.stringify({
        ...validBrief,
        diaryEntryIds: '11111111-1111-4111-8111-111111111111',
      }),
      true,
      ['single_to_array'],
    ],
    [
      'stringified item',
      JSON.stringify({
        ...validBrief,
        commits: [
          JSON.stringify({
            sha: 'abcdef123',
            message: 'm',
            diaryEntryId: null,
          }),
        ],
      }),
      true,
      ['json_string'],
    ],
    ['unknown key', JSON.stringify({ ...validBrief, extra: 1 }), false, []],
    [
      'trailing comma',
      '{"branch":"feat/x","commits":[],"pullRequestUrl":null,"diaryEntryIds":[],"summary":"Done.",}',
      true,
      ['lenient_json'],
    ],
    [
      'comment',
      '{"branch":"feat/x", // note\n"commits":[],"pullRequestUrl":null,"diaryEntryIds":[],"summary":"Done."}',
      true,
      ['lenient_json'],
    ],
    [
      'single quotes',
      "{'branch':'feat/x','commits':[],'pullRequestUrl':null,'diaryEntryIds':[],'summary':'Done.'}",
      true,
      ['lenient_json'],
    ],
    [
      'unquoted keys',
      "{branch:'feat/x',commits:[],pullRequestUrl:null,diaryEntryIds:[],summary:'Done.'}",
      true,
      ['lenient_json'],
    ],
    [
      'missing object comma',
      '{"branch":"feat/x" "commits":[],"pullRequestUrl":null,"diaryEntryIds":[],"summary":"Done."}',
      true,
      ['missing_comma'],
    ],
    ['truncated', '{"branch":"feat/x","commits":[]', false, []],
  ] as const)('%s', async (_name, text, accepted, kinds) => {
    const parsed = await parseStructuredTaskOutput(text, 'fulfill_brief');
    expect(parsed.error === null).toBe(accepted);
    expect(parsed.repairs?.map((repair) => repair.kind) ?? []).toEqual(kinds);
  });
});

const input = {
  brief: 'Classify.',
  outputContract: {
    version: 1,
    schema: {
      type: 'object',
      properties: { confidence: { type: 'number', minimum: 0, maximum: 1 } },
      required: ['confidence'],
      additionalProperties: false,
    },
  },
};

describe('final-message contract validation', () => {
  it('does not recover an invalid custom result from assistant text', async () => {
    const parsed = await parseStructuredTaskOutput(
      JSON.stringify({ summary: 'Done.', result: { confidence: 1.5 } }),
      'freeform',
      { input },
    );

    expect(parsed.output).toBeNull();
    expect(parsed.outputCid).toBeNull();
    expect(parsed.error).toMatchObject({
      code: 'output_validation_failed',
      message: expect.stringContaining('output/result/confidence'),
    });
  });
});
