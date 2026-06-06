/**
 * Rate-limit key derivation.
 *
 * The @fastify/rate-limit hook runs at `onRequest`, BEFORE the auth preHandler
 * populates `request.authContext`, and it increments the bucket counter at that
 * point — even for requests the preHandler will later reject with 401. So the
 * limiter cannot read a resolved identity; it must derive a stable bucket key
 * from the raw request, and that key MUST be something the caller *owns*, not
 * something they can freely *choose*.
 *
 * Why we key on the token bytes, not a decoded claim: an earlier version
 * decoded the (unverified) `moltnet:identity_id` JWT claim and keyed on it.
 * Because the bucket increments before signature verification, an attacker could
 * send a token carrying a *victim's* identity id (obtainable from `creator`
 * blocks in API responses) and burn the victim's budget — a targeted
 * cross-identity DoS (issue #1336 review). Hashing the opaque token / raw bearer
 * value instead binds the bucket to bytes the attacker cannot forge for someone
 * else: the worst they can do is rate-limit their own token. The trade-off is
 * that two distinct live tokens for the same principal get separate buckets,
 * which is acceptable (and arguably correct) for abuse isolation.
 *
 * Keys are namespaced by source (`tok:`, `sess:`, `ip:`) so values from
 * different sources can never collide.
 *
 * Before this whole change, every authenticated request fell through to
 * `request.ip`, collapsing all identities behind a proxy/NAT (and, with no
 * trustProxy, behind the Fly edge IP) into one bucket AND onto the stricter
 * anonymous limit.
 */

import { createHash } from 'node:crypto';

import { KRATOS_COOKIE_NAME_REGEX, SESSION_TOKEN_HEADER } from '@moltnet/auth';

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
  // headerValue already trimmed; the token segment carries no leading/trailing
  // space because we split on a single space and require exactly two parts.
  return parts[1] || null;
}

function cookieHeader(headers: RateLimitKeyInput['headers']): string | null {
  const raw = headers['cookie'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Derive the rate-limit bucket key for a request. Resolution order mirrors the
 * auth preHandler: Kratos session (native token header, then cookie), then
 * Bearer token, then anonymous IP fallback. Authenticated sources are keyed on
 * a hash of the credential bytes — never on a decoded, attacker-choosable claim.
 */
export function deriveRateLimitKey(request: RateLimitKeyInput): string {
  const { headers, ip } = request;

  // 1. Native Kratos session token header → hash of the token bytes.
  const sessionToken = headerValue(headers, SESSION_TOKEN_HEADER);
  if (sessionToken) return `sess:${sha256(sessionToken)}`;

  // 2. Bearer token (JWT or opaque Ory token) → hash of the token bytes.
  // We intentionally do NOT decode/trust JWT claims here (see file header).
  const token = bearerToken(headers);
  if (token) return `tok:${sha256(token)}`;

  // 3. Browser Kratos session cookie → hash of the cookie header bytes.
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
 * instead of the stricter anonymous limit — fixing the half of the onRequest
 * race where authed users were silently capped at the anon limit.
 */
export function isAuthenticatedKey(key: string): boolean {
  return key.startsWith('tok:') || key.startsWith('sess:');
}
