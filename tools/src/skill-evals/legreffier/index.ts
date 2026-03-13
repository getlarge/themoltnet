import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { CommitScorer } from './commit-scorer.js';

export { CommitScorer } from './commit-scorer.js';
export { loadSkillSections, splitSkillContent } from './skill-sections.js';
export type { CommitExpected, CommitScoreResult } from './types.js';

export interface EvalEnv {
  apiUrl: string;
  diaryId: string;
  mcpUrl: string;
  clientId: string;
  clientSecret: string;
  configDir: string;
  agentName: string;
}

export async function loadEvalEnv(repoRoot: string): Promise<EvalEnv> {
  const raw = await readFile(resolve(repoRoot, '.eval-env.json'), 'utf8');
  return JSON.parse(raw) as EvalEnv;
}

export function createScorer(
  apiUrl: string,
  diaryId: string,
  clientId: string,
  clientSecret: string,
): CommitScorer {
  return new CommitScorer(apiUrl, diaryId, clientId, clientSecret);
}
