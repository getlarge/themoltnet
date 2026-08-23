import { describe, expect, it } from 'vitest';

import { assertControlEvidence, stableJson } from './evidence.js';
import type { ControlEvidence } from './types.js';

function evidence(overrides: Partial<ControlEvidence> = {}): ControlEvidence {
  return {
    scenarioId: 'network.deny-all',
    requestedIntent: {
      scenarioId: 'network.deny-all',
      domain: 'network',
      control: 'default-deny-egress',
      required: true,
    },
    resolvedAdapterConfig: null,
    backend: { id: 'fixture', version: '1' },
    enforcementLocus: ['fixture'],
    state: 'enforced',
    basis: 'verified',
    oracle: {
      kind: 'request-log',
      expected: 0,
      observed: 0,
      passed: true,
    },
    reasonCode: 'oracle_passed',
    recordedAt: '2026-08-23T00:00:00.000Z',
    persistentMutations: [],
    ...overrides,
  };
}

describe('sandbox policy evidence', () => {
  it('requires an independent verified oracle for enforced controls', () => {
    expect(() => assertControlEvidence(evidence())).not.toThrow();
    expect(() => assertControlEvidence(evidence({ basis: 'applied' }))).toThrow(
      'enforced requires verified evidence',
    );
    expect(() => assertControlEvidence(evidence({ oracle: null }))).toThrow(
      'enforced requires a passing oracle',
    );
  });

  it('requires a failing verified oracle for failed-open controls', () => {
    expect(() =>
      assertControlEvidence(
        evidence({
          state: 'failed-open',
          oracle: {
            kind: 'marker',
            expected: 'absent',
            observed: 'present',
            passed: false,
          },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertControlEvidence(evidence({ state: 'failed-open' })),
    ).toThrow('failed-open requires a failing verified oracle');
  });

  it('serializes records with UTF-8 byte-sorted keys', () => {
    expect(stableJson({ z: 1, a: { c: 3, b: 2 } })).toBe(
      '{\n  "a": {\n    "b": 2,\n    "c": 3\n  },\n  "z": 1\n}\n',
    );
  });
});
