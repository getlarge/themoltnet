import { describe, expect, it } from 'vitest';

import {
  validateAgentOutputContract,
  validateAgentTaskOutput,
  validateAgentTaskSubmission,
} from './output-contract.js';

const input = {
  brief: 'Classify.',
  outputContract: {
    version: 1,
    schema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['technical', 'legal'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['category', 'confidence'],
      additionalProperties: false,
    },
  },
};

describe('daemon-owned freeform output contract', () => {
  it('rejects unsupported schemas before execution', () => {
    const errors = validateAgentOutputContract('freeform', {
      ...input,
      outputContract: {
        version: 1,
        schema: { ...input.outputContract.schema, $ref: '#/other' },
      },
    });
    expect(errors[0]?.field).toBe('input/outputContract/schema');
    expect(errors[0]?.message).toContain('$ref');
  });

  it('reports nested field errors for the submit tool and final recovery', () => {
    const invalid = {
      summary: 'Classified.',
      result: { category: 'technical', confidence: 1.5 },
    };
    for (const errors of [
      validateAgentTaskSubmission('freeform', invalid, input),
      validateAgentTaskOutput('freeform', invalid, input),
    ]) {
      expect(errors).toEqual([
        expect.objectContaining({ field: 'output/result/confidence' }),
      ]);
    }
  });

  it('requires a result only for contracted tasks', () => {
    expect(
      validateAgentTaskSubmission('freeform', { summary: 'Done.' }, input),
    ).toContainEqual({ field: 'output/result', message: 'is required' });
    expect(
      validateAgentTaskSubmission(
        'freeform',
        { summary: 'Done.' },
        {
          brief: 'Uncontracted.',
        },
      ),
    ).toEqual([]);
  });

  it('points to a missing nested property', () => {
    const nested = {
      brief: 'Describe rooms.',
      outputContract: {
        version: 1,
        schema: {
          type: 'object',
          properties: {
            rooms: {
              type: 'object',
              properties: { bedroom: { type: 'string' } },
              required: ['bedroom'],
              additionalProperties: false,
            },
          },
          required: ['rooms'],
          additionalProperties: false,
        },
      },
    };

    expect(
      validateAgentTaskSubmission(
        'freeform',
        { summary: 'Done.', result: { rooms: {} } },
        nested,
      ),
    ).toContainEqual({
      field: 'output/result/rooms/bedroom',
      message: 'must have required property bedroom',
    });
  });
});
