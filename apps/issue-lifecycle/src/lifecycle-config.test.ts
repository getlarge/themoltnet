import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const EXAMPLE_CONFIG_PATH = join(import.meta.dirname, '..', 'profiles.example.json');

import {
  EMPTY_LIFECYCLE_CONFIG,
  loadLifecycleConfig,
  parseLifecycleConfig,
  stepConfig,
} from './lifecycle-config.js';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

const tmpDirs: string[] = [];
function writeConfigFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'lifecycle-config-'));
  tmpDirs.push(dir);
  const path = join(dir, 'profiles.json');
  writeFileSync(path, contents);
  return path;
}

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

describe('parseLifecycleConfig', () => {
  it('accepts a valid per-step config', () => {
    const config = parseLifecycleConfig({
      triage: { profileId: VALID_UUID, maxAttempts: 2 },
      implement: { profileId: VALID_UUID, maxAttempts: 1 },
      prReviewSecurity: { profileId: VALID_UUID },
    });

    expect(config.triage?.profileId).toBe(VALID_UUID);
    expect(config.triage?.maxAttempts).toBe(2);
    expect(config.prReviewSecurity?.profileId).toBe(VALID_UUID);
  });

  it('accepts an empty config', () => {
    expect(parseLifecycleConfig({})).toEqual({});
  });

  it('allows $schema and $comment metadata keys', () => {
    expect(() =>
      parseLifecycleConfig({
        $schema: './schema.json',
        $comment: 'documentation',
        triage: { maxAttempts: 1 },
      }),
    ).not.toThrow();
  });

  it('rejects an unknown step key', () => {
    expect(() => parseLifecycleConfig({ bogusStep: {} })).toThrow(
      /Invalid issue-lifecycle profiles config/,
    );
  });

  it('rejects a malformed profileId', () => {
    expect(() =>
      parseLifecycleConfig({ triage: { profileId: 'not-a-uuid' } }),
    ).toThrow(/Invalid issue-lifecycle profiles config/);
  });

  it('rejects maxAttempts below 1', () => {
    expect(() =>
      parseLifecycleConfig({ triage: { maxAttempts: 0 } }),
    ).toThrow(/Invalid issue-lifecycle profiles config/);
  });

  it('rejects maxAttempts above the ceiling', () => {
    expect(() =>
      parseLifecycleConfig({ triage: { maxAttempts: 99 } }),
    ).toThrow(/Invalid issue-lifecycle profiles config/);
  });

  it('rejects unknown properties within a step', () => {
    expect(() =>
      parseLifecycleConfig({ triage: { model: 'gpt-4' } }),
    ).toThrow(/Invalid issue-lifecycle profiles config/);
  });
});

describe('loadLifecycleConfig', () => {
  it('returns the empty config when no path is given', () => {
    expect(loadLifecycleConfig(undefined)).toBe(EMPTY_LIFECYCLE_CONFIG);
  });

  it('loads and validates a JSON file', () => {
    const path = writeConfigFile(
      JSON.stringify({ plan: { profileId: VALID_UUID, maxAttempts: 3 } }),
    );

    const config = loadLifecycleConfig(path);

    expect(config.plan?.profileId).toBe(VALID_UUID);
    expect(config.plan?.maxAttempts).toBe(3);
  });

  it('throws a clear error for a missing file', () => {
    expect(() => loadLifecycleConfig('/nonexistent/profiles.json')).toThrow(
      /Could not read issue-lifecycle profiles config/,
    );
  });

  it('throws a clear error for malformed JSON', () => {
    const path = writeConfigFile('{ not json');
    expect(() => loadLifecycleConfig(path)).toThrow(/is not valid JSON/);
  });

  it('throws a schema error for an invalid file', () => {
    const path = writeConfigFile(JSON.stringify({ triage: { maxAttempts: 0 } }));
    expect(() => loadLifecycleConfig(path)).toThrow(
      /Invalid issue-lifecycle profiles config/,
    );
  });

  it('accepts the shipped profiles.example.json', () => {
    // Guards against the documented example drifting from the schema.
    expect(() => loadLifecycleConfig(EXAMPLE_CONFIG_PATH)).not.toThrow();
  });
});

describe('stepConfig', () => {
  it('returns the step entry when present', () => {
    const config = parseLifecycleConfig({ triage: { maxAttempts: 2 } });
    expect(stepConfig(config, 'triage')).toEqual({ maxAttempts: 2 });
  });

  it('returns an empty object for an unset step', () => {
    expect(stepConfig({}, 'notify')).toEqual({});
  });
});
