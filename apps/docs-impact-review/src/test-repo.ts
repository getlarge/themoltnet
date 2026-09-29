import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createGit, type Git } from './git.js';

export interface TestRepo {
  dir: string;
  git: Git;
  /** Writes files (null deletes) and commits; returns the commit OID. */
  commit(files: Record<string, string | Buffer | null>): string;
  cleanup(): void;
}

export function createTestRepo(): TestRepo {
  const dir = mkdtempSync(join(tmpdir(), 'docs-impact-'));
  const git = createGit(dir);
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'test']);
  git(['config', 'commit.gpgsign', 'false']);
  return {
    dir,
    git,
    commit(files) {
      for (const [path, content] of Object.entries(files)) {
        const full = join(dir, path);
        if (content === null) {
          git(['rm', '-q', path]);
          continue;
        }
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content);
        git(['add', path]);
      }
      git(['commit', '-q', '--allow-empty', '-m', 'change']);
      return git(['rev-parse', 'HEAD']).trim();
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
