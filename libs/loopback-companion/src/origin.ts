import { LoopbackViolationError } from './errors.js';

/** Hostnames accepted as loopback for companion servers and origins. */
export function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  );
}

/**
 * Normalize and validate a browser origin. Accepts exact `https:` origins,
 * or `http:` origins whose host is loopback. Rejects values that carry a
 * path, trailing slash, credentials, or any other non-origin decoration
 * (`url.origin !== value` catches all of those).
 */
export function normalizeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new LoopbackViolationError('origin_invalid', 'Origin is not valid', {
      cause,
    });
  }
  if (
    url.origin !== value ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && isLoopbackHostname(url.hostname)))
  ) {
    throw new LoopbackViolationError('origin_invalid', 'Origin is not valid');
  }
  return url.origin;
}

/** Parse a comma-separated origin list (config format shared by companions). */
export function parseAllowedOrigins(csv: string): string[] {
  return csv
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * Exact-origin allowlist. Every configured origin is normalized eagerly so a
 * misconfigured allowlist fails at startup, not at request time.
 */
export class OriginAllowlist {
  private readonly origins: ReadonlySet<string>;

  constructor(allowedOrigins: readonly string[]) {
    if (allowedOrigins.length === 0) {
      throw new Error('OriginAllowlist requires at least one origin');
    }
    this.origins = new Set(
      allowedOrigins.map((origin) => normalizeOrigin(origin)),
    );
  }

  has(origin: string): boolean {
    try {
      return this.origins.has(normalizeOrigin(origin));
    } catch {
      return false;
    }
  }

  /** Return the normalized origin or throw `origin_not_allowed`. */
  assert(value: string): string {
    let origin: string;
    try {
      origin = normalizeOrigin(value);
    } catch {
      throw new LoopbackViolationError(
        'origin_not_allowed',
        'Origin is not allowed',
      );
    }
    if (!this.origins.has(origin)) {
      throw new LoopbackViolationError(
        'origin_not_allowed',
        'Origin is not allowed',
      );
    }
    return origin;
  }
}

/** Extract and require the `Origin` header value. */
export function requireOriginHeader(headers: {
  origin?: string | string[] | undefined;
}): string {
  const origin = headers.origin;
  if (typeof origin !== 'string' || origin.length === 0) {
    throw new LoopbackViolationError('origin_required', 'Origin is required');
  }
  return origin;
}
