import { describe, expect, it, vi } from 'vitest';

import {
  createPinnedReviewDiffReader,
  PINNED_REVIEW_DIFF_KIND,
  pinnedReviewDiffTool,
} from '../src/pinned-review-diff.js';

const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
const patch = [
  'diff --git a/a.ts b/a.ts',
  '--- a/a.ts',
  '+++ b/a.ts',
  '@@ -10,2 +20,2 @@',
  ' keep',
  '-old',
  '+new',
  '@@ -100,0 +120,1 @@',
  '+tail',
].join('\n');

function fixture(files = [{ path: 'a.ts', patch }]) {
  const result = createPinnedReviewDiffReader({
    version: 1,
    base,
    head,
    files,
  });
  const tool = result.tool;
  if (!tool?.execute) throw new Error('Missing diff reader');
  return {
    ...result,
    read: (
      args: { path?: string; offset?: number; limit?: number },
      signal?: AbortSignal,
    ) => tool.execute!('test', args, signal),
  };
}

describe('pinned-diff-reader', () => {
  it('loads only the bound input artifact on the active task and caches validated bytes', async () => {
    const bytes = Buffer.from(
      JSON.stringify({
        version: 1,
        base,
        head,
        files: [{ path: 'a.ts', patch }],
      }),
    );
    const download = vi.fn().mockResolvedValue({
      stream: (async function* () {
        yield bytes;
      })(),
    });
    const task = {
      id: 'active-task',
      teamId: 'team',
      tags: [`revision:${head}`],
      input: { execution: { revision: head } },
      references: [
        {
          taskId: null,
          role: 'reviewed_diff',
          artifact: { cid: 'bound-cid', kind: PINNED_REVIEW_DIFF_KIND },
        },
      ],
    };
    const tool = await pinnedReviewDiffTool.create({
      agent: { tasks: { artifacts: { download } } },
      claimedTask: { task },
    } as never);
    await tool.execute('list', {}, undefined, undefined, {} as never);
    const result = await tool.execute(
      'page',
      { path: 'a.ts' },
      undefined,
      undefined,
      {} as never,
    );
    expect(download).toHaveBeenCalledExactlyOnceWith(
      { taskId: 'active-task', cid: 'bound-cid' },
      { teamId: 'team' },
    );
    expect(JSON.stringify(result.content)).toContain('[new:21] +new');
    await expect(
      tool.execute(
        'foreign',
        { taskId: 'another-task' },
        undefined,
        undefined,
        {} as never,
      ),
    ).rejects.toThrow('arguments');
    await expect(
      tool.execute(
        'foreign',
        { path: '../../.env' },
        undefined,
        undefined,
        {} as never,
      ),
    ).rejects.toThrow('Unknown');
  });

  it('rejects absent/ambiguous or mismatched artifacts and supports pinned correction tags', async () => {
    const make = async (
      references: unknown[],
      artifactHead = head,
      input: unknown = { execution: { revision: head } },
    ) => {
      const bytes = Buffer.from(
        JSON.stringify({
          version: 1,
          base,
          head: artifactHead,
          files: [{ path: 'a.ts', patch }],
        }),
      );
      const download = vi.fn().mockResolvedValue({
        stream: (async function* () {
          yield bytes;
        })(),
      });
      return pinnedReviewDiffTool.create({
        agent: { tasks: { artifacts: { download } } },
        claimedTask: {
          task: {
            id: 'active',
            teamId: 'team',
            input,
            tags: [`revision:${head}`],
            references,
          },
        },
      } as never);
    };
    const ref = {
      taskId: null,
      role: 'reviewed_diff',
      artifact: { cid: 'bound-cid', kind: PINNED_REVIEW_DIFF_KIND },
    };
    for (const refs of [[], [ref, ref], [{ ...ref, taskId: 'foreign-task' }]])
      await expect(
        (await make(refs)).execute(
          'read',
          {},
          undefined,
          undefined,
          {} as never,
        ),
      ).rejects.toThrow('exactly one');
    await expect(
      (await make([ref], 'c'.repeat(40))).execute(
        'read',
        {},
        undefined,
        undefined,
        {} as never,
      ),
    ).rejects.toThrow('head differs');
    const correction = await make([ref], head, {
      continueFrom: { taskId: 'parent', attemptN: 1 },
    });
    await expect(
      correction.execute('read', {}, undefined, undefined, {} as never),
    ).resolves.toBeDefined();
  });
  it('lists only bound files and returns verified old/new coordinates on paginated reads', async () => {
    const reader = fixture();
    const listing = await reader.read({});
    expect(listing.details).toMatchObject({
      kind: 'pinned-review-diff',
      action: 'list',
      base,
      head,
      digest: reader.digest,
    });
    const page = await reader.read({ path: 'a.ts', offset: 5, limit: 2 });
    expect(page.details).toMatchObject({
      action: 'read',
      path: 'a.ts',
      linesReturned: 2,
      nextOffset: 7,
    });
    expect(JSON.stringify(page.content)).toContain('[old:10 new:20]  keep');
    expect(JSON.stringify(page.content)).toContain('[old:11] -old');
    const next = await reader.read({ path: 'a.ts', offset: 7 });
    expect(JSON.stringify(next.content)).toContain('[new:21] +new');
    expect(JSON.stringify(next.content)).toContain('[new:120] +tail');
  });

  it('cannot select arbitrary files, revisions or commands and copies artifact bytes immutably', async () => {
    const files = [{ path: 'a.ts', patch: patch + '\n+$(touch marker)' }];
    const reader = fixture(files);
    files[0].patch = 'changed after construction';
    await expect(reader.read({ path: '../../.env' })).rejects.toThrow(
      'Unknown',
    );
    const result = await reader.read({ path: 'a.ts' });
    expect(JSON.stringify(result.content)).toContain('$(touch marker)');
    expect(JSON.stringify(result.content)).not.toContain(
      'changed after construction',
    );
    expect(() =>
      createPinnedReviewDiffReader({ version: 1, base: 'main', head, files }),
    ).toThrow('commit IDs');
    expect(() => fixture([files[0], files[0]])).toThrow('unique');
  });

  it('bounds large pages, reports a truncated line and honors cancellation', async () => {
    const reader = fixture([
      { path: 'large.ts', patch: '@@ -0,0 +1 @@\n+' + 'x'.repeat(40_000) },
    ]);
    const result = await reader.read({ path: 'large.ts', offset: 2 });
    expect(result.details).toMatchObject({
      truncatedLine: true,
      linesReturned: 1,
    });
    expect(JSON.stringify(result.content).length).toBeLessThan(26_000);
    const controller = new AbortController();
    controller.abort();
    await expect(reader.read({}, controller.signal)).rejects.toThrow();
    await expect(reader.read({ offset: 0 })).rejects.toThrow('page');
  });
});
