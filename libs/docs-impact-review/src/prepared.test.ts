import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  parsePreparedReview,
  type PreparedReview,
  PreparedReviewError,
  runCheckPreparedCli,
} from './prepared.js';

const prepared: PreparedReview = {
  v: 1,
  eligible: true,
  pr: 7,
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  correlationId: '00000000-0000-4000-8000-000000000001',
  runAttempt: 1,
  profiles: {
    default: 'docs-review',
    coverage: 'coverage-model',
    docsCheck: 'docs-review',
  },
  workerProfiles: ['docs-review', 'coverage-model'],
};

const json = (value: unknown) => JSON.stringify(value);

describe('parsePreparedReview', () => {
  it('accepts what prepare writes', () => {
    // Act / Assert
    expect(parsePreparedReview(json(prepared))).toEqual(prepared);
  });

  it.each([
    ['nothing', '', "the prepare step's prepared output"],
    ['text that is not JSON', '{', 'not JSON'],
    ['another version', json({ ...prepared, v: 2 }), "version '2'"],
    [
      'invalid revisions and ids',
      json({ ...prepared, headSha: 'b'.repeat(7), correlationId: 'mine' }),
      'missing or invalid: /headSha /correlationId',
    ],
    [
      'a profile spanning lines',
      json({
        ...prepared,
        profiles: { ...prepared.profiles, default: 'a\nb' },
      }),
      '/profiles/default',
    ],
    [
      'no workers',
      json({ ...prepared, workerProfiles: [] }),
      '/workerProfiles',
    ],
    [
      'a stage profile without a worker',
      json({ ...prepared, workerProfiles: ['docs-review'] }),
      'no worker for profiles: coverage-model',
    ],
    ['an unknown field', json({ ...prepared, extra: true }), '(root)'],
  ])('rejects %s', (_label, raw, message) => {
    // Act / Assert
    expect(() => parsePreparedReview(raw)).toThrow(PreparedReviewError);
    expect(() => parsePreparedReview(raw)).toThrow(message);
  });
});

describe('runCheckPreparedCli', () => {
  let dir: string;
  let output: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'check-prepared-'));
    output = join(dir, 'output');
    writeFileSync(output, '');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const env = (extra: Record<string, string> = {}) => ({
    PREPARED: json(prepared),
    TEAM_ID: 'team',
    DIARY_ID: 'diary',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_OUTPUT: output,
    ...extra,
  });

  it('writes the outputs the later steps use', () => {
    // Act
    runCheckPreparedCli(env(), () => true);

    // Assert
    expect(readFileSync(output, 'utf8').split('\n')).toEqual([
      'pr-number=7',
      `base-sha=${'a'.repeat(40)}`,
      `head-sha=${'b'.repeat(40)}`,
      `correlation-id=${prepared.correlationId}`,
      'profile=docs-review',
      'coverage-profile=coverage-model',
      'docs-check-profile=docs-review',
      '',
    ]);
  });

  it.each([
    [
      'a pull request prepare skipped',
      { PREPARED: json({ ...prepared, eligible: false }) },
      'not eligible',
    ],
    [
      'a review re-run without prepare',
      { GITHUB_RUN_ATTEMPT: '2' },
      're-run all jobs, not only failed ones',
    ],
    [
      'missing team and diary',
      { TEAM_ID: '', DIARY_ID: ' ' },
      'missing inputs: TEAM_ID DIARY_ID',
    ],
    [
      'an App id without its key',
      { APP_ID: '1', APP_KEY: '' },
      'set app-id and app-private-key together',
    ],
    [
      'an App key without its id',
      { APP_ID: '', APP_KEY: 'k' },
      'set app-id and app-private-key together',
    ],
  ])('refuses %s', (_label, extra, message) => {
    // Act / Assert
    expect(() => runCheckPreparedCli(env(extra), () => true)).toThrow(message);
    expect(readFileSync(output, 'utf8')).toBe('');
  });

  it('requires a checkout of the repository', () => {
    // Act / Assert
    expect(() => runCheckPreparedCli(env(), () => false)).toThrow(
      'check out the repository',
    );
  });
});
