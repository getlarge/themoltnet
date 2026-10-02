import { Type } from 'typebox';
import { describe, expect, it } from 'vitest';

import {
  getTaskSubmissionSchema,
  normalizeTaskInputForCreate,
  validateTaskInput,
  validateTaskOutput,
} from '../validation.js';
import { reviewResultContractSchema } from './output-contract.js';

const schema = {
  type: 'object',
  properties: { category: { type: 'string', enum: ['technical', 'legal'] } },
  required: ['category'],
  additionalProperties: false,
};

describe('freeform contract storage shape', () => {
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

describe('reviewResultContractSchema', () => {
  it('projects nested review fields into the freeform contract subset', () => {
    const resultSchema = Type.Object({
      version: Type.Literal(1),
      findings: Type.Array(
        Type.Object({
          id: Type.String({ pattern: '^[a-z]+$' }),
          verdict: Type.Union([Type.Literal('keep'), Type.Literal('remove')]),
          section: Type.Optional(Type.String()),
        }),
        { maxItems: 3 },
      ),
    });

    expect(reviewResultContractSchema(resultSchema)).toEqual({
      type: 'object',
      properties: {
        version: { type: 'number', enum: [1] },
        findings: {
          type: 'array',
          maxItems: 3,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              verdict: { type: 'string', enum: ['keep', 'remove'] },
              section: { type: 'string' },
            },
            required: ['id', 'verdict'],
            additionalProperties: false,
          },
        },
      },
      required: ['version', 'findings'],
      additionalProperties: false,
    });
  });

  it('rejects unions outside the contract subset', () => {
    expect(() =>
      reviewResultContractSchema(
        Type.Union([Type.Literal('pass'), Type.Literal(1)]),
      ),
    ).toThrow('literals of one primitive type');
  });
});
