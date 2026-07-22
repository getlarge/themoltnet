/**
 * Shared HTTP header and constant definitions for MoltNet auth.
 */

/** Header name for team context. Lowercase per HTTP/2 convention. */
export const TEAM_HEADER = 'x-moltnet-team-id' as const;

/** Header name for Kratos session token (dashboard/console auth). Lowercase per HTTP/2 convention. */
export const SESSION_TOKEN_HEADER = 'x-moltnet-session-token' as const;

/**
 * Ory opaque token prefixes (access / handle tokens). Tokens with these
 * prefixes are introspected via Hydra rather than decoded as JWTs. Shared so
 * the auth token-validator and any pre-auth consumer (e.g. the rate-limit key
 * extractor) agree on what counts as opaque.
 */
export const ORY_OPAQUE_PREFIXES = ['ory_at_', 'ory_ht_'] as const;

/**
 * Talos issued-key prefixes accepted by the authentication chokepoint.
 * `ory_ak_` is used by Ory Network; the local OSS configuration uses
 * `talos_` so credentials cannot be confused with Hydra access tokens.
 */
export const TALOS_API_KEY_PREFIXES = ['ory_ak_', 'talos_'] as const;

/**
 * Kratos session cookie names: `ory_kratos_session` (self-hosted) and
 * `ory_session_<slug>` (Ory Network). Anchored to header start or `; ` so a
 * value like `analytics_id=ory_session_x` does not match. Shared between the
 * auth plugin's cookie gating and the rate-limit key extractor.
 */
export const KRATOS_COOKIE_NAME_REGEX =
  /(?:^|;\s*)ory(?:_kratos_session|_session_)/;
