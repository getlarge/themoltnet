/**
 * Per-call team context shared by namespaces that scope requests to a team
 * via the `x-moltnet-team-id` header. Callers pass a domain `{ teamId }`
 * option and the namespace builds the wire header internally, so SDK users
 * never construct the raw header themselves.
 */

/** Optional per-call team context (header may be omitted). */
export interface TeamRequestOptions {
  /** Active team. Sets `x-moltnet-team-id` for the request when provided. */
  teamId?: string;
}

/** Required per-call team context (the endpoint mandates the header). */
export interface RequiredTeamRequestOptions {
  /** Active team. Sets `x-moltnet-team-id` for the request. */
  teamId: string;
}

/**
 * Build the team header from an optional option, or `undefined` when no team
 * context was supplied. Used by diaries and runtime-profiles, whose endpoints
 * accept the header optionally.
 */
export function teamHeaders(
  options: TeamRequestOptions | undefined,
): { 'x-moltnet-team-id': string } | undefined {
  return options?.teamId ? { 'x-moltnet-team-id': options.teamId } : undefined;
}

/**
 * Build the team header from a required option. Used by tasks and
 * runtime-slots, whose endpoints mandate the header.
 */
export function requiredTeamHeaders(options: RequiredTeamRequestOptions): {
  'x-moltnet-team-id': string;
} {
  return { 'x-moltnet-team-id': options.teamId };
}
