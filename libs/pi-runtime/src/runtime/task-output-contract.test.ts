import { describe, expect, it } from 'vitest';

import { parseStructuredTaskOutput } from './task-output.js';

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
