/**
 * Shared HTTP header and constant definitions for MoltNet auth.
 */

/** Header name for team context. Lowercase per HTTP/2 convention. */
export const TEAM_HEADER = 'x-moltnet-team-id' as const;

/** Header name for Kratos session token (dashboard/console auth). Lowercase per HTTP/2 convention. */
export const SESSION_TOKEN_HEADER = 'x-moltnet-session-token' as const;
