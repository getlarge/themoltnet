import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface EvalEnv {
  apiUrl: string;
  diaryId: string;
  fingerprint: string;
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
