import { MoltNetError } from './errors.js';

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
  return stripTrailingSlash(chosen);
}

/**
 * Normalize one optional API URL using nullish fallback semantics.
 *
 * Unlike {@link normalizeApiUrl}, an explicitly supplied empty string remains
 * empty. Registration and public network-info calls historically preserve that
 * distinction, so they use this single-candidate form instead of precedence
 * resolution.
 */
export function normalizeOptionalApiUrl(apiUrl?: string): string {
  return stripTrailingSlash(apiUrl ?? DEFAULT_API_URL);
}

/**
 * A long-lived agent key may only travel over HTTPS, or plaintext HTTP to a
 * loopback address for local development and e2e stacks.
 */
export function requireSecureCredentialApiUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const loopback =
    host === 'localhost' || host === '::1' || /^127(\.\d{1,3}){3}$/.test(host);
  if (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) {
    return apiUrl;
  }
  throw new MoltNetError(
    `Refusing to send credentials to insecure API URL ${JSON.stringify(apiUrl)}; use HTTPS or an HTTP loopback address.`,
    { code: 'INVALID_CONFIG' },
  );
}

function stripTrailingSlash(apiUrl: string): string {
  return apiUrl.replace(/\/$/, '');
}
