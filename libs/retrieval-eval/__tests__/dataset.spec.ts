import { describe, expect, it } from 'vitest';

import { baselineDataset, trialDate, validateDataset } from '../src/dataset.js';
import {
  retrievalEntries,
  retrievalQueries,
  SOURCE_REVISION,
} from '../src/fixtures/baseline.js';
import { hash } from '../src/hash.js';
import { annotationQueue, rescore, score } from '../src/metrics.js';
const ranking = {
  repeat: 1,
  configuration: 'relevance',
  queryId: 'protocols',
  k: 3,
  retrievedIds: ['key-exchange', 'weather', 'ed25519'],
};
describe('frozen fixture', () => {
  it('validates frozen content, labels and provenance', () => {
    const d = baselineDataset();
    validateDataset(d);
    expect(d.entries).toHaveLength(12);
    expect(d.queries).toHaveLength(6);
    expect(d.judgments).toHaveLength(72);
    expect(SOURCE_REVISION).toBe('cf291d782d6e0f3da1e83274ce6306762b23e1af');
    expect(hash({ retrievalEntries, retrievalQueries })).toMatchInlineSnapshot(
      `"74a5ba948c6e5cabc89d3a6f9151321b0096ce2eadc1228514d33de1f74c588d"`,
    );
  });
  it('rejects duplicate IDs, stale hashes and family leakage', () => {
    const d = baselineDataset();
    d.entries.push(d.entries[0]);
    expect(() => validateDataset(d)).toThrow();
    const stale = baselineDataset();
    stale.entries[0].content = 'changed';
    expect(() => validateDataset(stale)).toThrow();
    const split = baselineDataset();
    split.queries.find((q) => q.id === 'algorithms')!.split = 'test';
    expect(() => validateDataset(split)).toThrow('family');
  });
  it('keeps relative ages and historical fixture policies distinct', () => {
    const d = baselineDataset(),
      e = d.entries.find((e) => e.id === 'fishing')!,
      clock = '2026-10-27T12:00:00Z';
    expect(trialDate(d, e, clock).toISOString()).toBe(
      '2024-01-01T00:00:00.000Z',
    );
    d.timePolicy = 'relative-capture-v1';
    expect(Date.parse(clock) - trialDate(d, e, clock).getTime()).toBe(
      Date.parse(d.capturedAt) - Date.parse(e.createdAt),
    );
  });
});
describe('graded metrics', () => {
  it('does not confuse unknown with irrelevant or supports with answers', () => {
    const d = baselineDataset();
    d.timePolicy = 'relative-capture-v1';
    d.judgments = d.judgments.filter(
      (j) => j.queryId !== 'protocols' || j.entryId !== 'weather',
    );
    expect(score(d, ranking)).toMatchObject({
      answerPrecision: null,
      usefulPrecision: null,
      recall: null,
      verifiedNoMatch: null,
      unreviewed: ['weather'],
    });
    const j = baselineDataset().judgments.find(
      (j) => j.queryId === 'protocols' && j.entryId === 'weather',
    )!;
    d.judgments.push({ ...j, grade: 1 });
    expect(score(d, ranking)).toMatchObject({
      answerPrecision: 1 / 3,
      usefulPrecision: 2 / 3,
      recall: 1,
      verifiedNoMatch: false,
    });
  });
  it('rescoring requires unchanged search inputs', () => {
    const original = baselineDataset(),
      updated = baselineDataset();
    updated.labelRevision++;
    updated.judgments[0].grade = 0;
    expect(
      rescore(original, updated, [ranking])[0].metrics.answerPrecision,
    ).toBe(0);
    updated.queries[0].text = 'new';
    expect(() => rescore(original, updated, [ranking])).toThrow();
  });
  it('builds the deduplicated union while preserving rank order', () => {
    expect(
      annotationQueue(
        [
          ranking,
          {
            ...ranking,
            configuration: 'combined',
            retrievedIds: ['weather', 'fishing'],
          },
        ],
        'protocols',
      ),
    ).toEqual(['key-exchange', 'weather', 'ed25519', 'fishing']);
  });
});
