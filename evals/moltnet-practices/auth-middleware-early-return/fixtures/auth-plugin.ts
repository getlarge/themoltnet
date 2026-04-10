import { FastifyInstance, FastifyRequest } from 'fastify';
import { resolveTeamContext } from './team-resolver.js';

interface AuthContext {
  identityId: string;
  clientId: string;
  teamId?: string;
  scopes: string[];
}

/**
 * Adds request-scoped logger fields for authenticated requests.
 */
async function enrichLogger(request: FastifyRequest): Promise<void> {
  if (request.authContext) {
    request.log = request.log.child({
      identityId: request.authContext.identityId,
      teamId: request.authContext.teamId,
    });
  }
}

/**
 * Rate-limits by identity rather than IP for authenticated requests.
 */
async function identityRateLimit(request: FastifyRequest): Promise<void> {
  if (request.authContext) {
    await request.server.rateLimiter.consume(
      `identity:${request.authContext.identityId}`,
    );
  }
}

/**
 * optionalAuth preHandler hook.
 * Attempts to authenticate via session cookie OR bearer token.
 * Sets request.authContext if authentication succeeds, leaves it
 * undefined otherwise (downstream routes decide if auth is required).
 */
async function optionalAuth(request: FastifyRequest): Promise<void> {
  // Path 1: Session cookie (Kratos)
  const sessionCookie = request.cookies?.['ory_kratos_session'];
  if (sessionCookie) {
    const session = await request.server.kratosClient.toSession({
      cookie: `ory_kratos_session=${sessionCookie}`,
    });
    if (session?.identity?.id) {
      request.authContext = {
        identityId: session.identity.id,
        clientId: '',
        scopes: ['session'],
      };
      return;
    }
  }

  // Path 2: Bearer token (OAuth2 / JWT)
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const validated = await request.server.tokenValidator.validate(token);
    if (validated) {
      const authContext: AuthContext = {
        identityId: validated.identityId,
        clientId: validated.clientId,
        scopes: validated.scopes,
      };
      const resolved = await resolveTeamContext(request, authContext);
      request.authContext = resolved;
      return;
    }
  }

  // No authentication - leave authContext undefined
}

export default async function authPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', optionalAuth);
  fastify.addHook('preHandler', enrichLogger);
  fastify.addHook('preHandler', identityRateLimit);
}
