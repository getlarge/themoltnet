import { describe, expect, it } from 'vitest';

import {
  sanitizeForPersistence,
  sanitizeProbeRunForPersistence,
} from './sanitize.js';
import type { SandboxProbeRun } from './types.js';

describe('sandbox policy evidence sanitization', () => {
  it('replaces known machine paths before persistence', () => {
    const output = sanitizeForPersistence(
      { path: '/private/tmp/moltnet-1972/workspace/file.txt' },
      { machinePaths: ['/private/tmp/moltnet-1972'] },
    );

    expect(output).toContain('$HOST_PATH/workspace/file.txt');
    expect(output).not.toContain('/private/tmp/moltnet-1972');
  });

  it('refuses credential sentinels, private keys, and token-like values', () => {
    expect(() =>
      sanitizeForPersistence(
        { output: 'host-only-sentinel' },
        { sensitiveValues: ['host-only-sentinel'] },
      ),
    ).toThrow('synthetic credential sentinel');
    expect(() =>
      sanitizeForPersistence({ output: '-----BEGIN PRIVATE KEY-----' }),
    ).toThrow('private-key material');
    expect(() =>
      sanitizeForPersistence({ output: `ghp_${'a'.repeat(30)}` }),
    ).toThrow('token-like material');
    expect(() =>
      sanitizeForPersistence({ output: `ory_pat_${'a'.repeat(30)}` }),
    ).toThrow('token-like material');
  });

  it('checks raw, escaped, base64, and percent-encoded sentinel forms', () => {
    const sentinel = 'sec"ret\\value';
    const options = { sensitiveValues: [sentinel] };
    const forms = [
      sentinel,
      JSON.stringify(sentinel).slice(1, -1),
      Buffer.from(sentinel).toString('base64'),
      encodeURIComponent(sentinel),
    ];

    for (const form of forms) {
      expect(() =>
        sanitizeForPersistence(
          { nested: [{ output: `prefix:${form}:suffix` }] },
          options,
        ),
      ).toThrow('synthetic credential sentinel');
    }
    expect(() =>
      sanitizeForPersistence({ output: 'safe' }, { sensitiveValues: [] }),
    ).not.toThrow();
  });

  it('sanitizes object keys as well as values', () => {
    expect(() =>
      sanitizeForPersistence(
        { 'host-only-sentinel': 'safe' },
        { sensitiveValues: ['host-only-sentinel'] },
      ),
    ).toThrow('synthetic credential sentinel');
  });

  it('refuses bare and nested unknown home-directory paths', () => {
    expect(() =>
      sanitizeForPersistence({ output: '/Users/someone/private/file' }),
    ).toThrow('absolute host path');
    expect(() => sanitizeForPersistence({ output: '/home/runner' })).toThrow(
      'absolute host path',
    );
    expect(() =>
      sanitizeForPersistence({ output: String.raw`C:\Users\someone` }),
    ).toThrow('absolute host path');
  });

  it('refuses non-plain objects before canonical persistence', () => {
    expect(() => sanitizeForPersistence({ when: new Date() })).toThrow(
      'non-plain object',
    );
  });

  it('promotes evidence-leak only after validating the complete run', () => {
    const run = probeRun();
    const persisted = sanitizeProbeRunForPersistence(run, {
      sensitiveValues: ['synthetic-secret'],
    });
    const parsed = JSON.parse(persisted) as SandboxProbeRun;

    expect(parsed.controls[0]).toMatchObject({
      state: 'enforced',
      basis: 'harness-observed',
      oracle: {
        observed: { registeredSensitiveValues: 1, leakHits: 0 },
        passed: true,
      },
    });
    expect(run.controls[0]?.state).toBe('unsupported');

    const failed = JSON.parse(
      sanitizeProbeRunForPersistence(
        {
          ...run,
          violations: [{ code: 'adapter_inspect_error', message: 'leaked' }],
        },
        { sensitiveValues: ['leaked'] },
      ),
    ) as SandboxProbeRun;
    expect(failed.controls[0]).toMatchObject({
      state: 'failed-open',
      reasonCode: 'evidence_persistence_validation_failed',
      oracle: {
        observed: { registeredSensitiveValues: 1, leakHits: 1 },
        passed: false,
      },
    });
    expect(JSON.stringify(failed)).not.toContain('leaked');
  });

  it('does not pass evidence-leak without a registered sensitive value', () => {
    const parsed = JSON.parse(
      sanitizeProbeRunForPersistence(probeRun(), { sensitiveValues: [] }),
    ) as SandboxProbeRun;

    expect(parsed.controls[0]).toMatchObject({
      state: 'failed-open',
      oracle: {
        observed: { registeredSensitiveValues: 0, leakHits: 0 },
        passed: false,
      },
    });
  });
});

function probeRun(): SandboxProbeRun {
  return {
    schemaVersion: 1,
    catalogVersion: 'test',
    runId: 'run',
    sourceRevision: 'revision',
    recordedAt: '2026-08-24T00:00:00.000Z',
    backend: {
      id: 'fixture',
      version: '1',
      os: 'test',
      architecture: 'test',
      topology: ['test'],
    },
    controls: [
      {
        scenarioId: 'credential.evidence-leak',
        requestedIntent: {
          scenarioId: 'credential.evidence-leak',
          domain: 'credential',
          control: 'value-free-evidence',
          required: true,
        },
        resolvedAdapterConfig: null,
        backend: { id: 'fixture', version: '1' },
        enforcementLocus: ['research-harness'],
        state: 'unsupported',
        unsupportedKind: 'not-measured',
        basis: 'declared',
        oracle: null,
        reasonCode: 'value_free_evidence_only',
        recordedAt: '2026-08-24T00:00:00.000Z',
        persistentMutations: [],
      },
    ],
    hostCapabilities: [],
    cleanup: [],
    cleanupComplete: true,
    sensitiveDiagnosticRedactions: 0,
    violations: [],
  };
}
