import { describe, expect, it, vi } from 'vitest';

import { type CliParseDeps, parseCliConfig } from './config.js';

const BASE_ARGS = [
  '--team',
  'team-id',
  '--diary',
  'diary-id',
  '--target',
  'change',
];

function deps(overrides: Partial<CliParseDeps> = {}): CliParseDeps {
  return {
    env: { MULTI_LENS_REVIEW_DATABASE_URL: 'postgres://review' },
    readFile: vi.fn(() => 'file diff'),
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

  it('parses a diff file and repeated lenses without process side effects', () => {
    const parseDeps = deps();
    const result = parseCliConfig(
      [
        ...BASE_ARGS,
        '--diff-file',
        'review.diff',
        '--lens',
        'security',
        '--lens',
        'correctness',
      ],
      parseDeps,
    );

    expect(result).toMatchObject({
      kind: 'run',
      config: {
        databaseUrl: 'postgres://review',
        input: {
          correlationId: 'generated-correlation',
          diff: 'file diff',
          lenses: ['security', 'correctness'],
        },
      },
    });
  });

  it('preserves an explicit correlation id instead of generating one', () => {
    const parseDeps = deps();
    const result = parseCliConfig(
      [...BASE_ARGS, '--correlation-id', 'stable-run-id'],
      parseDeps,
    );

    expect(result).toMatchObject({
      kind: 'run',
      config: { input: { correlationId: 'stable-run-id' } },
    });
  });

  it('requires the database URL environment variable', () => {
    expect(() => parseCliConfig(BASE_ARGS, deps({ env: {} }))).toThrow(
      /MULTI_LENS_REVIEW_DATABASE_URL/,
    );
  });

  it('parses default, per-lens, and synthesis profile references', () => {
    const result = parseCliConfig(
      [
        ...BASE_ARGS,
        '--profile',
        'multi-lens-review-v1',
        '--lens-profile',
        'security=security-profile',
        '--lens-profile',
        'performance=performance-profile',
        '--synthesis-profile',
        'synthesis-profile',
      ],
      deps(),
    );

    expect(result).toMatchObject({
      kind: 'run',
      config: {
        profileRoutingRefs: {
          defaultProfile: 'multi-lens-review-v1',
          lensProfiles: {
            security: 'security-profile',
            performance: 'performance-profile',
          },
          synthesisProfile: 'synthesis-profile',
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

  it('rejects duplicate lens profile overrides', () => {
    expect(() =>
      parseCliConfig(
        [
          ...BASE_ARGS,
          '--profile',
          'default',
          '--lens-profile',
          'security=one',
          '--lens-profile',
          'security=two',
        ],
        deps(),
      ),
    ).toThrow(/repeated for lens "security"/);
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
      parseCliConfig(
        [...BASE_ARGS, '--diff', 'inline', '--diff-file', 'review.diff'],
        deps(),
      ),
    ).toThrow(/at most one/);
  });
});
