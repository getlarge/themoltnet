import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type PiAgentDirSource = 'env' | 'repo';

export interface ResolvedPiAgentDir {
  path: string;
  source: PiAgentDirSource;
}

export function ensurePiAgentDir(
  repoRoot: string,
  explicitPath: string,
): ResolvedPiAgentDir {
  if (explicitPath) {
    mkdirSync(explicitPath, { recursive: true });
    return { path: explicitPath, source: 'env' };
  }

  const path = join(repoRoot, '.pi');
  mkdirSync(path, { recursive: true });
  return { path, source: 'repo' };
}
