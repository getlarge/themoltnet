import { LoopbackViolationError } from './errors.js';

type HeaderMap = Record<string, string | string[] | undefined>;

function headerValue(headers: HeaderMap, name: string): string | undefined {
  const value = headers[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Require that a request is a top-level browser navigation (used by local
 * approval pages that must be opened as a document, never fetched).
 */
export function assertNavigationRequest(headers: HeaderMap): void {
  const site = headerValue(headers, 'sec-fetch-site');
  const mode = headerValue(headers, 'sec-fetch-mode');
  const destination = headerValue(headers, 'sec-fetch-dest');
  if (
    (site !== 'cross-site' && site !== 'same-origin' && site !== 'none') ||
    mode !== 'navigate' ||
    destination !== 'document'
  ) {
    throw new LoopbackViolationError(
      'navigation_required',
      'Request must be opened as a browser navigation',
    );
  }
}

/**
 * Reject an explicit cross-site Fetch-Metadata signal. Only the explicit
 * `cross-site` value is rejected: Safari may omit Fetch Metadata on
 * same-origin form submissions, so the absence of the header is not treated
 * as a violation — callers keep their one-time token as the primary control.
 */
export function rejectExplicitCrossSite(headers: HeaderMap): void {
  if (headerValue(headers, 'sec-fetch-site') === 'cross-site') {
    throw new LoopbackViolationError(
      'cross_site_rejected',
      'Request must not originate cross-site',
    );
  }
}
