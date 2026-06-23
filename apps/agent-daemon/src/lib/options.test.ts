import { describe, expect, it } from 'vitest';

import {
  DeprecatedRuntimeOptionError,
  MissingRequiredOptionError,
  parseCommonOptions,
  validateTaskTypes,
} from './options.js';

describe('parseCommonOptions', () => {
  const valid = {
    agent: 'legreffier',
  };

  it('throws MissingRequiredOptionError when --agent is missing', () => {
    expect(() => parseCommonOptions({ ...valid, agent: undefined })).toThrow(
      MissingRequiredOptionError,
    );
    try {
      parseCommonOptions({ ...valid, agent: undefined });
    } catch (err) {
      expect(err).toBeInstanceOf(MissingRequiredOptionError);
      expect((err as MissingRequiredOptionError).flag).toBe('agent');
    }
  });

  it('rejects deprecated provider/model flags', () => {
    expect(() =>
      parseCommonOptions({ ...valid, provider: 'anthropic' }),
    ).toThrow(DeprecatedRuntimeOptionError);
    expect(() =>
      parseCommonOptions({ ...valid, model: 'claude-sonnet-4-5' }),
    ).toThrow(/--model is no longer supported/);
  });

  it('rejects --agent with traversal-unsafe characters', () => {
    expect(() =>
      parseCommonOptions({ ...valid, agent: '../etc/passwd' }),
    ).toThrow(/must match/);
    expect(() => parseCommonOptions({ ...valid, agent: 'has spaces' })).toThrow(
      /must match/,
    );
  });

  it('returns parsed options with defaults for non-required flags', () => {
    const result = parseCommonOptions(valid);
    expect(result).toEqual({
      agent: 'legreffier',
      leaseTtlSec: 300,
      heartbeatIntervalMs: 60_000,
      maxBatchSize: 50,
      flushIntervalMs: 200,
      maxTurns: 0,
      maxBashTimeouts: 3,
      warmSessionTtlSec: 1800,
      debug: false,
    });
  });

  it('overrides defaults when explicit numeric flags are passed', () => {
    const result = parseCommonOptions({
      ...valid,
      'lease-ttl-sec': '60',
      'heartbeat-interval-ms': '5000',
      'max-batch-size': '10',
      'flush-interval-ms': '0',
      'max-turns': '30',
      'max-bash-timeouts': '5',
      'warm-session-ttl-sec': '90',
    });
    expect(result.leaseTtlSec).toBe(60);
    expect(result.heartbeatIntervalMs).toBe(5_000);
    expect(result.maxBatchSize).toBe(10);
    expect(result.flushIntervalMs).toBe(0);
    expect(result.maxTurns).toBe(30);
    expect(result.maxBashTimeouts).toBe(5);
    expect(result.warmSessionTtlSec).toBe(90);
  });

  it('uses profile runtime defaults when explicit numeric flags are absent', () => {
    const result = parseCommonOptions(valid, {
      runtimeDefaults: {
        leaseTtlSec: 900,
        heartbeatIntervalMs: 15_000,
        maxBatchSize: 7,
        warmSessionTtlSec: 120,
      },
    });

    expect(result.leaseTtlSec).toBe(900);
    expect(result.heartbeatIntervalMs).toBe(15_000);
    expect(result.maxBatchSize).toBe(7);
    expect(result.warmSessionTtlSec).toBe(120);
  });

  it('lets explicit numeric flags override profile runtime defaults', () => {
    const result = parseCommonOptions(
      {
        ...valid,
        'lease-ttl-sec': '60',
        'heartbeat-interval-ms': '5000',
        'max-batch-size': '10',
        'warm-session-ttl-sec': '90',
      },
      {
        runtimeDefaults: {
          leaseTtlSec: 900,
          heartbeatIntervalMs: 15_000,
          maxBatchSize: 7,
          warmSessionTtlSec: 120,
        },
      },
    );

    expect(result.leaseTtlSec).toBe(60);
    expect(result.heartbeatIntervalMs).toBe(5_000);
    expect(result.maxBatchSize).toBe(10);
    expect(result.warmSessionTtlSec).toBe(90);
  });

  it('accepts --max-turns=0 and --max-bash-timeouts=0 as "disabled"', () => {
    const result = parseCommonOptions({
      ...valid,
      'max-turns': '0',
      'max-bash-timeouts': '0',
    });
    expect(result.maxTurns).toBe(0);
    expect(result.maxBashTimeouts).toBe(0);
  });

  it('rejects negative --max-turns / --max-bash-timeouts', () => {
    expect(() => parseCommonOptions({ ...valid, 'max-turns': '-1' })).toThrow(
      /non-negative integer/,
    );
    expect(() =>
      parseCommonOptions({ ...valid, 'max-bash-timeouts': '-1' }),
    ).toThrow(/non-negative integer/);
  });

  it('rejects --lease-ttl-sec=0 (must be positive)', () => {
    expect(() =>
      parseCommonOptions({ ...valid, 'lease-ttl-sec': '0' }),
    ).toThrow(/positive integer/);
  });

  it('rejects --heartbeat-interval-ms=-1 (non-negative)', () => {
    expect(() =>
      parseCommonOptions({ ...valid, 'heartbeat-interval-ms': '-1' }),
    ).toThrow(/non-negative integer/);
  });

  it('rejects non-integer numeric flags', () => {
    expect(() =>
      parseCommonOptions({ ...valid, 'lease-ttl-sec': '60.5' }),
    ).toThrow(/positive integer/);
    expect(() =>
      parseCommonOptions({ ...valid, 'max-batch-size': 'not-a-number' }),
    ).toThrow(/positive integer/);
  });
});

describe('validateTaskTypes', () => {
  it('returns the input array for known task types', () => {
    expect(validateTaskTypes(['curate_pack'])).toEqual(['curate_pack']);
    expect(validateTaskTypes(['fulfill_brief', 'judge_pack'])).toEqual([
      'fulfill_brief',
      'judge_pack',
    ]);
  });

  it('returns an empty array for an empty input', () => {
    expect(validateTaskTypes([])).toEqual([]);
  });

  it('throws for an unknown task type with the known-list in the message', () => {
    expect(() => validateTaskTypes(['curate_pck'])).toThrow(
      /Unknown task type\(s\): curate_pck\. Known types:/,
    );
  });

  it('lists all unknown types in the error', () => {
    expect(() => validateTaskTypes(['bogus', 'also_bogus'])).toThrow(
      /bogus, also_bogus/,
    );
  });

  it('rejects Object.prototype keys (toString, hasOwnProperty)', () => {
    // The `in` operator would let these through; `hasOwnProperty.call`
    // correctly rejects them.
    expect(() => validateTaskTypes(['toString'])).toThrow(/Unknown task type/);
    expect(() => validateTaskTypes(['hasOwnProperty'])).toThrow(
      /Unknown task type/,
    );
    expect(() => validateTaskTypes(['__proto__'])).toThrow(/Unknown task type/);
  });
});
