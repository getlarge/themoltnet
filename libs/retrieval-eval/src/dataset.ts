import { historicalDates } from './config.js';
import {
  retrievalEntries,
  retrievalQueries,
  SOURCE_REVISION,
} from './fixtures/baseline.js';
import { hash } from './hash.js';
export interface Entry {
  id: string;
  content: string;
  title?: string;
  tags: string[];
  importance: number;
  createdAt: string;
  contentHash: string;
}
export interface Query {
  id: string;
  text: string;
  textHash: string;
  family: string;
  split: 'development' | 'test';
}
export interface Judgment {
  entryId: string;
  queryId: string;
  entryHash: string;
  queryHash: string;
  grade: 0 | 1 | 2;
  reason: string;
}
export interface Dataset {
  schemaVersion: 1;
  version: string;
  labelRevision: number;
  capturedAt: string;
  timePolicy: 'historical-fixture-v1' | 'relative-capture-v1';
  provenance: {
    description: string;
    sourceRevision?: string;
    sampling?: {
      strategy: string;
      populationSize?: number;
      sampleSize: number;
      captureVersion: string;
      seed?: string;
    };
  };
  entries: Entry[];
  queries: Query[];
  judgments: Judgment[];
}
export function entryHash(
  e: Pick<Entry, 'content' | 'title' | 'tags' | 'importance' | 'createdAt'>,
): string {
  return hash([e.content, e.title ?? '', e.tags, e.importance, e.createdAt]);
}
export function validateDataset(d: Dataset): void {
  if (
    d.schemaVersion !== 1 ||
    !['historical-fixture-v1', 'relative-capture-v1'].includes(d.timePolicy) ||
    !Number.isFinite(Date.parse(d.capturedAt))
  )
    throw new Error('Invalid dataset protocol');
  for (const items of [d.entries, d.queries]) {
    if (
      new Set(items.map((x) => x.id)).size !== items.length ||
      items.some(
        (x) =>
          !x.id.trim() ||
          ['__proto__', 'constructor', 'prototype'].includes(x.id),
      )
    )
      throw new Error('Duplicate or empty IDs');
  }
  const families = new Map<string, string>();
  for (const e of d.entries)
    if (
      e.contentHash !== entryHash(e) ||
      !Number.isFinite(Date.parse(e.createdAt)) ||
      !Number.isInteger(e.importance) ||
      e.importance < 1 ||
      e.importance > 10
    )
      throw new Error('Invalid entry hash or metadata');
  for (const q of d.queries) {
    if (
      !q.text.trim() ||
      q.textHash !== hash(q.text) ||
      !['development', 'test'].includes(q.split)
    )
      throw new Error('Invalid query');
    if (families.has(q.family) && families.get(q.family) !== q.split)
      throw new Error('Query family crosses splits');
    families.set(q.family, q.split);
  }
  const pairs = new Set<string>();
  const entriesById = new Map(d.entries.map((e) => [e.id, e]));
  const queriesById = new Map(d.queries.map((q) => [q.id, q]));
  for (const j of d.judgments) {
    const e = entriesById.get(j.entryId),
      q = queriesById.get(j.queryId),
      key = JSON.stringify([j.queryId, j.entryId]);
    if (
      !e ||
      !q ||
      e.contentHash !== j.entryHash ||
      q.textHash !== j.queryHash ||
      ![0, 1, 2].includes(j.grade) ||
      !j.reason.trim() ||
      pairs.has(key)
    )
      throw new Error('Invalid or stale judgment');
    pairs.add(key);
  }
}
export function baselineDataset(): Dataset {
  const capturedAt = '2026-10-19T00:00:00.000Z';
  const entries = retrievalEntries.map((e) => {
    const value = {
      id: e.id,
      content: e.content,
      title: e.title,
      tags: [...(e.tags ?? [])],
      importance: e.importance ?? 5,
      createdAt: historicalDates[e.id] ?? capturedAt,
    };
    return { ...value, contentHash: entryHash(value) };
  });
  const queries = retrievalQueries.map((q) => ({
    id: q.id,
    text: q.query,
    textHash: hash(q.query),
    family: ['protocols', 'signatures', 'algorithms'].includes(q.id)
      ? 'cryptography'
      : q.id,
    split: 'development' as const,
  }));
  return {
    schemaVersion: 1,
    version: 'fixture-552-v1',
    labelRevision: 1,
    capturedAt,
    timePolicy: 'historical-fixture-v1',
    provenance: {
      description:
        'Frozen 12-entry, six-query binary development fixture from PR #2821',
      sourceRevision: SOURCE_REVISION,
    },
    entries,
    queries,
    judgments: queries.flatMap((q, index) =>
      entries.map((e) => ({
        entryId: e.id,
        queryId: q.id,
        entryHash: e.contentHash,
        queryHash: q.textHash,
        grade: retrievalQueries[index].relevantIds.includes(e.id)
          ? (2 as const)
          : (0 as const),
        reason: retrievalQueries[index].rationale,
      })),
    ),
  };
}
export function trialDate(d: Dataset, e: Entry, clock: string): Date {
  return d.timePolicy === 'historical-fixture-v1'
    ? new Date(historicalDates[e.id] ?? clock)
    : new Date(
        Date.parse(clock) -
          (Date.parse(d.capturedAt) - Date.parse(e.createdAt)),
      );
}
