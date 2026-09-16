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
  const env = parseEnvFile(contents);
  const teamId = env.get('MOLTNET_TEAM_ID');
  const diaryId = env.get('MOLTNET_DIARY_ID');
  if (!teamId || !diaryId) return {};
  return { teamId, diaryId };
}

function parseEnvFile(contents: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = unquote(line.slice(separator + 1).trim());
    if (key.length > 0 && value.length > 0) values.set(key, value);
  }
  return values;
}

function unquote(value: string): string {
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"));
  return quoted && value.length >= 2 ? value.slice(1, -1) : value;
}
