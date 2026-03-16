import { CommitScorer } from './commit-scorer.js';

export { CommitScorer } from './commit-scorer.js';
export type { CommitExpected, CommitScoreResult } from './types.js';

export function createScorer(
  apiUrl: string,
  diaryId: string,
  clientId: string,
  clientSecret: string,
): CommitScorer {
  return new CommitScorer(apiUrl, diaryId, clientId, clientSecret);
}
