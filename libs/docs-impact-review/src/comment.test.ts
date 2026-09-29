import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { updateDocsImpactComment } from './comment.js';
import { DOCS_IMPACT_COMMENT_MARKER } from './report.js';
import type { DocsImpactReport } from './types.js';

const HEAD = 'b'.repeat(40);
const NEWER = 'c'.repeat(40);
const RUN = 'https://github.com/o/r/actions/runs/1';

interface Call {
  method: string;
  path: string;
  body?: { body: string };
}

/** Minimal GitHub API double recording writes. */
function github(opts: {
  /** One value, or the sequence returned by successive head reads. */
  head: string | string[];
  comments?: Array<{ id: number; body: string; login: string }>;
}) {
  const calls: Call[] = [];
  let headReads = 0;
  const fetchImpl = ((url: string, init?: RequestInit) => {
    const path = new URL(url).pathname + new URL(url).search;
    const method = init?.method ?? 'GET';
    const body = init?.body
      ? (JSON.parse(String(init.body)) as { body: string })
      : undefined;
    calls.push({ method, path, body });
    let payload: unknown = {};
    if (method === 'GET' && path.endsWith('/pulls/7')) {
      const heads = Array.isArray(opts.head) ? opts.head : [opts.head];
      payload = { head: { sha: heads[Math.min(headReads, heads.length - 1)] } };
      headReads += 1;
    } else if (method === 'GET' && path.includes('/comments')) {
      payload = (opts.comments ?? []).map((c) => ({
        id: c.id,
        body: c.body,
        user: { login: c.login },
      }));
    }
    return Promise.resolve(
      new Response(JSON.stringify(payload), { status: 200 }),
    );
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function writes(calls: Call[]) {
  return calls.filter((call) => call.method !== 'GET');
}

describe('updateDocsImpactComment', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'docs-comment-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function reportFile(report: Partial<DocsImpactReport>): string {
    const path = join(dir, 'summary.json');
    writeFileSync(
      path,
      JSON.stringify({
        reports: [
          {
            repo: 'o/r',
            headRevision: HEAD,
            status: 'completed',
            outcome: 'covered',
            findings: [],
            gaps: [],
            selectedDocs: [],
            timings: { ingestMs: 1, retrievalMs: 1, stages: {}, totalMs: 1 },
            ...report,
          },
        ],
      }),
    );
    return path;
  }

  const base = {
    repo: 'o/r',
    prNumber: 7,
    reviewedRevision: HEAD,
    runUrl: RUN,
    token: 't',
    author: 'legreffier[bot]',
  };

  it('includes the GitHub error message when a request is refused', async () => {
    // Arrange
    const fetchImpl = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ message: 'Resource not accessible by integration' }),
          { status: 403 },
        ),
      )) as typeof fetch;

    // Act / Assert
    await expect(
      updateDocsImpactComment({ ...base, mode: 'start', fetchImpl }),
    ).rejects.toThrow(
      'GitHub API GET /repos/o/r/pulls/7 failed with 403: Resource not accessible by integration',
    );
  });

  it('posts a progress comment when the review starts', async () => {
    // Arrange
    const api = github({ head: HEAD });

    // Act
    const status = await updateDocsImpactComment({
      ...base,
      mode: 'start',
      fetchImpl: api.fetchImpl,
    });

    // Assert
    expect(status).toBe('progress');
    const [write] = writes(api.calls);
    expect(write.method).toBe('POST');
    expect(write.body?.body).toContain('Docs impact: reviewing');
  });

  it('names the correlation id under a published result', async () => {
    // Arrange
    const api = github({ head: HEAD });

    // Act
    await updateDocsImpactComment({
      ...base,
      mode: 'publish',
      reportPath: reportFile({}),
      correlationId: '00000000-0000-4000-8000-000000000009',
      fetchImpl: api.fetchImpl,
    });

    // Assert
    const [write] = writes(api.calls);
    expect(write.body?.body).toContain(
      `[workflow run](${RUN}) · correlation \`00000000-0000-4000-8000-000000000009\``,
    );
  });

  it('updates its own marker comment, not one by another account', async () => {
    // Arrange
    const api = github({
      head: HEAD,
      comments: [
        {
          id: 1,
          body: `${DOCS_IMPACT_COMMENT_MARKER} by a human`,
          login: 'someone',
        },
        {
          id: 3,
          body: `${DOCS_IMPACT_COMMENT_MARKER} from the workflow token`,
          login: 'github-actions[bot]',
        },
        {
          id: 2,
          body: `${DOCS_IMPACT_COMMENT_MARKER} old`,
          login: 'legreffier[bot]',
        },
      ],
    });

    // Act
    const status = await updateDocsImpactComment({
      ...base,
      mode: 'publish',
      reportPath: reportFile({}),
      fetchImpl: api.fetchImpl,
    });

    // Assert
    expect(status).toBe('published');
    const [write] = writes(api.calls);
    expect(write.method).toBe('PATCH');
    expect(write.path).toBe('/repos/o/r/issues/comments/2');
    expect(write.body?.body).toContain('Docs impact: covered');
  });

  it('never publishes a result for a head the PR has moved past', async () => {
    // Arrange
    const api = github({ head: NEWER });

    // Act
    const status = await updateDocsImpactComment({
      ...base,
      mode: 'publish',
      reportPath: reportFile({ outcome: 'updates-needed' }),
      fetchImpl: api.fetchImpl,
    });

    // Assert
    expect(status).toBe('stale');
    const [write] = writes(api.calls);
    expect(write.body?.body).toContain('Docs impact: stale');
    expect(write.body?.body).not.toContain('updates-needed');
  });

  it('replaces a result published while the head moved', async () => {
    // Arrange: the head changes between the check and the write.
    const api = github({ head: [HEAD, NEWER] });

    // Act
    const status = await updateDocsImpactComment({
      ...base,
      mode: 'publish',
      reportPath: reportFile({ outcome: 'updates-needed' }),
      fetchImpl: api.fetchImpl,
    });

    // Assert
    expect(status).toBe('stale');
    const last = writes(api.calls).at(-1);
    expect(last?.body?.body).toContain('Docs impact: stale');
  });

  it('reports not reviewed when the run produced no usable report', async () => {
    // Arrange
    const api = github({ head: HEAD });

    // Act
    const status = await updateDocsImpactComment({
      ...base,
      mode: 'publish',
      reportPath: join(dir, 'missing.json'),
      fetchImpl: api.fetchImpl,
    });

    // Assert
    expect(status).toBe('missing');
    expect(writes(api.calls)[0].body?.body).toContain(
      'Docs impact: not reviewed',
    );
  });

  it('treats a report for another head as missing', async () => {
    // Arrange
    const api = github({ head: HEAD });

    // Act
    const status = await updateDocsImpactComment({
      ...base,
      mode: 'publish',
      reportPath: reportFile({ headRevision: NEWER }),
      fetchImpl: api.fetchImpl,
    });

    // Assert
    expect(status).toBe('missing');
  });
});
