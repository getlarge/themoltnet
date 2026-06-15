import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensurePiAgentDir } from './pi-agent-dir.js';

describe('ensurePiAgentDir', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'agent-daemon-pi-dir-'));
    tempRoots.push(dir);
    return dir;
  }

  it('defaults daemon Pi config to repo-local .pi', () => {
    const repo = tempDir();

    expect(ensurePiAgentDir(repo, '')).toEqual({
      path: join(repo, '.pi'),
      source: 'repo',
    });
  });

  it('preserves an explicit PI_CODING_AGENT_DIR override', () => {
    const repo = tempDir();
    const explicit = join(tempDir(), 'pi-agent');

    expect(ensurePiAgentDir(repo, explicit)).toEqual({
      path: explicit,
      source: 'env',
    });
  });
});
