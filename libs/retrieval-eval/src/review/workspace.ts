import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  containsSecretInText,
  redactSecretsInText,
} from '@moltnet/secret-scanner';

import {
  baselineDataset,
  type Dataset,
  type Entry,
  entryHash,
  type Query,
  validateDataset,
} from '../dataset.js';
import { hash } from '../hash.js';
import { readJson, saveImmutableJson } from '../storage.js';
import { type CorpusManifest, importCorpus } from './potato-corpus.js';
import type { Decision, PublicWorkspace, Workspace } from './types.js';
export class RevisionConflict extends Error {
  constructor() {
    super('Workspace changed. Reload saved state before applying this edit.');
  }
}
export async function clean(text: string): Promise<string> {
  if (typeof text !== 'string' || text.length > 200000)
    throw new Error('Text is too large or invalid');
  return redactSecretsInText(text);
}
export function publicWorkspace(w: Workspace): PublicWorkspace {
  const { sourceMap: _, ...publicData } = w;
  return publicData;
}
export class WorkspaceStore {
  constructor(readonly root: string) {}
  async read(): Promise<Workspace> {
    let files: string[];
    try {
      files = await readdir(join(this.root, 'revisions'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        throw new Error('Initialize or import a workspace first');
      throw e;
    }
    const versions = files.filter((f) => /^\d{10}\.json$/.test(f)).sort();
    if (!versions.length)
      throw new Error('Initialize or import a workspace first');
    const w = await readJson<Workspace>(
      join(this.root, 'revisions', versions.at(-1) as string),
    );
    validateDataset(w.dataset);
    return w;
  }
  async persist(w: Workspace): Promise<Workspace> {
    validateDataset(w.dataset);
    // Reject any missed secret across queries, reasons, drafts and metadata.
    if (await containsSecretInText(JSON.stringify(publicWorkspace(w))))
      throw new Error('Secret scan blocked this save');
    try {
      await saveImmutableJson(
        join(
          this.root,
          'revisions',
          `${String(w.revision).padStart(10, '0')}.json`,
        ),
        w,
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST')
        throw new RevisionConflict();
      throw e;
    }
    return w;
  }
  async initialize(
    dataset: Dataset,
    sourceMap: Record<string, string> = {},
  ): Promise<Workspace> {
    const d = structuredClone(dataset);
    validateDataset(d);
    for (const e of d.entries) {
      e.content = await clean(e.content);
      e.title = await clean(e.title ?? '');
      e.tags = await Promise.all(e.tags.map(clean));
      e.contentHash = entryHash(e);
    }
    for (const q of d.queries) {
      q.text = await clean(q.text);
      q.family = await clean(q.family);
      q.textHash = hash(q.text);
    }
    d.judgments = d.judgments.filter(
      (j) =>
        d.entries.find((e) => e.id === j.entryId)?.contentHash ===
          j.entryHash &&
        d.queries.find((q) => q.id === j.queryId)?.textHash === j.queryHash,
    );
    for (const j of d.judgments) j.reason = await clean(j.reason);
    return this.persist({
      schemaVersion: 1,
      revision: 0,
      dataset: d,
      decisions: Object.fromEntries(d.entries.map((e) => [e.id, 'pending'])),
      drafts: {},
      judgmentDrafts: {},
      queryDraft: { text: '', family: '', split: 'development' },
      sourceMap,
    });
  }
  async synthetic(): Promise<Workspace> {
    const d = baselineDataset();
    d.version = `synthetic-${randomUUID()}`;
    d.timePolicy = 'relative-capture-v1';
    d.provenance = {
      description:
        'Synthetic starter derived from frozen fixture; not the unavailable 300-entry diary capture',
    };
    const support = d.judgments.find(
      (j) => j.queryId === 'ranking' && j.entryId === 'retrieval-tuning',
    );
    if (support) support.grade = 1;
    return this.initialize(d);
  }
  async mutate(
    revision: number,
    action: Record<string, unknown>,
  ): Promise<Workspace> {
    const w = await this.read();
    if (revision !== w.revision) throw new RevisionConflict();
    const text = async (key: string) => clean(action[key] as string);
    const entry = () => {
      const e = w.dataset.entries.find((e) => e.id === action.id);
      if (!e) throw new Error('Unknown entry');
      return e;
    };
    switch (action.type) {
      case 'draft': {
        const e = entry();
        w.drafts[e.id] = {
          title: await text('title'),
          content: await text('content'),
        };
        break;
      }
      case 'edit': {
        const e = entry();
        e.title = await text('title');
        e.content = await text('content');
        const previous = e.contentHash;
        e.contentHash = entryHash(e);
        if (previous !== e.contentHash) {
          w.decisions[e.id] = 'pending';
          w.dataset.judgments = w.dataset.judgments.filter(
            (j) => j.entryId !== e.id,
          );
          w.dataset.labelRevision++;
          w.dataset.version = randomUUID();
        }
        delete w.drafts[e.id];
        break;
      }
      case 'decision': {
        const e = entry();
        const decision = action.decision as Decision;
        if (!['pending', 'approved', 'excluded'].includes(decision))
          throw new Error('Invalid decision');
        if (w.drafts[e.id])
          throw new Error('Save or discard the draft before deciding');
        w.decisions[e.id] = decision;
        break;
      }
      case 'discardDraft': {
        delete w.drafts[entry().id];
        break;
      }
      case 'queryDraft': {
        const split = action.split as Query['split'];
        if (!['development', 'test'].includes(split))
          throw new Error('Invalid split');
        w.queryDraft = {
          id: typeof action.id === 'string' ? action.id : undefined,
          text: await text('text'),
          family: await text('family'),
          split,
        };
        break;
      }
      case 'query': {
        const id = typeof action.id === 'string' ? action.id : randomUUID(),
          previous = w.dataset.queries.find((q) => q.id === id);
        const q: Query = {
          id,
          text: await text('text'),
          textHash: '',
          family: await text('family'),
          split: action.split as Query['split'],
        };
        q.textHash = hash(q.text);
        if (previous && previous.textHash !== q.textHash)
          w.dataset.judgments = w.dataset.judgments.filter(
            (j) => j.queryId !== id,
          );
        w.dataset.queries = w.dataset.queries
          .filter((q) => q.id !== id)
          .concat(q);
        w.dataset.labelRevision++;
        w.dataset.version = randomUUID();
        w.queryDraft = { text: '', family: '', split: 'development' };
        break;
      }
      case 'judgmentDraft':
      case 'judgment': {
        const e = entry(),
          q = w.dataset.queries.find((q) => q.id === action.queryId);
        if (!q) throw new Error('Unknown query');
        if (
          action.entryHash !== e.contentHash ||
          action.queryHash !== q.textHash
        )
          throw new RevisionConflict();
        const key = JSON.stringify([q.id, e.id]);
        if (action.type === 'judgmentDraft') {
          if (
            action.grade !== null &&
            ![0, 1, 2].includes(action.grade as number)
          )
            throw new Error('Invalid grade');
          w.judgmentDrafts[key] = {
            grade: action.grade as 0 | 1 | 2 | null,
            reason: await text('reason'),
            entryHash: e.contentHash,
            queryHash: q.textHash,
          };
          break;
        }
        delete w.judgmentDrafts[key];
        w.dataset.judgments = w.dataset.judgments.filter(
          (j) => j.entryId !== e.id || j.queryId !== q.id,
        );
        if (action.grade !== null) {
          if (![0, 1, 2].includes(action.grade as number))
            throw new Error('Invalid grade');
          w.dataset.judgments.push({
            entryId: e.id,
            queryId: q.id,
            entryHash: e.contentHash,
            queryHash: q.textHash,
            grade: action.grade as 0 | 1 | 2,
            reason: await text('reason'),
          });
        }
        w.dataset.labelRevision++;
        break;
      }
      default:
        throw new Error('Unknown workspace action');
    }
    w.revision++;
    return this.persist(w);
  }
  async importCorpus(
    revision: number,
    manifest: CorpusManifest,
    annotations: string,
    reviewer: string,
    apply = false,
  ) {
    const current = await this.read();
    if (current.revision !== revision) throw new RevisionConflict();
    const result = importCorpus(current, manifest, annotations, reviewer);
    if (
      await containsSecretInText(
        JSON.stringify(publicWorkspace(result.workspace)),
      )
    )
      throw new Error('Secret scan blocked corpus import');
    if (apply && result.receipt.changed) await this.persist(result.workspace);
    return { ...result.receipt, applied: apply };
  }
  async freeze(revision: number): Promise<{ path: string; dataset: Dataset }> {
    const w = await this.read();
    if (w.revision !== revision) throw new RevisionConflict();
    const dataset = approvedDataset(w);
    if (!dataset.entries.length)
      throw new Error('Approve at least one entry before freezing');
    if (await containsSecretInText(JSON.stringify(dataset)))
      throw new Error('Secret scan blocked export');
    const path = join(this.root, 'datasets', `${hash(dataset)}.json`);
    try {
      await saveImmutableJson(path, dataset);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    return { path, dataset };
  }
}
export function approvedDataset(w: Workspace): Dataset {
  const d = structuredClone(w.dataset);
  d.entries = d.entries.filter((e) => w.decisions[e.id] === 'approved');
  const ids = new Set(d.entries.map((e) => e.id));
  d.judgments = d.judgments.filter((j) => ids.has(j.entryId));
  // Explicit public projection. No private mappings or screening sidecars.
  const entries = d.entries.map(
    (e): Entry => ({
      id: e.id,
      content: e.content,
      title: e.title,
      tags: e.tags,
      importance: e.importance,
      createdAt: e.createdAt,
      contentHash: e.contentHash,
    }),
  );
  return {
    schemaVersion: 1,
    version: d.version,
    labelRevision: d.labelRevision,
    capturedAt: d.capturedAt,
    timePolicy: d.timePolicy,
    entries,
    queries: d.queries.map((q) => ({
      id: q.id,
      text: q.text,
      textHash: q.textHash,
      family: q.family,
      split: q.split,
    })),
    judgments: d.judgments.map((j) => ({
      entryId: j.entryId,
      queryId: j.queryId,
      entryHash: j.entryHash,
      queryHash: j.queryHash,
      grade: j.grade,
      reason: j.reason,
    })),
    provenance: {
      description: d.provenance.description,
      sourceRevision: d.provenance.sourceRevision,
      sampling: d.provenance.sampling,
    },
  };
}
