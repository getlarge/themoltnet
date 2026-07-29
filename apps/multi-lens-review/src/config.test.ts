import { describe, expect, it, vi } from 'vitest';

import { type CliParseDeps, parseCliConfig } from './config.js';

const BASE_ARGS = [
  '--team',
  'team-id',
  '--diary',
  'diary-id',
  '--target',
  'change',
  '--diff',
  'diff',
];

function deps(overrides: Partial<CliParseDeps> = {}): CliParseDeps {
  return {
    env: { MULTI_LENS_REVIEW_DATABASE_URL: 'postgres://review' },
    readFile: vi.fn((path) => (path === 'files.json' ? '[]' : 'file diff')),
    randomUUID: vi.fn(() => 'generated-correlation'),
    ...overrides,
  };
}

describe('parseCliConfig', () => {
  it('returns help without requiring environment or arguments', () => {
    expect(parseCliConfig(['--help'], deps({ env: {} }))).toEqual({
      kind: 'help',
    });
  });

  it('parses read-only preflight without database or identity inputs', () => {
    expect(
      parseCliConfig(
        [
          '--preflight',
          '--diff-file',
          'review.diff',
          '--files-metadata',
          'files.json',
        ],
        deps({ env: {} }),
      ),
    ).toEqual({
      kind: 'preflight',
      config: { diff: 'file diff', githubFiles: [] },
    });
  });

  it('parses a diff file and repeated requested lanes', () => {
    const result = parseCliConfig(
      [
        ...BASE_ARGS.slice(0, -2),
        '--diff-file',
        'review.diff',
        '--lens',
        'security',
        '--lens',
        'correctness',
      ],
      deps(),
    );
    expect(result).toMatchObject({
      kind: 'run',
      config: {
        databaseUrl: 'postgres://review',
        diff: 'file diff',
        input: {
          correlationId: 'generated-correlation',
          lenses: ['security', 'correctness'],
        },
      },
    });
  });

  it('preserves an explicit correlation id', () => {
    expect(
      parseCliConfig(
        [...BASE_ARGS, '--correlation-id', 'stable-run-id'],
        deps(),
      ),
    ).toMatchObject({
      kind: 'run',
      config: { input: { correlationId: 'stable-run-id' } },
    });
  });

  it('requires the database URL for a run', () => {
    expect(() => parseCliConfig(BASE_ARGS, deps({ env: {} }))).toThrow(
      /MULTI_LENS_REVIEW_DATABASE_URL/,
    );
  });

  it('preserves legacy flags and adds every explicit phase override', () => {
    const result = parseCliConfig(
      [
        ...BASE_ARGS,
        '--profile',
        'default',
        '--planner-profile',
        'planner',
        '--preflight-profile',
        'architect',
        '--lens-profile',
        'security=security',
        '--lane-profile',
        'tests=tests',
        '--topic-reducer-profile',
        'reducer',
        '--synthesis-profile',
        'lead',
      ],
      deps(),
    );
    expect(result).toMatchObject({
      kind: 'run',
      config: {
        profileRoutingRefs: {
          defaultProfile: 'default',
          plannerProfile: 'planner',
          preflightProfile: 'architect',
          laneProfiles: { security: 'security', tests: 'tests' },
          topicReducerProfile: 'reducer',
          globalSynthesisProfile: 'lead',
        },
      },
    });
  });

  it('requires a default profile when an override is supplied', () => {
    expect(() =>
      parseCliConfig(
        [...BASE_ARGS, '--lens-profile', 'security=security-profile'],
        deps(),
      ),
    ).toThrow(/--profile is required/);
  });

  it('rejects duplicate profile overrides', () => {
    expect(() =>
      parseCliConfig(
        [
          ...BASE_ARGS,
          '--profile',
          'default',
          '--lens-profile',
          'security=one',
          '--lane-profile',
          'security=two',
        ],
        deps(),
      ),
    ).toThrow(/repeated for lane "security"/);
  });

  it.each([
    ['--poll-interval', '0'],
    ['--concurrency', '1.5'],
  ])('rejects invalid numeric value for %s', (flag, value) => {
    expect(() => parseCliConfig([...BASE_ARGS, flag, value], deps())).toThrow(
      /positive integer/,
    );
  });

  it('rejects simultaneous inline and file diffs', () => {
    expect(() =>
      parseCliConfig([...BASE_ARGS, '--diff-file', 'review.diff'], deps()),
    ).toThrow(/at most one/);
  });
});
