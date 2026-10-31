import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { rescore } from '../src/metrics.js';
import { screenEntry } from '../src/review/screening.js';
import { WorkspaceStore } from '../src/review/workspace.js';
import { runEvaluation } from '../src/runner.js';
it('reviews, executes, annotates, freezes and reproduces a synthetic corpus', async () => {
  const root = await mkdtemp(join(tmpdir(), 'retrieval-workflow-'));
  const store = new WorkspaceStore(root);
  let w = await store.synthetic();
  for (const e of w.dataset.entries)
    w = await store.mutate(w.revision, {
      type: 'decision',
      id: e.id,
      decision: 'approved',
    });
  const first = await store.freeze(w.revision);
  const run = await runEvaluation(first.dataset, root, {
    topKs: [10],
    repeats: 1,
  });
  expect(run.rankings).toHaveLength(24);
  const query = w.dataset.queries[0],
    entry = w.dataset.entries[0];
  w = await store.mutate(w.revision, {
    type: 'judgment',
    id: entry.id,
    queryId: query.id,
    entryHash: entry.contentHash,
    queryHash: query.textHash,
    grade: 1,
    reason: 'Supporting context rather than a direct explanation',
  });
  const final = await store.freeze(w.revision);
  const report = rescore(run.dataset, final.dataset, run.rankings);
  const reproduced = await runEvaluation(final.dataset, root, {
    topKs: [10],
    repeats: 1,
  });
  expect(reproduced.rankings).toEqual(run.rankings);
  expect(rescore(final.dataset, final.dataset, reproduced.rankings)).toEqual(
    report,
  );
  expect((await new WorkspaceStore(root).read()).revision).toBe(w.revision);
});
it('screens a synthetic copy with the local Nimble model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'retrieval-screen-'));
  const store = new WorkspaceStore(root);
  const w = await store.synthetic();
  const result = await screenEntry(w.dataset.entries[0], root);
  expect(result.error).toBeUndefined();
  expect(result.modelDigest).not.toBe('unknown');
  expect(Object.keys(result.probabilities ?? {})).toEqual([
    'credentials',
    'personal',
    'publication',
  ]);
});
