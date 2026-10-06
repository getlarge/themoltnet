import { Type } from 'typebox';
import { Value } from 'typebox/value';
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

  it('combines array, item, and envelope repairs with exact paths', () => {
    const input = {
      output: {
        ...valid,
        commits: JSON.stringify([JSON.stringify(commit)]),
      },
    };

    const aligned = alignToSchema(input, schema);

    expect(aligned.value).toEqual({ ...valid, commits: [commit] });
    expect(aligned.repairs).toEqual([
      { kind: 'output_envelope', path: '' },
      { kind: 'json_string', path: '/commits' },
      { kind: 'json_string', path: '/commits/0' },
    ]);
    expect(validateAgentTaskSubmission('fulfill_brief', aligned.value)).toEqual(
      [],
    );
  });

  it.each([
    ['unknown nested key', { ...valid, commits: [{ ...commit, extra: 1 }] }],
    ['missing required field', { commits: [], summary: 'Done.' }],
    ['misspelled field', { ...valid, branche: 'feat/align' }],
    ['malformed JSON string', { ...valid, commits: '[{"sha":' }],
  ])('does not make %s valid', (_name, input) => {
    const aligned = alignToSchema(input, schema);

    expect(
      validateAgentTaskSubmission('fulfill_brief', aligned.value),
    ).not.toEqual([]);
    expect(aligned.value).toEqual(input);
    expect(aligned.repairs).toEqual([]);
  });

  it('strips only non-nullable optional nulls and preserves the input', () => {
    const nested = Type.Object(
      {
        rows: Type.Array(
          Type.Object(
            {
              score: Type.Number({ minimum: 0, maximum: 1 }),
              enabled: Type.Boolean(),
              verdict: Type.Union([Type.Literal('pass'), Type.Literal('fail')]),
              note: Type.Optional(Type.String()),
            },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    );
    const input = {
      rows: [
        { score: '0.8', enabled: 'true', verdict: 'PASS', note: null },
        { score: 0.4, enabled: false, verdict: 'fail', note: 'keep' },
      ],
    };

    const aligned = alignToSchema(input, nested);

    expect(aligned.value).toEqual({
      rows: [
        { score: 0.8, enabled: true, verdict: 'pass' },
        { score: 0.4, enabled: false, verdict: 'fail', note: 'keep' },
      ],
    });
    expect(aligned.repairs).toEqual([
      { kind: 'json_string', path: '/rows/0/score' },
      { kind: 'json_string', path: '/rows/0/enabled' },
      { kind: 'case_insensitive_match', path: '/rows/0/verdict' },
      { kind: 'optional_null', path: '/rows/0/note' },
    ]);
    expect(Value.Check(nested, aligned.value)).toBe(true);
    expect(input.rows[0].note).toBeNull();

    const again = alignToSchema(aligned.value, nested);
    expect(again).toEqual({ value: aligned.value, repairs: [] });
  });

  it('keeps required null and valid nullable optional null', () => {
    const nullable = Type.Object(
      {
        required: Type.String(),
        note: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      },
      { additionalProperties: false },
    );

    const invalid = alignToSchema({ required: null, note: null }, nullable);
    const accepted = alignToSchema({ required: 'ok', note: null }, nullable);

    expect(invalid).toEqual({
      value: { required: null, note: null },
      repairs: [],
    });
    expect(Value.Check(nullable, invalid.value)).toBe(false);
    expect(accepted).toEqual({
      value: { required: 'ok', note: null },
      repairs: [],
    });
  });

  it('does not unwrap an output field when it has siblings or is declared', () => {
    const nested = Type.Object(
      { rows: Type.Array(Type.Number()) },
      { additionalProperties: false },
    );
    const withSibling = { output: { rows: [] }, trace: 'keep' };
    const declaredSchema = Type.Object(
      { output: Type.Object({ value: Type.Number() }) },
      { additionalProperties: false },
    );
    const declared = { output: { value: 1 } };

    expect(alignToSchema(withSibling, nested)).toEqual({
      value: withSibling,
      repairs: [],
    });
    expect(alignToSchema(declared, declaredSchema)).toEqual({
      value: declared,
      repairs: [],
    });
  });

  it('escapes JSON pointer members and reports array indexes', () => {
    const nested = Type.Object(
      { 'a/b~c': Type.Array(Type.Number()) },
      { additionalProperties: false },
    );

    const aligned = alignToSchema({ 'a/b~c': ['2'] }, nested);

    expect(aligned.value).toEqual({ 'a/b~c': [2] });
    expect(aligned.repairs).toEqual([
      { kind: 'json_string', path: '/a~1b~0c/0' },
    ]);
  });

  it('reports partial repairs while leaving invalid nested data for strict validation', () => {
    const nested = Type.Object(
      {
        rows: Type.Array(
          Type.Object(
            {
              score: Type.Number({ maximum: 1 }),
              verdict: Type.Literal('pass'),
            },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    );
    const input = {
      rows: [{ score: '1.2', verdict: 'PASS', extra: 'unknown' }],
    };

    const aligned = alignToSchema(input, nested);

    expect(aligned.value).toEqual({
      rows: [{ score: 1.2, verdict: 'pass', extra: 'unknown' }],
    });
    expect(aligned.repairs).toEqual([
      { kind: 'json_string', path: '/rows/0/score' },
      { kind: 'case_insensitive_match', path: '/rows/0/verdict' },
    ]);
    expect(Value.Check(nested, aligned.value)).toBe(false);
  });

  it('keeps a decoded string only when it yields a declared JSON type', () => {
    const scalars = Type.Object(
      {
        count: Type.Number(),
        done: Type.Boolean(),
        meta: Type.Object({ ok: Type.Boolean() }),
        maybe: Type.Union([Type.Number(), Type.Null()]),
      },
      { additionalProperties: false },
    );
    const input = { count: 'null', done: 'null', meta: 'null', maybe: 'null' };

    const aligned = alignToSchema(input, scalars);

    expect(aligned.value).toEqual({
      count: 'null',
      done: 'null',
      meta: 'null',
      maybe: null,
    });
    expect(aligned.repairs).toEqual([{ kind: 'json_string', path: '/maybe' }]);
    expect(Value.Check(scalars, aligned.value)).toBe(false);
  });

  it('decodes scalar targets strictly and structured targets leniently', () => {
    const lenient = (text: string) =>
      text === '0x10'
        ? { value: 16, repairs: ['lenient_json' as const] }
        : text === '{a: 1}'
          ? { value: { a: 1 }, repairs: ['lenient_json' as const] }
          : null;
    const mixed = Type.Object(
      {
        count: Type.Number(),
        meta: Type.Object({ a: Type.Number() }),
      },
      { additionalProperties: false },
    );

    const aligned = alignToSchema({ count: '0x10', meta: '{a: 1}' }, mixed, {
      parseJsonString: lenient,
    });

    expect(aligned.value).toEqual({ count: '0x10', meta: { a: 1 } });
    expect(aligned.repairs).toEqual([
      { kind: 'json_string', path: '/meta' },
      { kind: 'lenient_json', path: '/meta' },
    ]);
  });

  it.each([
    ['123', ['123']],
    ['true', ['true']],
    ['null', ['null']],
    ['abc', ['abc']],
  ])('wraps string %s into array<string> as written', (input, expected) => {
    const tags = Type.Object(
      { tags: Type.Array(Type.String()) },
      { additionalProperties: false },
    );

    const aligned = alignToSchema({ tags: input }, tags);

    expect(aligned.value).toEqual({ tags: expected });
    expect(aligned.repairs).toEqual([
      { kind: 'single_to_array', path: '/tags' },
    ]);
  });

  it('still decodes a numeric string for array<number>', () => {
    const counts = Type.Object(
      { counts: Type.Array(Type.Number()) },
      { additionalProperties: false },
    );

    const aligned = alignToSchema({ counts: '5' }, counts);

    expect(aligned.value).toEqual({ counts: [5] });
    expect(aligned.repairs.map((repair) => repair.kind)).toEqual([
      'json_string',
      'single_to_array',
    ]);
  });
});
