import { TEAM_HEADER } from '@moltnet/auth';

import { createProblem } from '../problems/index.js';

/**
 * Resolve the active team from request auth context (populated from the
 * `x-moltnet-team-id` header by the auth plugin). Throws a validation problem
 * when absent. Shared by all team-scoped routes so the header is the single
 * source of team context.
 *
 * @param resource short noun used in the error detail, e.g. "tasks".
 */
export function requireCurrentTeamId(
  request: { authContext: { currentTeamId: string | null } | null },
  resource: string,
): string {
  const teamId = request.authContext?.currentTeamId;
  if (!teamId) {
    throw createProblem(
      'validation-failed',
      `${TEAM_HEADER} header is required: ${resource} are team-scoped`,
    );
  }
  return teamId;
}
