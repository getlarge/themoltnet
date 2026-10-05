import { describe, expect, it } from 'vitest';

import {
  validateOutputContract,
  validateOutputContractResult,
} from '../output-contract-validation.js';
import {
  getTaskSubmissionSchema,
  normalizeTaskInputForCreate,
  validateTaskInput,
  validateTaskOutput,
} from '../validation.js';

const schema = {
  type: 'object',
  properties: { category: { type: 'string', enum: ['technical', 'legal'] } },
  required: ['category'],
  additionalProperties: false,
};

describe('freeform contract storage shape', () => {
  it('accepts an optional nullable primitive field in a result contract', () => {
    const input = {
      outputContract: {
        version: 1,
        schema: {
          type: 'object',
          properties: { note: { type: ['string', 'null'] } },
          required: [],
          additionalProperties: false,
        },
      },
    };
    expect(validateOutputContract('freeform', input)).toEqual([]);
    expect(
      validateOutputContractResult('freeform', input, {
        result: { note: null },
      }),
    ).toEqual([]);
    expect(
      validateOutputContractResult('freeform', input, { result: {} }),
    ).toEqual([]);
    expect(
      validateOutputContractResult('freeform', input, { result: { note: 1 } }),
    ).not.toEqual([]);
  });
  it('pins an inline contract without interpreting its custom schema', () => {
    const input = normalizeTaskInputForCreate('freeform', {
      brief: 'Classify the document.',
      outputContract: { version: 1, schema },
    });

    expect(validateTaskInput('freeform', input)).toEqual([]);
    expect(input).toHaveProperty('outputContract.schema', schema);
    expect(getTaskSubmissionSchema('freeform')).not.toHaveProperty(
      'properties.result',
    );
    expect(
      validateTaskOutput(
        'freeform',
        {
          summary: 'Done.',
          result: { category: 'technical' },
          verification: {
            inputCid: 'bafy-input',
            results: [{ id: 'submit-output', kind: 'gate', status: 'pass' }],
            passed: true,
          },
        },
        input,
      ),
    ).toEqual([]);
  });

  it('leaves custom schema validity and result values to the daemon', () => {
    const input = {
      brief: 'Classify the document.',
      outputContract: {
        version: 1,
        schema: { ...schema, $ref: '#/elsewhere' },
      },
    };

    expect(validateTaskInput('freeform', input)).toEqual([]);
    expect(
      validateTaskOutput(
        'freeform',
        { summary: 'Done.', result: { category: 'other' } },
        input,
      ),
    ).toEqual([]);
  });
});
