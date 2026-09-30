import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHubApi } from './github-api.js';
import {
  correlationIdFor,
  PREPARED_VERSION,
  preparePullRequestReview,
  pullNumberFromEvent,
  runPrepareCli,
} from './prepare.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface FakePullRequest {
  author?: string;
  headRepo?: string | null;
  changedFiles?: number;
}

/** GitHub double: the pull request, and its files served 100 per page. */
function github(
  files: Array<{ filename: string; previous_filename?: string }>,
  pr: FakePullRequest = {},
) {
  return ((url: string) => {
    const parsed = new URL(url);
    let body: unknown;
    if (parsed.pathname.endsWith('/files')) {
      const page = Number(parsed.searchParams.get('page') ?? '1');
      body = files.slice((page - 1) * 100, page * 100);
    } else {
      body = {
        number: 7,
        user: { login: pr.author ?? 'someone' },
        changed_files: pr.changedFiles ?? files.length,
        base: { sha: 'a'.repeat(40) },
        head: {
          sha: 'b'.repeat(40),
          repo:
            pr.headRepo === null ? null : { full_name: pr.headRepo ?? 'o/r' },
        },
      };
    }
    return Promise.resolve(new Response(JSON.stringify(body)));
  }) as typeof fetch;
}

function api(fetchImpl: typeof fetch): GitHubApi {
  return new GitHubApi({ token: 't', fetchImpl });
}

const options = {
  repo: 'o/r',
  pullNumber: 7,
  runId: '100',
  runAttempt: '1',
  profile: 'docs-review',
  protectedPaths: ['.github/workflows/docs.yml'],
};

describe('correlationIdFor', () => {
  it('derives the same UUID from the same seed and a new one per attempt', () => {
    // Act
    const first = correlationIdFor('o/r:7:head:100:1');
    const again = correlationIdFor('o/r:7:head:100:1');
    const rerun = correlationIdFor('o/r:7:head:100:2');

    // Assert
    expect(first).toMatch(UUID);
    expect(again).toBe(first);
    expect(rerun).not.toBe(first);
  });
});

describe('preparePullRequestReview', () => {
  it('pins revisions, derives the correlation id, and dedupes worker profiles', async () => {
    // Act
    const result = await preparePullRequestReview({
      ...options,
      api: api(github([{ filename: 'src/a.ts' }])),
      coverageProfile: 'coverage-model',
    });

    // Assert
    expect(result).toEqual({
      skip: false,
      reason: '',
      prepared: {
        v: PREPARED_VERSION,
        eligible: true,
        pr: 7,
        baseSha: 'a'.repeat(40),
        headSha: 'b'.repeat(40),
        correlationId: correlationIdFor(`o/r:7:${'b'.repeat(40)}:100:1`),
        runAttempt: 1,
        profiles: {
          default: 'docs-review',
          coverage: 'coverage-model',
          docsCheck: 'docs-review',
        },
        workerProfiles: ['docs-review', 'coverage-model'],
      },
    });
  });

  it.each([
    ['a fork', { headRepo: 'someone/r' }, [], 'fork'],
    ['a deleted fork', { headRepo: null }, [], 'fork'],
    ['Dependabot', { author: 'dependabot[bot]' }, [], 'Dependabot'],
    [
      'a rename away from a protected file',
      {},
      [
        {
          filename: 'tools/x.yml',
          previous_filename: '.github/workflows/docs.yml',
        },
      ],
      '.github/workflows/docs.yml',
    ],
    [
      'a protected file on the second page',
      {},
      [
        ...Array.from({ length: 100 }, (_, index) => ({
          filename: `src/${index}.ts`,
        })),
        { filename: '.github/workflows/docs.yml' },
      ],
      '.github/workflows/docs.yml',
    ],
    [
      'a file list GitHub truncated',
      { changedFiles: 3_001 },
      [{ filename: 'src/a.ts' }],
      'listed 1 of 3001 changed files',
    ],
  ])('skips %s', async (_label, pr, files, reason) => {
    // Act
    const result = await preparePullRequestReview({
      ...options,
      api: api(github(files, pr)),
    });

    // Assert
    expect(result.skip).toBe(true);
    expect(result.prepared.eligible).toBe(false);
    expect(result.reason).toContain(reason);
  });

  it('passes a renamed file through under its new name', async () => {
    // Act
    const result = await preparePullRequestReview({
      ...options,
      protectedPaths: ['tools/'],
      api: api(
        github([{ filename: 'tools/x.yml', previous_filename: 'old/x.yml' }]),
      ),
    });

    // Assert
    expect(result.reason).toContain('tools/x.yml');
  });

  it.each(['./.github/workflows/docs.yml', '/.github/workflows/docs.yml'])(
    'matches the protected prefix %s from the repository root',
    async (prefix) => {
      // Act
      const result = await preparePullRequestReview({
        ...options,
        protectedPaths: [prefix],
        api: api(github([{ filename: '.github/workflows/docs.yml' }])),
      });

      // Assert
      expect(result.skip).toBe(true);
    },
  );
});

describe('pullNumberFromEvent', () => {
  it.each([
    ['pull_request', { pull_request: { number: 7 } }, 7],
    ['issue_comment', { issue: { number: 8, pull_request: {} } }, 8],
  ])('reads the pull request of a %s event', (name, event, expected) => {
    // Act / Assert
    expect(pullNumberFromEvent(name, event)).toBe(expected);
  });

  it('rejects a comment on an issue that is not a pull request', () => {
    // Act / Assert
    expect(() =>
      pullNumberFromEvent('issue_comment', { issue: { number: 8 } }),
    ).toThrow('issue_comment');
  });
});

describe('runPrepareCli', () => {
  let dir: string;
  let stdout: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'prepare-'));
    stdout = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  function env(extra: Record<string, string> = {}) {
    const eventPath = join(dir, 'event.json');
    writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 7 } }));
    const output = join(dir, 'output');
    writeFileSync(output, '');
    return {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_OUTPUT: output,
      GITHUB_TOKEN: 't',
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_RUN_ID: '100',
      GITHUB_RUN_ATTEMPT: '1',
      PROFILE: 'docs-review',
      PROTECTED_PATHS: '.github/workflows/docs.yml\n',
      ...extra,
    };
  }

  it('writes skip, reason, the correlation id, and the prepared payload', async () => {
    // Arrange
    const vars = env();

    // Act
    await runPrepareCli(vars, github([{ filename: 'src/a.ts' }]));

    // Assert
    const lines = readFileSync(vars.GITHUB_OUTPUT, 'utf8').split('\n');
    expect(lines).toContain('skip=false');
    expect(lines).toContain('reason=');
    expect(lines.find((line) => line.startsWith('correlation-id='))).toMatch(
      /^correlation-id=[0-9a-f-]{36}$/,
    );
    const prepared = JSON.parse(
      (lines.find((line) => line.startsWith('prepared=')) ?? '').slice(
        'prepared='.length,
      ),
    ) as { v: number; headSha: string };
    expect(prepared).toMatchObject({ v: 1, headSha: 'b'.repeat(40) });
    expect(stdout.join('')).not.toContain('::warning::');
  });

  it('warns when no protected paths are set', async () => {
    // Act
    await runPrepareCli(env({ PROTECTED_PATHS: '' }), github([]));

    // Assert
    expect(stdout.join('')).toContain('::warning::no protected-paths');
  });

  it('requires a profile', async () => {
    // Act / Assert
    await expect(
      runPrepareCli(env({ PROFILE: '' }), github([])),
    ).rejects.toThrow('PROFILE is required');
  });
});
