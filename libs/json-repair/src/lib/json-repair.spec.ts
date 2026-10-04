import { describe, expect, it } from 'vitest';

import { parseCompleteJsonObject } from './json-repair.js';

describe('parseCompleteJsonObject', () => {
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
      expect(parseCompleteJsonObject(input)).toEqual({ value, repairs });
    },
  );

  it('ignores punctuation inside strings and reads fenced output', () => {
    const parsed = parseCompleteJsonObject(
      [
        'Result:',
        '```json',
        String.raw`{"message":"a \"b\" : c","count":1}`,
        '```',
      ].join('\n'),
    );
    expect(parsed).toEqual({
      value: { message: 'a "b" : c', count: 1 },
      repairs: [],
    });
  });

  it('handles a long unmatched fence prefix without changing the result', () => {
    const text = `\`\`\`${' '.repeat(50_000)}`;
    expect(parseCompleteJsonObject(text)).toBeNull();
  });

  it.each([
    '{"a":1',
    '{"a":[1,2',
    '{"a":1 "b":',
    '{"a":1 /* unclosed',
    '{"a":1 "b" 2}',
    '{"a":1 2}',
  ])('rejects incomplete or ambiguous input: %s', (input) => {
    expect(parseCompleteJsonObject(input)).toBeNull();
  });

  it('leaves schema decisions to the caller', () => {
    expect(parseCompleteJsonObject('{"unknown":true}')).toEqual({
      value: { unknown: true },
      repairs: [],
    });
  });
});
