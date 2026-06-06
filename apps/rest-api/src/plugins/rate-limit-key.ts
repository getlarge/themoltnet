/**
 * Rate-limit key derivation.
 *
 * The @fastify/rate-limit hook runs at `onRequest`, BEFORE the auth preHandler
 * populates `request.authContext`. So the limiter cannot read a resolved
 * identity — it must derive a stable per-identity bucket key from the raw
 * request itself. This module does that cheaply and WITHOUT verifying anything:
 * the key only selects a counter bucket, never grants access. A forged or
 * garbage token still fails real signature/session verification later in the
 * auth preHandler and never reaches a handler — the worst an attacker can do by
 * choosing a key is rate-limit themselves.
 *
 * Keys are namespaced by source (`id:`, `tok:`, `sess:`, `ip:`) so an
 * attacker-chosen claim value can never collide with another principal's bucket
 * (e.g. a `sub` set to a victim's IP string lands in `id:`, not `ip:`).
 *
 * See issue #1336 and the incident write-up: before this, every authenticated
 * request fell through to `request.ip`, collapsing all identities behind a
 * proxy/NAT (and, with no trustProxy, behind the Fly edge IP) into one bucket
 * AND onto the stricter anonymous limit.
 */

import { createHash } from 'node:crypto';

const SESSION_TOKEN_HEADER = 'x-moltnet-session-token';

/** Ory opaque access/handle token prefixes — not JWTs, cannot be decoded. */
const ORY_OPAQUE_PREFIXES = ['ory_at_', 'ory_ht_'];

/**
 * Kratos session cookie names: `ory_kratos_session` (self-hosted) and
 * `ory_session_<slug>` (Ory Network). Anchored to header start or `; ` so a
 * value like `analytics_id=ory_session_x` does not match. Mirrors the auth
 * plugin's cookie gating.
 */
const KRATOS_COOKIE_NAME_REGEX = /(?:^|;\s*)ory(?:_kratos_session|_session_)/;

/** The minimal request shape the key derivation needs. */
export interface RateLimitKeyInput {
  headers: Record<string, string | string[] | undefined>;
  ip: string;
}

function headerValue(
  headers: RateLimitKeyInput['headers'],
  name: string,
): string | null {
  const raw = headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() || null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function bearerToken(headers: RateLimitKeyInput['headers']): string | null {
  const header = headerValue(headers, 'authorization');
  if (!header) return null;
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  return parts[1].trim() || null;
}

function isOpaqueOryToken(token: string): boolean {
  return ORY_OPAQUE_PREFIXES.some((prefix) => token.startsWith(prefix));
}

/**
 * Pull a stable identity id from a JWT's claims WITHOUT verifying it. A JWT is
 * `header.payload.signature`; we base64url-decode the payload segment only and
 * read claims. No signature check — that is the auth preHandler's job, and this
 * value only selects a rate-limit bucket. Prefers the enriched
 * `moltnet:identity_id` claim, falls back to `sub`. Returns null if the token
 * is not a well-formed JWT with a JSON payload.
 */
function identityFromJwt(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const claims = JSON.parse(json) as Record<string, unknown>;
    if (!claims || typeof claims !== 'object') return null;
    const identityId =
      (claims['moltnet:identity_id'] as string | undefined) ??
      (claims['sub'] as string | undefined);
    return identityId?.trim() || null;
  } catch {
    return null;
  }
}

function cookieHeader(headers: RateLimitKeyInput['headers']): string | null {
  const raw = headers['cookie'];
  const value = Array.isArray(raw) ? raw.join('; ') : raw;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Derive the rate-limit bucket key for a request. Resolution order mirrors the
 * auth preHandler: Kratos session (native token header, then cookie), then
 * Bearer (JWT decode, then opaque-token hash), then anonymous IP fallback.
 */
export function deriveRateLimitKey(request: RateLimitKeyInput): string {
  const { headers, ip } = request;

  // 1. Native Kratos session token header.
  const sessionToken = headerValue(headers, SESSION_TOKEN_HEADER);
  if (sessionToken) return `sess:${sha256(sessionToken)}`;

  // 2. Bearer token (JWT or opaque).
  const token = bearerToken(headers);
  if (token) {
    if (!isOpaqueOryToken(token)) {
      const identityId = identityFromJwt(token);
      if (identityId) return `id:${identityId}`;
    }
    // Opaque token, or an undecodable bearer value: hash the token itself.
    // Still a stable per-token (≈ per-identity) bucket, far better than IP.
    return `tok:${sha256(token)}`;
  }

  // 3. Browser Kratos session cookie.
  const cookie = cookieHeader(headers);
  if (cookie && KRATOS_COOKIE_NAME_REGEX.test(cookie)) {
    return `sess:${sha256(cookie)}`;
  }

  // 4. Anonymous: key on the (proxy-aware) client IP.
  return `ip:${ip}`;
}

/**
 * True when a derived key represents an authenticated principal (not an IP
 * fallback). The rate-limit `max()` uses this to apply the authenticated limit
 * instead of the stricter anonymous limit — fixing the second half of the
 * onRequest race where authed users were silently capped at the anon limit.
 */
export function isAuthenticatedKey(key: string): boolean {
  return (
    key.startsWith('id:') || key.startsWith('tok:') || key.startsWith('sess:')
  );
}
