import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { baselineDataset } from '../src/dataset.js';
import {
  publicWorkspace,
  RevisionConflict,
  WorkspaceStore,
} from '../src/review/workspace.js';
describe('private workspace revisions', () => {
  it('reopens drafts, rejects races and freezes only approved projections', async () => {
    const root = await mkdtemp(join(tmpdir(), 'review-store-')),
      store = new WorkspaceStore(root);
    let w = await store.initialize(baselineDataset(), {
      'key-exchange': 'private-source-id',
    });
    w = await store.mutate(w.revision, {
      type: 'draft',
      id: 'key-exchange',
      title: 'Draft title',
      content: 'Draft body',
    });
    expect(
      (await new WorkspaceStore(root).read()).drafts['key-exchange'].content,
    ).toBe('Draft body');
    await expect(
      store.mutate(0, {
        type: 'decision',
        id: 'weather',
        decision: 'approved',
      }),
    ).rejects.toBeInstanceOf(RevisionConflict);
    await expect(
      store.mutate(w.revision, {
        type: 'decision',
        id: 'key-exchange',
        decision: 'approved',
      }),
    ).rejects.toThrow('draft');
    w = await store.mutate(w.revision, {
      type: 'edit',
      id: 'key-exchange',
      title: 'Edited',
      content: 'Safe edited body',
    });
    expect(w.dataset.judgments.some((j) => j.entryId === 'key-exchange')).toBe(
      false,
    );
    expect(w.decisions['key-exchange']).toBe('pending');
    w = await store.mutate(w.revision, {
      type: 'decision',
      id: 'key-exchange',
      decision: 'approved',
    });
    const frozen = await store.freeze(w.revision);
    expect(frozen.dataset.entries.map((e) => e.id)).toEqual(['key-exchange']);
    expect(JSON.stringify(frozen.dataset)).not.toContain('private-source-id');
    expect(publicWorkspace(w)).not.toHaveProperty('sourceMap');
    expect((await stat(frozen.path)).mode & 0o777).toBe(0o600);
    const results = await Promise.allSettled([
      store.mutate(w.revision, {
        type: 'decision',
        id: 'weather',
        decision: 'approved',
      }),
      new WorkspaceStore(root).mutate(w.revision, {
        type: 'decision',
        id: 'pasta',
        decision: 'excluded',
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
  it('invalidates query judgments, enforces family splits and requires reasons', async () => {
    const store = new WorkspaceStore(
      await mkdtemp(join(tmpdir(), 'review-labels-')),
    );
    let w = await store.synthetic();
    const q = w.dataset.queries[0],
      e = w.dataset.entries[0];
    await expect(
      store.mutate(w.revision, {
        type: 'judgment',
        id: e.id,
        queryId: q.id,
        entryHash: e.contentHash,
        queryHash: q.textHash,
        grade: 1,
        reason: '',
      }),
    ).rejects.toThrow('judgment');
    w = await store.mutate(w.revision, {
      type: 'query',
      id: q.id,
      text: 'How does key exchange work?',
      family: q.family,
      split: q.split,
    });
    expect(w.dataset.judgments.some((j) => j.queryId === q.id)).toBe(false);
    await expect(
      store.mutate(w.revision, {
        type: 'query',
        text: 'A related query',
        family: q.family,
        split: 'test',
      }),
    ).rejects.toThrow('family');
  });
});

it('redacts detected secrets before saving a draft or imported copy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'review-redaction-'));
  const store = new WorkspaceStore(root);
  let w = await store.synthetic();
  // Construct a deliberately fake token for the scanner, never a live credential.
  const fake = ['ghp_', 'b'.repeat(36)].join('');
  w = await store.mutate(w.revision, {
    type: 'draft',
    id: 'key-exchange',
    title: 'Safe title',
    content: `token=${fake}`,
  });
  expect(w.drafts['key-exchange'].content).not.toContain(fake);
  expect(w.drafts['key-exchange'].content).toContain('[redacted]');
});
