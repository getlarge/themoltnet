import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { baselineDataset } from '../src/dataset.js';
import { prepareCorpus } from '../src/review/potato-corpus.js';
import { RevisionConflict, WorkspaceStore } from '../src/review/workspace.js';

async function fixture() {
  const store = new WorkspaceStore(
    await mkdtemp(join(tmpdir(), 'corpus-import-')),
  );
  const workspace = await store.initialize(baselineDataset(), {
    weather: 'private-original',
  });
  const manifest = prepareCorpus(
    workspace.dataset,
    workspace.dataset.entries
      .map((entry) => JSON.stringify({ ...entry, title: entry.title ?? '' }))
      .join('\n'),
  );
  return { store, workspace, manifest };
}
function row(id: string, decision?: string, extra = {}) {
  return {
    user_id: 'reviewer',
    instance_id: id,
    labels: {
      corpus_decision: decision ? { [decision]: decision } : {},
      ...extra,
    },
  };
}
const jsonl = (...rows: unknown[]) =>
  rows.map((row) => JSON.stringify(row)).join('\n');

describe('Potato corpus import', () => {
  it('previews then atomically imports human decisions, reopens and freezes only approvals', async () => {
    const { store, manifest } = await fixture();
    const annotations = jsonl(
      row('weather', 'Approve unchanged', {
        topics: { text_box: 'Weather forecasts' },
      }),
      row('pasta', 'Exclude'),
      row('key-exchange'),
    );
    const preview = await store.importCorpus(
      0,
      manifest,
      annotations,
      'reviewer',
    );
    expect(preview).toMatchObject({
      approved: 1,
      excluded: 1,
      unreviewed: 1,
      applied: false,
    });
    expect((await store.read()).revision).toBe(0);
    await store.importCorpus(0, manifest, annotations, 'reviewer', true);
    const saved = await new WorkspaceStore(store.root).read();
    expect(saved.corpusReviews?.weather).toMatchObject({
      reviewer: 'reviewer',
      topics: 'Weather forecasts',
    });
    expect(saved.decisions['key-exchange']).toBe('pending');
    expect((await store.freeze(1)).dataset.entries.map((e) => e.id)).toEqual([
      'weather',
    ]);
    expect(JSON.stringify((await store.freeze(1)).dataset)).not.toContain(
      'private-original',
    );
    expect(
      (await store.importCorpus(1, manifest, annotations, 'reviewer', true))
        .changed,
    ).toBe(false);
    await expect(
      store.importCorpus(0, manifest, annotations, 'reviewer', true),
    ).rejects.toBeInstanceOf(RevisionConflict);
  });

  it('retains edits as pending drafts without changing judged inputs', async () => {
    const { store, workspace, manifest } = await fixture();
    const item = manifest.items.find((e) => e.id === 'weather')!;
    const proposed_body = {
      text_edit: JSON.stringify({
        original_text: item.content,
        edited_text: 'Revised weather explanation',
      }),
    };
    await expect(
      store.importCorpus(
        0,
        manifest,
        jsonl(row(item.id, 'Approve unchanged', { proposed_body })),
        'reviewer',
        true,
      ),
    ).rejects.toThrow('Needs editing');
    await store.importCorpus(
      0,
      manifest,
      jsonl(
        row(item.id, 'Needs editing', {
          proposed_body,
          review_notes: { text_box: 'Clarify the forecast' },
        }),
      ),
      'reviewer',
      true,
    );
    const next = await store.read();
    expect(next.decisions[item.id]).toBe('pending');
    expect(next.drafts[item.id].content).toBe('Revised weather explanation');
    expect(next.dataset).toEqual(workspace.dataset);
    await expect(
      store.importCorpus(
        1,
        manifest,
        jsonl(row(item.id, 'Approve unchanged')),
        'reviewer',
        true,
      ),
    ).rejects.toThrow('draft');
  });

  it('rejects a bad batch without partial saves and rejects stale displayed content', async () => {
    const { store, manifest } = await fixture();
    for (const bad of [
      row('unknown', 'Exclude'),
      row('weather', 'Exclude'),
      { ...row('pasta', 'Exclude'), annotator_origin: { kind: 'model' } },
      { ...row('pasta', 'Exclude'), engine_request: {} },
    ]) {
      await expect(
        store.importCorpus(
          0,
          manifest,
          jsonl(row('weather', 'Approve unchanged'), bad),
          'reviewer',
          true,
        ),
      ).rejects.toThrow();
      expect((await store.read()).revision).toBe(0);
    }
    const stale = structuredClone(manifest);
    stale.items[0].content += ' changed';
    await expect(
      store.importCorpus(
        0,
        stale,
        jsonl(row('weather', 'Approve unchanged')),
        'reviewer',
        true,
      ),
    ).rejects.toThrow('stale');
  });

  it('blocks sensitive review text and conflicting drafts before persistence', async () => {
    const { store, manifest } = await fixture();
    const fake = ['ghp_', 'b'.repeat(36)].join('');
    await expect(
      store.importCorpus(
        0,
        manifest,
        jsonl(
          row('weather', 'Approve unchanged', {
            review_notes: { text_box: fake },
          }),
        ),
        'reviewer',
        true,
      ),
    ).rejects.toThrow('Secret scan');
    expect((await store.read()).revision).toBe(0);
    await store.mutate(0, {
      type: 'draft',
      id: 'weather',
      title: 'Draft',
      content: 'Existing draft',
    });
    await expect(
      store.importCorpus(
        1,
        manifest,
        jsonl(row('weather', 'Exclude')),
        'reviewer',
        true,
      ),
    ).rejects.toThrow('draft');
  });
});

it('accepts native human engine provenance but not machine origins or malformed requests', async () => {
  const { store, manifest } = await fixture();
  const engine_request = {
    corpus_decision: {
      purpose: 'organic',
      inclusion_prob: null,
      visibility: 'shown',
      split: 'none',
      request_id: 6,
    },
  };
  const human = { ...row('weather', 'Approve unchanged'), engine_request };
  await store.importCorpus(0, manifest, jsonl(human), 'reviewer', true);
  expect((await store.read()).corpusReviews?.weather.engineRequest).toEqual(
    engine_request.corpus_decision,
  );
  for (const invalid of [
    { ...human, annotator_origin: { kind: 'model' } },
    { ...human, label_origin: 'auto' },
    {
      ...human,
      engine_request: {
        corpus_decision: { ...engine_request.corpus_decision, purpose: 'auto' },
      },
    },
  ])
    await expect(
      store.importCorpus(1, manifest, jsonl(invalid), 'reviewer', true),
    ).rejects.toThrow();
});
