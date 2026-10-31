import {
  validateOutputContract,
  validateOutputContractResult,
} from '@moltnet/tasks';
import { Type } from 'typebox';
import { describe, expect, it } from 'vitest';

import { toOutputContractSchema } from '../src/output-contract-schema.js';

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
    ).toThrow('one primitive type');
  });

  it('keeps descriptions, titles, enums, and nullable primitives', () => {
    // Arrange
    const resultSchema = Type.Object(
      {
        status: Type.Enum(['open', 'closed'], { description: 'Issue state' }),
        owner: Type.Union([Type.String(), Type.Null()], {
          description: 'Login, or null when unassigned',
        }),
      },
      { title: 'Issue' },
    );

    // Act
    const projected = toOutputContractSchema(resultSchema);

    // Assert
    expect(projected).toEqual({
      type: 'object',
      title: 'Issue',
      properties: {
        status: {
          type: 'string',
          enum: ['open', 'closed'],
          description: 'Issue state',
        },
        owner: {
          type: ['string', 'null'],
          description: 'Login, or null when unassigned',
        },
      },
      required: ['status', 'owner'],
      additionalProperties: false,
    });
    expect(
      validateOutputContract('freeform', {
        outputContract: { version: 1, schema: projected },
      }),
    ).toEqual([]);
  });

  it('returns a schema already inside the contract subset unchanged', () => {
    // Arrange
    const contract = {
      type: 'object',
      description: 'Rooms',
      properties: {
        kind: { type: 'string', enum: ['a', 'b'], maxLength: 1 },
        note: { type: ['string', 'null'] },
        sizes: { type: 'array', items: { type: 'integer', minimum: 0 } },
      },
      required: ['kind'],
      additionalProperties: false,
    };

    // Act
    const projected = toOutputContractSchema(contract);

    // Assert
    expect(projected).toEqual(contract);
  });

  it.each([
    ['a nullable literal', Type.Union([Type.Literal('a'), Type.Null()])],
    [
      'a nullable literal union',
      Type.Union([Type.Literal('a'), Type.Literal('b'), Type.Null()]),
    ],
    ['a nullable enum', Type.Union([Type.Enum(['a', 'b']), Type.Null()])],
  ])('lets %s accept null and its values', (_name, value) => {
    // Arrange
    const input = {
      outputContract: {
        version: 1,
        schema: toOutputContractSchema(Type.Object({ value })),
      },
    };
    const output = (result: unknown) => ({ summary: 's', result });

    // Act
    const nullErrors = validateOutputContractResult(
      'freeform',
      input,
      output({ value: null }),
    );
    const valueErrors = validateOutputContractResult(
      'freeform',
      input,
      output({ value: 'a' }),
    );
    const otherErrors = validateOutputContractResult(
      'freeform',
      input,
      output({ value: 'c' }),
    );

    // Assert
    expect(validateOutputContract('freeform', input)).toEqual([]);
    expect(nullErrors).toEqual([]);
    expect(valueErrors).toEqual([]);
    expect(otherErrors).not.toEqual([]);
  });

  it.each([
    ['an object without properties', Type.Record(Type.String(), Type.String())],
    ['an array without items', { type: 'array' }],
    ['an enum value of another type', { type: 'string', enum: ['a', 1] }],
    ['null in a non-nullable enum', { type: 'string', enum: ['a', null] }],
    ['a nullable object', Type.Union([Type.Object({}), Type.Null()])],
  ])('rejects %s with an explicit error', (_name, schema) => {
    // Act
    const projecting = () =>
      toOutputContractSchema(schema as Record<string, unknown>);

    // Assert
    expect(projecting).toThrow('unsupported output contract schema');
  });

  it('rejects schemas nested deeper than the contract allows', () => {
    // Arrange
    let schema: Record<string, unknown> = { type: 'string' };
    for (let level = 0; level < 12; level++) {
      schema = { type: 'array', items: schema };
    }

    // Act
    const projecting = () => toOutputContractSchema(schema);

    // Assert
    expect(projecting).toThrow('nested deeper');
  });
});
