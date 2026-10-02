import { Type } from 'typebox';
import { describe, expect, it } from 'vitest';

import { toOutputContractSchema } from './output-contract-schema.js';

describe('toOutputContractSchema', () => {
  it('projects nested fields into the task output contract subset', () => {
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

    expect(toOutputContractSchema(resultSchema)).toEqual({
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
      toOutputContractSchema(
        Type.Union([Type.Literal('pass'), Type.Literal(1)]),
      ),
    ).toThrow('literals of one primitive type');
  });
});
