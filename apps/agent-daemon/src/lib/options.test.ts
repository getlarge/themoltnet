import { describe, expect, it } from 'vitest';

import {
  identityOptionDefs,
  MissingRequiredOptionError,
  parseIdentityProcessOptions,
  parseLocalOperationalSettings,
  parseRuntimeCommandOptions,
  runtimeCommandOptionDefs,
  validateTaskTypes,
} from './options.js';

describe('runtime command options', () => {
  const valid = {
    agent: 'legreffier',
  };

  it('throws MissingRequiredOptionError when --agent is missing', () => {
    expect(() =>
      parseIdentityProcessOptions({ ...valid, agent: undefined }),
    ).toThrow(MissingRequiredOptionError);
    try {
      parseIdentityProcessOptions({ ...valid, agent: undefined });
    } catch (err) {
      expect(err).toBeInstanceOf(MissingRequiredOptionError);
      expect((err as MissingRequiredOptionError).flag).toBe('agent');
    }
  });

  it('keeps identity definitions free of runtime settings', () => {
    const defs = identityOptionDefs();

    expect(defs).not.toHaveProperty('provider');
    expect(defs).not.toHaveProperty('model');
    expect(defs).not.toHaveProperty('guest-credential-mode');
    expect(defs).not.toHaveProperty('heartbeat-interval-ms');
    expect(defs).not.toHaveProperty('warm-retention-sec');
  });

  it('rejects --agent with traversal-unsafe characters', () => {
    expect(() =>
      parseIdentityProcessOptions({ ...valid, agent: '../etc/passwd' }),
    ).toThrow(/must match/);
    expect(() =>
      parseIdentityProcessOptions({ ...valid, agent: 'has spaces' }),
    ).toThrow(/must match/);
  });

  it('parses identity and local settings exactly once into separate groups', () => {
    const result = parseRuntimeCommandOptions(valid);

    expect(result).toEqual({
      identity: { agent: 'legreffier', debug: false },
      operations: { heartbeatIntervalMs: 60_000, warmRetentionSec: 1800 },
    });
  });

  it('accepts only heartbeat and warm retention runtime flags', () => {
    expect(runtimeCommandOptionDefs()).toMatchObject({
      'heartbeat-interval-ms': { type: 'string' },
      'warm-retention-sec': { type: 'string' },
    });

    const result = parseLocalOperationalSettings({
      ...valid,
      'heartbeat-interval-ms': '5000',
      'warm-retention-sec': '90',
    });
    expect(result).toEqual({
      heartbeatIntervalMs: 5_000,
      warmRetentionSec: 90,
    });
  });

  it('rejects negative and non-integer operational settings', () => {
    expect(() =>
      parseLocalOperationalSettings({
        ...valid,
        'heartbeat-interval-ms': '-1',
      }),
    ).toThrow(/non-negative integer/);
    expect(() =>
      parseLocalOperationalSettings({
        ...valid,
        'warm-retention-sec': '60.5',
      }),
    ).toThrow(/non-negative integer/);
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
