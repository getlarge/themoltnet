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
  head: string;
  comments?: Array<{ id: number; body: string; type: string }>;
}) {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    const path = new URL(url).pathname + new URL(url).search;
    const method = init?.method ?? 'GET';
    const body = init?.body
      ? (JSON.parse(String(init.body)) as { body: string })
      : undefined;
    calls.push({ method, path, body });
    let payload: unknown = {};
    if (method === 'GET' && path.endsWith('/pulls/7')) {
      payload = { head: { sha: opts.head } };
    } else if (method === 'GET' && path.includes('/comments')) {
      payload = (opts.comments ?? []).map((c) => ({
        id: c.id,
        body: c.body,
        user: { type: c.type },
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
            headRevision: HEAD,
            status: 'completed',
            outcome: 'covered',
            findings: [],
            gaps: [],
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
  };

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

  it('updates the existing bot comment instead of posting another', async () => {
    // Arrange
    const api = github({
      head: HEAD,
      comments: [
        {
          id: 1,
          body: `${DOCS_IMPACT_COMMENT_MARKER} by a human`,
          type: 'User',
        },
        { id: 2, body: `${DOCS_IMPACT_COMMENT_MARKER} old`, type: 'Bot' },
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
