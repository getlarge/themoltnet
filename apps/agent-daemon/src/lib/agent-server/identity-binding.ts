/**
 * The identity-wide team/diary binding, read from `<identityDir>/env`.
 *
 * This mirrors the Go CLI's `identityDefaultBinding` (`project_selection.go`),
 * which is the fallback the CLI uses when a working directory has no
 * registered project binding.
 *
 * The desktop cannot use the CLI's *location* bindings at all — its composer
 * has no working directory to key on — but it can honour this identity-wide
 * default, so an operator sees their familiar team preselected rather than an
 * arbitrary first entry.
 *
 * Like the CLI, a half-filled pair is treated as no binding: a team without a
 * diary is ignored.
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
  // The Go CLI calls this a "shell-sourceable env file" and reads it with
  // `godotenv.Read`; Go has no parser for this in its standard library, so it
  // cannot converge on a native one the way this side just did.
  //
  // Node's parser agrees with godotenv on everything this file can hold --
  // quoting, `export`, comments, CRLF, blank lines, empty values -- with one
  // divergence: an unquoted `#` mid-value starts a comment here, while both
  // godotenv *and* an actual shell keep it. So JS is the outlier against the
  // file's own format, and was before this used Node's parser too.
  //
  // Left alone deliberately: the only two keys read below are UUIDs, which
  // cannot contain `#`, and matching godotenv exactly would mean hand-rolling
  // the parser this deliberately stopped hand-rolling.
  const env = parseEnv(contents);
  const teamId = env['MOLTNET_TEAM_ID']?.trim();
  const diaryId = env['MOLTNET_DIARY_ID']?.trim();
  if (!teamId || !diaryId) return {};
  return { teamId, diaryId };
}
