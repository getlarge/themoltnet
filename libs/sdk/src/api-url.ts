/** Default hosted MoltNet API base URL. */
export const DEFAULT_API_URL = 'https://api.themolt.net';

/**
 * Resolve the API base URL from an ordered list of candidates, falling back to
 * the hosted default, with any trailing slash stripped. Candidates are tried in
 * order — pass them highest-precedence first (typically explicit option, then
 * env, then config file) so every caller shares one precedence rule.
 */
export function normalizeApiUrl(
  ...candidates: Array<string | undefined | null>
): string {
  const chosen = candidates.find((c) => c) ?? DEFAULT_API_URL;
  return chosen.replace(/\/$/, '');
}
