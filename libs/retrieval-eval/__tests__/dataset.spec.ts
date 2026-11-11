import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  baselineDataset,
  type Dataset,
  trialDate,
  validateDataset,
} from '../src/dataset.js';
import {
  retrievalEntries,
  retrievalQueries,
  SOURCE_REVISION,
} from '../src/fixtures/baseline.js';
import { hash } from '../src/hash.js';
import { annotationQueue, rescore, score } from '../src/metrics.js';
import { prepareQueryExperiment } from '../src/query-drafts.js';
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
  it('scores historical binary relevance from every positive grade', () => {
    const d = baselineDataset();
    d.judgments.find(
      (j) => j.queryId === 'protocols' && j.entryId === 'weather',
    )!.grade = 1;
    expect(score(d, ranking).binary).toMatchObject({
      precisionAtK: 2 / 3,
      recallAtK: 1,
      falsePositives: 1,
      missedRelevantIds: [],
      unexpectedIds: ['ed25519'],
    });
    d.timePolicy = 'relative-capture-v1';
    expect(score(d, ranking).binary).toBeNull();
  });
  it('withholds historical binary metrics until corpus labels are complete', () => {
    const d = baselineDataset();
    d.judgments = d.judgments.filter(
      (j) => j.queryId !== 'protocols' || j.entryId !== 'key-exchange',
    );
    expect(
      score(d, { ...ranking, k: 1, retrievedIds: ['key-exchange'] }),
    ).toMatchObject({
      binary: null,
      unreviewed: ['key-exchange'],
      answerPrecision: null,
      recall: null,
      verifiedNoMatch: null,
    });
    expect(
      score(d, { ...ranking, k: 1, retrievedIds: ['weather'] }),
    ).toMatchObject({
      binary: null,
      complete: true,
      corpusComplete: false,
    });
  });
  it('verifies no-match only with complete all-zero corpus judgments', () => {
    const d = baselineDataset();
    const noMatch = { ...ranking, queryId: 'no-match' };
    expect(score(d, noMatch)).toMatchObject({
      verifiedNoMatch: true,
      binary: { falsePositives: 3, recallAtK: null },
    });
    d.judgments = d.judgments.filter(
      (j) => j.queryId !== 'no-match' || j.entryId !== 'fishing',
    );
    expect(score(d, noMatch).verifiedNoMatch).toBeNull();
  });

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
    updated.capturedAt = '2026-10-20T00:00:00.000Z';
    validateDataset(updated);
    expect(() => rescore(original, updated, [ranking])).toThrow(
      'Rankings are incompatible with changed inputs',
    );
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

describe('public approved diary corpus', () => {
  const dataset = JSON.parse(
    readFileSync(
      new URL('../datasets/approved-diary-v1/dataset.json', import.meta.url),
      'utf8',
    ),
  ) as Dataset;

  it('preserves the approved snapshot and selected query families', () => {
    validateDataset(dataset);
    expect(dataset.entries).toHaveLength(276);
    expect(dataset.queries.map((query) => query.id)).toEqual([
      'corpus-v1-q01',
      'corpus-v1-q02',
      'corpus-v1-q03',
      'corpus-v1-q04',
      'corpus-v1-q06',
      'corpus-v1-q07',
      'corpus-v1-q10',
    ]);
    expect(
      dataset.queries.every((query) => query.split === 'development'),
    ).toBe(true);
    expect(dataset.timePolicy).toBe('relative-capture-v1');
    expect(hash(dataset)).toBe(
      '8ad499a86dc54e42b8a7f9d313609ede778c441a79d005ed1565751b232e7ac1',
    );
  });

  it('keeps pending judgments unknown instead of creating negative labels', () => {
    expect(dataset.judgments).toEqual([]);
    const retrievedIds = dataset.entries.slice(0, 10).map((entry) => entry.id);
    expect(
      score(dataset, {
        queryId: 'corpus-v1-q01',
        configuration: 'relevance',
        repeat: 1,
        k: 10,
        retrievedIds,
      }),
    ).toMatchObject({
      answerPrecision: null,
      usefulPrecision: null,
      recall: null,
      verifiedNoMatch: null,
      unreviewed: retrievedIds,
    });
  });
});

describe('editable query experiments', () => {
  const draft = {
    id: 'my-query',
    text: 'How do signatures work?',
    family: 'signatures',
    split: 'development',
    informationNeed: 'Understand signature verification.',
  };
  it('hashes revised queries and starts unlabelled without mutating the source', () => {
    const source = baselineDataset();
    const before = hash(source);
    const result = prepareQueryExperiment(source, [draft], 'custom-v1');
    expect(result.dataset.entries).toEqual(source.entries);
    expect(result.dataset.queries).toEqual([
      {
        id: draft.id,
        text: draft.text,
        textHash: hash(draft.text),
        family: draft.family,
        split: draft.split,
      },
    ]);
    expect(result.dataset.judgments).toEqual([]);
    expect(result.proposals.datasetHash).toBe(hash(result.dataset));
    expect(result.proposals.queries[0].informationNeed).toBe(
      draft.informationNeed,
    );
    expect(hash(source)).toBe(before);
    const revised = prepareQueryExperiment(
      result.dataset,
      [{ ...draft, text: 'Revised query' }],
      'custom-v2',
    );
    expect(revised.dataset.queries[0].textHash).not.toBe(
      result.dataset.queries[0].textHash,
    );
  });
  it('rejects empty needs, duplicate IDs and query-family leakage', () => {
    const source = baselineDataset();
    for (const input of [
      [],
      [draft, draft],
      [{ ...draft, informationNeed: '' }],
      [draft, { ...draft, id: 'other', split: 'test' }],
    ]) {
      expect(() =>
        prepareQueryExperiment(source, input, 'custom-v1'),
      ).toThrow();
    }
    expect(() =>
      prepareQueryExperiment(source, [draft], source.version),
    ).toThrow();
  });
});
