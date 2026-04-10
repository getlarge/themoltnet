import { FastifyRequest } from 'fastify';

interface AuthContext {
  identityId: string;
  clientId: string;
  teamId?: string;
  scopes: string[];
}

/**
 * Resolves the team context for the request by checking:
 * 1. X-Team-Id header (explicit team selection)
 * 2. Default team from the agent's profile
 *
 * Sets request.authContext.teamId when resolved.
 */
export async function resolveTeamContext(
  request: FastifyRequest,
  authContext: AuthContext,
): Promise<AuthContext> {
  const teamHeader = request.headers['x-team-id'] as string | undefined;
  if (teamHeader) {
    const isMember = await request.server.permissionChecker.checkTeamMembership(
      authContext.identityId,
      teamHeader,
    );
    if (!isMember) {
      throw request.server.httpErrors.forbidden('Not a member of the specified team');
    }
    return { ...authContext, teamId: teamHeader };
  }

  const defaultTeam = await request.server.agentRepository.getDefaultTeam(
    authContext.identityId,
  );
  if (defaultTeam) {
    return { ...authContext, teamId: defaultTeam.id };
  }

  return authContext;
}
