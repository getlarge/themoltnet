import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { canonicalStoreRoot } from '@themoltnet/sdk/node';

export interface DaemonStateDirs {
  rootDir: string;
  mountPath?: string;
  piSessionsDir: string;
}

export function ensureDaemonStateDirs(mountPath: string): DaemonStateDirs {
  const rootDir = canonicalStoreRoot(join(mountPath, '.moltnet', 'd'));
  const piSessionsDir = join(rootDir, 'pi-sessions');
  mkdirSync(rootDir, { recursive: true, mode: 0o700 });
  mkdirSync(piSessionsDir, { recursive: true, mode: 0o700 });
  return {
    rootDir: realpathSync(rootDir),
    piSessionsDir: realpathSync(piSessionsDir),
  };
}
