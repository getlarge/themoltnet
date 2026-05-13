import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface DaemonStateDirs {
  rootDir: string;
  piSessionsDir: string;
}

export function ensureDaemonStateDirs(mountPath: string): DaemonStateDirs {
  const rootDir = join(mountPath, '.moltnet', 'd');
  const piSessionsDir = join(rootDir, 'pi-sessions');
  mkdirSync(piSessionsDir, { recursive: true });
  return { rootDir, piSessionsDir };
}
