/**
 * The identity-wide team/diary binding, read from `<identityDir>/env`.
 *
 * This mirrors the Go CLI's `identityDefaultBinding` (`context_store.go:219`),
 * which is the fallback the CLI uses when a working directory has no
 * location-keyed binding in `contexts.json`.
 *
 * The desktop cannot use the CLI's *location* bindings at all — its composer
 * has no working directory to key on — but it can honour this identity-wide
 * default, so an operator who ran `moltnet context set` sees their familiar
 * team preselected rather than an arbitrary first entry.
 *
 * Like the CLI, a half-filled pair is treated as no binding: a team without a
 * diary is exactly the state `validateContextBinding` rejects.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

export interface IdentityDefaultBinding {
  teamId?: string;
  diaryId?: string;
}

export function readIdentityDefaultBinding(
  identityDir: string,
): IdentityDefaultBinding {
  let contents: string;
  try {
    contents = readFileSync(join(identityDir, 'env'), 'utf8');
  } catch {
    // An absent or unreadable default is not a reason to fail the catalogue.
    return {};
  }
  // The Go CLI reads this same file with `godotenv.Read`. Node's parser agrees
  // with it on everything this file can hold -- quoting, `export`, comments,
  // CRLF -- with one known divergence: an unquoted `#` mid-value starts a
  // comment here and does not in Go. Both values read below are UUIDs, so that
  // case cannot arise; a hand-rolled parser was the real risk, and this is not
  // one.
  const env = parseEnv(contents);
  const teamId = env['MOLTNET_TEAM_ID']?.trim();
  const diaryId = env['MOLTNET_DIARY_ID']?.trim();
  if (!teamId || !diaryId) return {};
  return { teamId, diaryId };
}
