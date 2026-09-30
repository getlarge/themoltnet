import { describe, expect, it } from 'vitest';

import { parsePreparedReview, prepareReview } from './prepare.js';

const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
const repo = 'getlarge/themoltnet';

function api(files: Array<{ filename: string; previous_filename?: string }>) {
  const requests: string[] = [];
  const fetchImpl = (async (url: string) => {
    requests.push(url);
    if (url.includes('/contents/'))
      return new Response(
        JSON.stringify({
          content: Buffer.from(
            JSON.stringify({ rubric: 'rubrics/custom.json' }),
          ).toString('base64'),
        }),
        { status: 200 },
      );
    if (url.includes('/files?'))
      return new Response(JSON.stringify(files), { status: 200 });
    return new Response(
      JSON.stringify({
        number: 42,
        user: { login: 'contributor' },
        changed_files: files.length,
        base: { sha: base },
        head: { sha: head, repo: { full_name: repo } },
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  return { requests, fetchImpl };
}

describe('prepareReview', () => {
  it('reads configuration from the PR base and pins a valid review', async () => {
    const { requests, fetchImpl } = api([
      { filename: 'libs/tasks/src/index.ts' },
    ]);
    const result = await prepareReview({
      repo,
      pr: 42,
      token: 'test',
      runId: '123',
      runAttempt: 1,
      profile: 'complexity-v2',
      protectedPaths: ['packages/complexity-review-action/'],
      fetchImpl,
    });
    expect(result.eligible).toBe(true);
    expect(result.rubric).toBe('rubrics/custom.json');
    expect(result.correlationId).toMatch(/^[0-9a-f]{8}-/);
    expect(requests).toContain(
      `https://api.github.com/repos/${repo}/contents/.github/complexity-review.json?ref=${base}`,
    );
    expect(parsePreparedReview(JSON.stringify(result), '1')).toEqual(result);
    expect(() => parsePreparedReview(JSON.stringify(result), '2')).toThrow(
      're-run all jobs',
    );
  });

  it('rejects a renamed protected runtime file', async () => {
    const { fetchImpl } = api([
      {
        filename: 'README.md',
        previous_filename: 'packages/complexity-review-action/action.yml',
      },
    ]);
    const result = await prepareReview({
      repo,
      pr: 42,
      token: 'test',
      runId: '123',
      runAttempt: 1,
      profile: 'complexity-v2',
      protectedPaths: ['packages/complexity-review-action/'],
      fetchImpl,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain(
      'packages/complexity-review-action/action.yml',
    );
  });
});
