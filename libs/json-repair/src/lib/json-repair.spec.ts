import { describe, expect, it } from 'vitest';

import {
  MAX_COMMA_REPAIR_CHARS,
  parseCompleteJsonValue,
} from './json-repair.js';

describe('parseCompleteJsonValue', () => {
  it.each([
    ['[1,2]', [1, 2], []],
    ['[1,2,]', [1, 2], ['lenient_json']],
    ['[{a:1 b:2}]', [{ a: 1, b: 2 }], ['missing_comma']],
  ] as const)('parses complete value %s', (input, value, repairs) => {
    expect(parseCompleteJsonValue(input)).toEqual({ value, repairs });
  });

  it.each(['[1,2', '{a:1', '[1,2] trailing prose'])(
    'rejects incomplete or trailing content: %s',
    (input) => {
      expect(parseCompleteJsonValue(input)).toBeNull();
    },
  );
});

describe('parseCompleteJsonValue object repairs', () => {
  it.each([
    ['strict JSON', '{"a":1}', { a: 1 }, []],
    ['trailing comma', '{a:1,}', { a: 1 }, ['lenient_json']],
    [
      'comments and single quotes',
      "{'a':1, // note\n b:2}",
      { a: 1, b: 2 },
      ['lenient_json'],
    ],
    [
      'missing object comma',
      '{"a":1 "b":2}',
      { a: 1, b: 2 },
      ['missing_comma'],
    ],
    [
      'nested missing comma',
      '{"a":{"x":1} "b":[2]}',
      { a: { x: 1 }, b: [2] },
      ['missing_comma'],
    ],
    [
      'two missing commas',
      '{"a":1 "b":2 "c":3}',
      { a: 1, b: 2, c: 3 },
      ['missing_comma'],
    ],
  ] as const)(
    'parses %s with explicit repair telemetry',
    (_name, input, value, repairs) => {
      expect(parseCompleteJsonValue(input)).toEqual({ value, repairs });
    },
  );

  it.each([
    '{"a":1',
    '{"a":[1,2',
    '{"a":1 "b":',
    '{"a":1 /* unclosed',
    '{"a":1 "b" 2}',
    '{"a":1 2}',
  ])('rejects incomplete or ambiguous input: %s', (input) => {
    expect(parseCompleteJsonValue(input)).toBeNull();
  });

  it('leaves schema decisions to the caller', () => {
    expect(parseCompleteJsonValue('{"unknown":true}')).toEqual({
      value: { unknown: true },
      repairs: [],
    });
  });
});

describe('parseCompleteJsonValue missing-comma bounds', () => {
  const objectWithoutCommas = (keys: number) =>
    `{${Array.from({ length: keys }, (_, i) => `k${i}: ${i}`).join(' ')}}`;

  it('repairs many missing commas in one pass', () => {
    const parsed = parseCompleteJsonValue(objectWithoutCommas(5000));

    expect(parsed?.repairs).toEqual(['missing_comma']);
    expect(Object.keys(parsed?.value as object)).toHaveLength(5000);
    expect((parsed?.value as Record<string, number>).k4999).toBe(4999);
  });

  it('skips the comma repair above the size cap', () => {
    const keys = Math.ceil(MAX_COMMA_REPAIR_CHARS / 8) + 1;
    const source = objectWithoutCommas(keys);
    expect(source.length).toBeGreaterThan(MAX_COMMA_REPAIR_CHARS);

    expect(parseCompleteJsonValue(source)).toBeNull();
  });
});
