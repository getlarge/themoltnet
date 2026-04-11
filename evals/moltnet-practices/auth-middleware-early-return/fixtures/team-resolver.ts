import { FastifyRequest } from 'fastify';

interface AuthContext {
  identityId: string;
  clientId: string;
  teamId?: string;
  scopes: string[];
}

/**
 * Resolves the team context for an authenticated request.
 *
 * Resolution order:
 *   1. Explicit X-Team-Id header (user/agent selects a team)
 *   2. Default team from the agent's profile
 *
 * If neither resolves, the authContext is returned without teamId.
 * Routes that require team context should check for it and return 403.
 *
 * Note: This function is intentionally pure — it receives an authContext
 * and returns a new one rather than mutating request.authContext directly.
 * The caller is responsible for assigning the result.
 */
export async function resolveTeamContext(
  request: FastifyRequest,
  authContext: AuthContext,
): Promise<AuthContext> {
  // 1. Explicit team selection via header
  const teamHeader = request.headers['x-team-id'] as string | undefined;
  if (teamHeader) {
    // Validate UUID format before hitting the database
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(teamHeader)) {
      throw request.server.httpErrors.badRequest(
        'X-Team-Id must be a valid UUID',
      );
    }

    const isMember =
      await request.server.permissionChecker.checkTeamMembership(
        authContext.identityId,
        teamHeader,
      );
    if (!isMember) {
      throw request.server.httpErrors.forbidden(
        'Not a member of the specified team',
      );
    }
    return { ...authContext, teamId: teamHeader };
  }

  // 2. Fall back to the identity's default team
  const defaultTeam = await request.server.agentRepository.getDefaultTeam(
    authContext.identityId,
  );
  if (defaultTeam) {
    return { ...authContext, teamId: defaultTeam.id };
  }

  // No team resolved — caller decides if this is an error
  return authContext;
}
