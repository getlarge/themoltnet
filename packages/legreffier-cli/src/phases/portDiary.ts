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
 * Standard UUID v4-ish shape. Diary IDs are server-issued UUIDs; anything
 * else in this field is either stale data, a mis-parsed env line, or a
 * crafted injection attempt (e.g. embedded newlines) and must be rejected
 * before we echo it into the target env file.
 */
const DIARY_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read `MOLTNET_DIARY_ID` from a source env file.
 * Returns null if the file or key is absent, or if the stored value is
 * not a valid UUID (defensive: never propagate malformed data).
 */
export async function readSourceDiaryId(
  sourceDir: string,
): Promise<string | null> {
  try {
    const content = await readFile(join(sourceDir, 'env'), 'utf-8');
    const parsed = parseEnvFile(content);
    const raw = parsed.MOLTNET_DIARY_ID;
    if (!raw || !DIARY_ID_RE.test(raw)) {
      return null;
    }
    return raw;
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
  const strippedExisting = filtered.length !== lines.length;

  if (mode === 'reuse') {
    if (!sourceDiaryId) {
      // Nothing to reuse, nothing written. Report no modification so callers
      // get an accurate signal.
      return { mode, diaryId: null, modified: false };
    }
    // Defensive: readSourceDiaryId already validates, but guard against
    // callers passing an arbitrary string.
    if (!DIARY_ID_RE.test(sourceDiaryId)) {
      throw new Error(
        `invalid sourceDiaryId: ${JSON.stringify(sourceDiaryId)} — expected UUID`,
      );
    }
    // Append as a new managed line. sourceDiaryId is UUID-validated above,
    // so no shell/quote escaping is needed — it only contains [0-9a-f-].
    const diaryLine = `MOLTNET_DIARY_ID='${sourceDiaryId}'`;
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
    await writeFile(envPath, filtered.join('\n'), { mode: 0o600 });
    return { mode, diaryId: sourceDiaryId, modified: true };
  }

  // mode === 'new': strip any existing MOLTNET_DIARY_ID line
  if (strippedExisting) {
    await writeFile(envPath, filtered.join('\n'), { mode: 0o600 });
  }
  return { mode, diaryId: null, modified: strippedExisting };
}
