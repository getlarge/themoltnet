import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';

import {
  RuntimeModelCapabilities,
  RuntimeModelName,
  supportsRuntimeModelCapability,
} from '../src/runtime-models.js';

describe('runtime catalog capability hints', () => {
  it.each([
    [undefined, true, false],
    [{}, true, false],
    [{ supportsTools: true }, true, false],
    [{ classification: true }, false, true],
    [{ generation: true, classification: true }, true, true],
    [{ generation: false, classification: false }, false, false],
  ])(
    'selects suggestions for %j',
    (capabilities, generation, classification) => {
      expect(supportsRuntimeModelCapability(capabilities, 'generation')).toBe(
        generation,
      );
      expect(
        supportsRuntimeModelCapability(capabilities, 'classification'),
      ).toBe(classification);
    },
  );

  it('requires boolean capability flags while retaining other catalog metadata', () => {
    expect(
      Value.Check(RuntimeModelCapabilities, {
        classification: true,
        contextWindow: 8192,
      }),
    ).toBe(true);
    expect(
      Value.Check(RuntimeModelCapabilities, { classification: 'true' }),
    ).toBe(false);
    expect(Value.Check(RuntimeModelCapabilities, { '': true })).toBe(false);
    expect(
      Value.Check(RuntimeModelCapabilities, { ['x'.repeat(65)]: true }),
    ).toBe(false);
    expect(Value.Check(RuntimeModelCapabilities, { generation: 1 })).toBe(
      false,
    );
  });
});

describe('Pi model catalog names', () => {
  it.each([
    'typesafe/jev',
    '~typesafe/jev-latest',
    '@cf/typesafe/jev-latest',
    'qwen:latest',
  ])('accepts qualified model ID %s', (id) => {
    expect(Value.Check(RuntimeModelName, id)).toBe(true);
  });
  it.each(['typesafe/je\nv', 'model name', '/model', ''])(
    'rejects invalid ID %j',
    (id) => {
      expect(Value.Check(RuntimeModelName, id)).toBe(false);
    },
  );
});
