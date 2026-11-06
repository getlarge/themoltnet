import { describe, expect, it } from 'vitest';

import { baselineDataset } from '../src/dataset.js';
import { type Ranking, rescore } from '../src/metrics.js';
import { importPotato, preparePotato } from '../src/potato.js';

function fixture() {
  const dataset = baselineDataset();
  dataset.timePolicy = 'relative-capture-v1';
  dataset.judgments = [];
  const ranking: Ranking = {
    repeat: 0,
    configuration: 'synthetic',
    queryId: dataset.queries[0].id,
    k: 3,
    retrievedIds: dataset.entries.slice(0, 3).map((e) => e.id),
  };
  const manifest = preparePotato(dataset, [
    ranking,
    { ...ranking, configuration: 'other' },
  ]);
  const rows = ['Answers', 'Supports', 'Not relevant'].map((label, index) => ({
    instance_id: manifest.items[index].id,
    user_id: 'reviewer',
    labels: {
      relevance: { [label]: label },
      reason: { text_box: `Evidence ${index}` },
    },
  }));
  return { dataset, ranking, manifest, rows };
}
const jsonl = (rows: unknown[]) =>
  rows.map((row) => JSON.stringify(row)).join('\n');

describe('Potato human judgment interchange', () => {
  it('deduplicates candidates and rescores exact grades without search', () => {
    const { dataset, ranking, manifest, rows } = fixture();
    expect(manifest.items).toHaveLength(3);
    expect(preparePotato(dataset, [], true).items).toHaveLength(
      dataset.entries.length * dataset.queries.length,
    );
    const result = importPotato(dataset, manifest, jsonl(rows), 'reviewer');
    expect(result.dataset.judgments.map((j) => j.grade)).toEqual([2, 1, 0]);
    expect(result.dataset.judgments[1].reason).toBe('Evidence 1');
    expect(result.dataset.labelRevision).toBe(dataset.labelRevision + 1);
    expect(dataset.judgments).toEqual([]);
    expect(
      rescore(dataset, result.dataset, [ranking])[0].metrics,
    ).toMatchObject({
      answerPrecision: 1 / 3,
      usefulPrecision: 2 / 3,
      recall: null,
      verifiedNoMatch: null,
    });
  });
  it('keeps unknown distinct from irrelevant and ignores other reviewers', () => {
    const { dataset, ranking, manifest, rows } = fixture();
    const result = importPotato(
      dataset,
      manifest,
      jsonl([
        rows[2],
        { ...rows[0], user_id: 'model' },
        { ...rows[1], labels: {} },
      ]),
      'reviewer',
    );
    expect(result.dataset.judgments.map((j) => j.grade)).toEqual([0]);
    expect(
      rescore(dataset, result.dataset, [ranking])[0].metrics,
    ).toMatchObject({
      complete: false,
      answerPrecision: null,
      usefulPrecision: null,
    });
  });
  it('rejects stale snapshot and mapping hashes', () => {
    const { dataset, manifest, rows } = fixture();
    expect(() =>
      importPotato(
        { ...dataset, labelRevision: 99 },
        manifest,
        jsonl(rows),
        'reviewer',
      ),
    ).toThrow(/snapshot/);
    manifest.items[0].entryHash = 'stale';
    expect(() =>
      importPotato(dataset, manifest, jsonl(rows), 'reviewer'),
    ).toThrow(/stale/);
  });
  it('rejects duplicates, unknown items, missing reasons and ambiguous labels', () => {
    const { dataset, manifest, rows } = fixture();
    for (const invalid of [
      [rows[0], rows[0]],
      [{ ...rows[0], engine_request: {} }],
      [{ ...rows[0], annotator_origin: { kind: 'llm' } }],
      [{ ...rows[0], instance_id: 'unknown' }],
      [{ ...rows[0], labels: { relevance: { Answers: 'Answers' } } }],
      [
        {
          ...rows[0],
          labels: { relevance: { Answers: 'Answers', Supports: 'Supports' } },
        },
      ],
      [{ ...rows[0], labels: { relevance: { Answers: false } } }],
    ])
      expect(() =>
        importPotato(dataset, manifest, jsonl(invalid), 'reviewer'),
      ).toThrow();
    expect(() =>
      importPotato(dataset, manifest, jsonl(rows), 'absent'),
    ).toThrow(/no exported rows/);
  });
  it('replaces only reviewed pairs and does not bump revisions on a no-op', () => {
    const { dataset, manifest, rows } = fixture();
    const first = importPotato(
      dataset,
      manifest,
      jsonl(rows),
      'reviewer',
    ).dataset;
    const nextManifest = {
      ...manifest,
      datasetHash: preparePotato(first, []).datasetHash,
    };
    expect(
      importPotato(first, nextManifest, jsonl(rows), 'reviewer').receipt
        .changed,
    ).toBe(false);
    const changed = importPotato(
      first,
      nextManifest,
      jsonl([
        {
          ...rows[0],
          labels: {
            relevance: { Supports: 'Supports' },
            reason: { text_box: 'Only background' },
          },
        },
      ]),
      'reviewer',
    ).dataset;
    expect(changed.judgments.map((j) => j.grade)).toEqual([1, 1, 0]);
    expect(first.judgments[0].grade).toBe(2);
  });
});

it('retains human verification provenance in the relevance import receipt', () => {
  const { dataset, manifest, rows } = fixture();
  const request = {
    purpose: 'verify',
    inclusion_prob: null,
    visibility: 'shown',
    split: 'none',
    request_id: 1,
  };
  const result = importPotato(
    dataset,
    manifest,
    jsonl([{ ...rows[0], engine_request: { relevance: request } }]),
    'reviewer',
  );
  expect(result.dataset.judgments[0].grade).toBe(2);
  expect(result.receipt.engineRequests[rows[0].instance_id]).toEqual(request);
});
