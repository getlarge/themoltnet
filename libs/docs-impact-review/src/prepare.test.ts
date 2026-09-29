import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHubApi } from './github-api.js';
import {
  correlationIdFor,
  preparePullRequestReview,
  pullNumberFromEvent,
  runPrepareCli,
} from './prepare.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function github(
  files: Array<{ filename: string; previous_filename?: string }>,
) {
  return ((url: string) => {
    const path = new URL(url).pathname;
    const body = path.endsWith('/files')
      ? files
      : {
          number: 7,
          user: { login: 'someone' },
          base: { sha: 'a'.repeat(40) },
          head: { sha: 'b'.repeat(40), repo: { full_name: 'o/r' } },
        };
    return Promise.resolve(new Response(JSON.stringify(body)));
  }) as typeof fetch;
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
    const prepared = await preparePullRequestReview({
      ...options,
      api: new GitHubApi({
        token: 't',
        fetchImpl: github([{ filename: 'src/a.ts' }]),
      }),
      coverageProfile: 'coverage-model',
    });

    // Assert
    expect(prepared).toMatchObject({
      skip: 'false',
      reason: '',
      'pr-number': '7',
      'base-sha': 'a'.repeat(40),
      'head-sha': 'b'.repeat(40),
      profile: 'docs-review',
      'coverage-profile': 'coverage-model',
      'docs-check-profile': 'docs-review',
      'worker-profiles': '["docs-review","coverage-model"]',
    });
    expect(prepared['correlation-id']).toBe(
      correlationIdFor(`o/r:7:${'b'.repeat(40)}:100:1`),
    );
  });

  it('skips a pull request that renames a protected file away', async () => {
    // Act
    const prepared = await preparePullRequestReview({
      ...options,
      api: new GitHubApi({
        token: 't',
        fetchImpl: github([
          {
            filename: 'tools/x.yml',
            previous_filename: '.github/workflows/docs.yml',
          },
        ]),
      }),
    });

    // Assert
    expect(prepared.skip).toBe('true');
    expect(prepared.reason).toContain('.github/workflows/docs.yml');
  });
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

  it('writes every output line', async () => {
    // Arrange
    const vars = env();

    // Act
    await runPrepareCli(vars, github([{ filename: 'src/a.ts' }]));

    // Assert
    const lines = readFileSync(vars.GITHUB_OUTPUT, 'utf8');
    expect(lines).toContain('skip=false\n');
    expect(lines).toContain(`head-sha=${'b'.repeat(40)}\n`);
    expect(lines).toMatch(/correlation-id=[0-9a-f-]{36}\n/);
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
