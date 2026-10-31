import type { Dataset, Entry, Query } from '../dataset.js';
import type { CorpusReview } from './potato-corpus.js';
export type Decision = 'pending' | 'approved' | 'excluded';
export interface Draft {
  title: string;
  content: string;
}
export interface Workspace {
  schemaVersion: 1;
  revision: number;
  dataset: Dataset;
  decisions: Record<string, Decision>;
  drafts: Record<string, Draft>;
  queryDraft: {
    id?: string;
    text: string;
    family: string;
    split: Query['split'];
  };
  judgmentDrafts: Record<
    string,
    {
      grade: 0 | 1 | 2 | null;
      reason: string;
      entryHash: string;
      queryHash: string;
    }
  >;
  corpusReviews?: Record<string, CorpusReview>;
  sourceMap: Record<string, string>;
}
export interface Screening {
  id: string;
  implementationHash: string;
  dependencyHash: string;
  entryId: string;
  entryHash: string;
  model: string;
  modelDigest: string;
  rubricVersion: string;
  input: string;
  questions: Record<
    string,
    {
      type: 'noul';
      instructions: string;
      criteria: { true: string; false: string };
    }
  >;
  startedAt: string;
  finishedAt?: string;
  probabilities?: Record<string, number>;
  error?: string;
}
export type PublicWorkspace = Omit<Workspace, 'sourceMap'>;
export type ReviewEntry = Entry;
