import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseEnvFile } from '../env-file.js';

export type PortDiaryMode = 'reuse' | 'new' | 'skip';

export interface PortDiaryResult {
  mode: PortDiaryMode;
  /** The diary ID that was written, or null for 'new' / 'skip'. */
  diaryId: string | null;
  /** True if the target env file was modified. */
  modified: boolean;
}

/**
 * Read `MOLTNET_DIARY_ID` from a source env file.
 * Returns null if the file or key is absent.
 */
export async function readSourceDiaryId(
  sourceDir: string,
): Promise<string | null> {
  try {
    const content = await readFile(join(sourceDir, 'env'), 'utf-8');
    const parsed = parseEnvFile(content);
    return parsed.MOLTNET_DIARY_ID ?? null;
  } catch {
    return null;
  }
}

/**
 * Apply the chosen diary mode to the target env file:
 *
 *  - `reuse`: persist the source MOLTNET_DIARY_ID in the target env
 *  - `new`: strip MOLTNET_DIARY_ID from the target env (legreffier skill
 *    will resolve it at session start via `diaries_list` / create)
 *  - `skip`: leave the target env untouched
 *
 * Assumes the target env file has already been written by `portRewrite`.
 */
export async function runPortDiaryPhase(opts: {
  targetDir: string;
  mode: PortDiaryMode;
  sourceDiaryId: string | null;
}): Promise<PortDiaryResult> {
  const { targetDir, mode, sourceDiaryId } = opts;
  const envPath = join(targetDir, 'env');

  if (mode === 'skip') {
    return { mode, diaryId: null, modified: false };
  }

  let content = '';
  try {
    content = await readFile(envPath, 'utf-8');
  } catch {
    // No env file — nothing to modify. Treat as no-op.
    return { mode, diaryId: null, modified: false };
  }

  const lines = content.split('\n');
  const diaryLineRe = /^\s*MOLTNET_DIARY_ID\s*=/;
  const filtered = lines.filter((l) => !diaryLineRe.test(l));
  let modified = filtered.length !== lines.length;

  if (mode === 'reuse') {
    if (!sourceDiaryId) {
      // Nothing to reuse — surface a soft error by still reporting no write.
      return { mode, diaryId: null, modified };
    }
    // Append as a new managed line. Use single-quote format to match
    // writeEnvFile's q() output.
    const diaryLine = `MOLTNET_DIARY_ID='${sourceDiaryId.replace(/'/g, "'\\''")}'`;
    // Place right after GIT_CONFIG_GLOBAL if present, else at top of
    // managed block (which writeEnvFile always writes first).
    const gitCfgIdx = filtered.findIndex((l) =>
      /^\s*GIT_CONFIG_GLOBAL\s*=/.test(l),
    );
    if (gitCfgIdx >= 0) {
      filtered.splice(gitCfgIdx + 1, 0, diaryLine);
    } else {
      filtered.unshift(diaryLine);
    }
    modified = true;
    await writeFile(envPath, filtered.join('\n'), { mode: 0o600 });
    return { mode, diaryId: sourceDiaryId, modified };
  }

  // mode === 'new': strip any existing MOLTNET_DIARY_ID line
  if (modified) {
    await writeFile(envPath, filtered.join('\n'), { mode: 0o600 });
  }
  return { mode, diaryId: null, modified };
}
