import { describe, expect, it } from 'vitest';

import {
  assertControlEvidence,
  assertProbeRun,
  stableJson,
  validateProbeRun,
} from './evidence.js';
import type { ControlEvidence, SandboxProbeRun } from './types.js';

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
    reasonCode: 'exact_destination_allow_observed',
    recordedAt: '2026-08-23T00:00:00.000Z',
    persistentMutations: [],
    ...overrides,
  };
}

describe('sandbox policy evidence', () => {
  it('requires an independent verified oracle for enforced controls', () => {
    expect(() => assertControlEvidence(evidence())).not.toThrow();
    expect(() => assertControlEvidence(evidence({ basis: 'applied' }))).toThrow(
      'enforced requires a passing verified oracle',
    );
    expect(() => assertControlEvidence(evidence({ oracle: null }))).toThrow(
      'enforced requires a passing verified oracle',
    );
  });

  it('defines the remaining state, basis, and oracle combinations', () => {
    expect(() =>
      assertControlEvidence(
        evidence({ state: 'unsupported', basis: 'applied', oracle: null }),
      ),
    ).not.toThrow();
    expect(() =>
      assertControlEvidence(
        evidence({
          state: 'degraded',
          oracle: { kind: 'partial', expected: 2, observed: 1, passed: false },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertControlEvidence(
        evidence({
          state: 'failed',
          basis: 'harness-observed',
          oracle: null,
          reasonCode: 'adapter_scenario_error',
          enforcementLocus: ['research-harness'],
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertControlEvidence(
        evidence({ state: 'unsupported', basis: 'verified', oracle: null }),
      ),
    ).toThrow('unsupported requires declared or applied evidence');
  });

  it('returns validation violations without discarding a probe run', () => {
    const invalid = evidence({
      basis: 'declared',
      enforcementLocus: ['fixture'],
    });
    const run: SandboxProbeRun = {
      schemaVersion: 1,
      catalogVersion: 'test',
      runId: 'run',
      sourceRevision: 'revision',
      recordedAt: '2026-08-23T00:00:00.000Z',
      backend: {
        id: 'fixture',
        version: '1',
        os: 'test',
        architecture: 'test',
        topology: [],
      },
      controls: [invalid, invalid],
      hostCapabilities: [],
      cleanup: [],
      cleanupComplete: true,
      violations: [],
    };

    expect(validateProbeRun(run)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'evidence_validation_error' }),
        expect.objectContaining({
          message: 'duplicate control evidence: network.deny-all',
        }),
      ]),
    );
    expect(() => assertProbeRun(run)).toThrow('duplicate control evidence');
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
    expect(() => stableJson({ date: new Date() })).toThrow(
      'only plain objects',
    );
  });
});
