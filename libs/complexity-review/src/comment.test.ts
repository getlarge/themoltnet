import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  COMPLEXITY_REVIEW_COMMENT_MARKER,
  findComplexityReviewComment,
  renderComplexityReviewResult,
  updateComplexityReviewComment,
} from './comment.js';
import type { ComplexityReviewOutput } from './result.js';

const OLD_HEAD = 'a'.repeat(40);
const NEW_HEAD = 'b'.repeat(40);
const RUN_URL = 'https://github.com/getlarge/themoltnet/actions/runs/1';
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true });
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeGitHub(args: {
  currentHead: string;
  comments?: Array<{
    id: number;
    body: string;
    user: { login: string };
  }>;
}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/pulls/42')) {
      return response({ head: { sha: args.currentHead } });
    }
    if (url.includes('/issues/42/comments?')) {
      return response(args.comments ?? []);
    }
    return response({});
  };
  return { calls, fetchImpl };
}

const output: ComplexityReviewOutput = {
  scores: [
    {
      criterionId: 'cognitive-load',
      status: 'pass',
      rationale: 'The change is narrowly scoped.',
    },
  ],
  composite: 1,
  verdict: 'Low review burden.',
};

describe('complexity review comment lifecycle', () => {
  it('shows uncertainty separately when no criteria can be assessed', () => {
    const body = renderComplexityReviewResult({
      revision: OLD_HEAD,
      runUrl: RUN_URL,
      taskId: 'task',
      durationMs: 1000,
      domainCount: 1,
      output: {
        scores: [
          {
            criterionId: 'cognitive-load',
            status: 'unclear',
            rationale: 'Diff evidence is insufficient.',
          },
        ],
        verdict: 'Burden undetermined.',
      },
    });
    expect(body).toContain('Complexity: undetermined burden');
    expect(body).toContain('assessed criteria only):** N/A');
    expect(body).toContain('Assessed criteria: 0/1.');
    expect(body).toContain('cognitive-load: unclear');
  });

  it('discloses generated lockfile summary coverage in the published result', () => {
    const body = renderComplexityReviewResult({
      revision: OLD_HEAD,
      runUrl: RUN_URL,
      taskId: 'task',
      durationMs: 1000,
      domainCount: 1,
      output,
      summarizedPaths: ['examples/custom-pi-runtime/pnpm-lock.yaml'],
    });
    expect(body).toContain(
      'Generated lockfile contents summarized (change metadata only)',
    );
    expect(body).toContain('examples/custom-pi-runtime/pnpm-lock.yaml');
  });

  it('counts the generated files the review skipped', () => {
    const body = renderComplexityReviewResult({
      revision: OLD_HEAD,
      runUrl: RUN_URL,
      taskId: 'task',
      durationMs: 1000,
      domainCount: 1,
      output,
      generatedPaths: Array.from(
        { length: 7 },
        (_, index) => `packages/a-action/dist/chunk-${index}.js`,
      ),
    });
    expect(body).toContain(
      'Not reviewed, marked `linguist-generated` at the base revision (7 files)',
    );
    expect(body).toContain('"packages/a-action/dist/chunk-4.js" and 2 more.');
  });

  it('does not publish a task result when a push arrives during review', async () => {
    const github = fakeGitHub({
      currentHead: NEW_HEAD,
      comments: [
        {
          id: 7,
          body: `${COMPLEXITY_REVIEW_COMMENT_MARKER}\nold result`,
          user: { login: 'legreffier[bot]' },
        },
      ],
    });

    const status = await updateComplexityReviewComment({
      mode: 'publish',
      repo: 'getlarge/themoltnet',
      prNumber: 42,
      reviewedRevision: OLD_HEAD,
      runUrl: RUN_URL,
      token: 'test-token',
      author: 'legreffier[bot]',
      taskId: 'task-old',
      reviewSucceeded: true,
      resultPath: '/unused-because-the-result-is-stale',
      fetchImpl: github.fetchImpl,
    });

    expect(status).toBe('stale');
    const patch = github.calls.find((call) => call.init?.method === 'PATCH');
    const body = JSON.parse(String(patch?.init?.body)) as { body: string };
    expect(body.body).toContain(`result for Head: \`${OLD_HEAD}\``);
    expect(body.body).toContain(`now points at \`${NEW_HEAD}\``);
    expect(body.body).not.toContain('Low review burden.');
  });

  it('updates the existing sticky comment when a push arrives after publication', async () => {
    const github = fakeGitHub({
      currentHead: NEW_HEAD,
      comments: [
        {
          id: 7,
          body: renderComplexityReviewResult({
            revision: OLD_HEAD,
            runUrl: RUN_URL,
            taskId: 'task-old',
            durationMs: 55_000,
            domainCount: 2,
            output,
          }),
          user: { login: 'legreffier[bot]' },
        },
      ],
    });

    const status = await updateComplexityReviewComment({
      mode: 'start',
      repo: 'getlarge/themoltnet',
      prNumber: 42,
      reviewedRevision: NEW_HEAD,
      runUrl: RUN_URL,
      token: 'test-token',
      author: 'legreffier[bot]',
      fetchImpl: github.fetchImpl,
    });

    expect(status).toBe('progress');
    expect(
      github.calls.filter((call) => call.init?.method === 'PATCH'),
    ).toHaveLength(1);
    expect(
      github.calls.filter((call) => call.init?.method === 'POST'),
    ).toHaveLength(0);
    const patch = github.calls.find((call) => call.init?.method === 'PATCH');
    expect(String(patch?.init?.body)).toContain(NEW_HEAD);
    expect(String(patch?.init?.body)).toContain('Review in progress');
  });

  it('publishes the accepted structured result for the still-current head', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'complexity-review-'));
    tempDirs.push(dir);
    const resultPath = join(dir, 'result.json');
    writeFileSync(
      resultPath,
      JSON.stringify({
        output,
        durationMs: 55_000,
        taskIds: ['map', 'domain', 'synthesis'],
        summarizedPaths: ['examples/pnpm-lock.yaml'],
      }),
    );
    const github = fakeGitHub({ currentHead: NEW_HEAD });

    const status = await updateComplexityReviewComment({
      mode: 'publish',
      repo: 'getlarge/themoltnet',
      prNumber: 42,
      reviewedRevision: NEW_HEAD,
      runUrl: RUN_URL,
      token: 'test-token',
      author: 'legreffier[bot]',
      taskId: 'task-new',
      reviewSucceeded: true,
      resultPath,
      fetchImpl: github.fetchImpl,
    });

    expect(status).toBe('published');
    const post = github.calls.find((call) => call.init?.method === 'POST');
    const body = JSON.parse(String(post?.init?.body)) as { body: string };
    expect(body.body).toContain(COMPLEXITY_REVIEW_COMMENT_MARKER);
    expect(body.body).toContain(
      'Weighted composite (assessed criteria only):** 1.00',
    );
    expect(body.body).toContain(
      `Complexity: low burden · head ${NEW_HEAD.slice(0, 7)} · reviewed in 55s`,
    );
    expect(body.body).toContain(
      'Stages: change map → 1 focused review → synthesis.',
    );
    expect(body.body).toContain('measures review burden, not correctness');
    expect(body.body).toContain(
      'Generated lockfile contents summarized (change metadata only):',
    );
    expect(body.body).toContain('examples/pnpm-lock.yaml');
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({
      output,
      durationMs: 55_000,
    });
  });
});

describe('comment ownership', () => {
  it('selects only the LeGreffier App marker', () => {
    const comments = [
      {
        id: 1,
        body: COMPLEXITY_REVIEW_COMMENT_MARKER,
        user: { login: 'other-bot[bot]' },
      },
      {
        id: 2,
        body: COMPLEXITY_REVIEW_COMMENT_MARKER,
        user: { login: 'legreffier[bot]' },
      },
    ];
    expect(findComplexityReviewComment(comments, 'legreffier[bot]')?.id).toBe(
      2,
    );
  });
});
