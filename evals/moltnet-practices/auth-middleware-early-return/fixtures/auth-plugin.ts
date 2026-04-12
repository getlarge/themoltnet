import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { resolveTeamContext } from './team-resolver.js';

interface AuthContext {
  identityId: string;
  clientId: string;
  teamId?: string;
  scopes: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    authContext?: AuthContext;
  }
  interface FastifyInstance {
    kratosClient: {
      toSession(opts: { cookie: string }): Promise<{
        identity?: { id: string; traits?: Record<string, unknown> };
        active?: boolean;
        expires_at?: string;
      } | null>;
    };
    tokenValidator: {
      validate(token: string): Promise<{
        identityId: string;
        clientId: string;
        scopes: string[];
      } | null>;
    };
    rateLimiter: { consume(key: string): Promise<void> };
    auditEmitter: { emit(event: Record<string, unknown>): void };
    permissionChecker: {
      checkTeamMembership(id: string, teamId: string): Promise<boolean>;
    };
    agentRepository: {
      getDefaultTeam(id: string): Promise<{ id: string } | null>;
    };
  }
}

// --- Utility: parse session cookie from the cookie header ---
function extractSessionCookie(request: FastifyRequest): string | undefined {
  const raw = request.cookies?.['ory_kratos_session'];
  if (!raw) return undefined;
  // Cookies may arrive URL-encoded from some proxy setups
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// --- Utility: check if a session is still valid ---
function isSessionActive(session: {
  active?: boolean;
  expires_at?: string;
} | null): boolean {
  if (!session?.active) return false;
  if (session.expires_at) {
    return new Date(session.expires_at).getTime() > Date.now();
  }
  return true;
}

/**
 * Adds request-scoped logger fields for authenticated requests.
 * This runs after optionalAuth so authContext is populated.
 */
async function enrichLogger(request: FastifyRequest): Promise<void> {
  if (request.authContext) {
    request.log = request.log.child({
      identityId: request.authContext.identityId,
      teamId: request.authContext.teamId,
      scopes: request.authContext.scopes,
    });
  }
}

/**
 * Rate-limits by identity rather than IP for authenticated requests.
 * Falls back to IP-based limiting for unauthenticated requests
 * (handled by the global rate limiter, not this hook).
 */
async function identityRateLimit(request: FastifyRequest): Promise<void> {
  if (request.authContext) {
    await request.server.rateLimiter.consume(
      `identity:${request.authContext.identityId}`,
    );
  }
}

/**
 * Validates webhook signatures for internal service-to-service calls.
 * Runs before optionalAuth — if the webhook header is present and
 * valid, we skip normal auth entirely.
 */
async function webhookAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const webhookSig = request.headers['x-webhook-signature'] as
    | string
    | undefined;
  if (!webhookSig) return;

  const isValid = webhookSig.startsWith('sha256=') && webhookSig.length > 10;
  if (!isValid) {
    return reply.code(403).send({ error: 'Invalid webhook signature' });
  }

  // Webhook requests get a synthetic service authContext
  request.authContext = {
    identityId: 'service:webhook',
    clientId: 'internal',
    scopes: ['webhook'],
  };
}

/**
 * optionalAuth preHandler hook.
 * Attempts to authenticate via session cookie OR bearer token.
 * Sets request.authContext if authentication succeeds, leaves it
 * undefined otherwise (downstream routes decide if auth is required).
 *
 * Authentication methods (in priority order):
 *   1. Webhook signature (handled by separate hook, runs first)
 *   2. Session cookie (Kratos browser flow)
 *   3. Bearer token (OAuth2 client_credentials / JWT)
 */
async function optionalAuth(request: FastifyRequest): Promise<void> {
  // Skip if already authenticated (e.g. by webhookAuth)
  if (request.authContext) return;

  // Path 1: Session cookie (Kratos)
  const sessionCookie = extractSessionCookie(request);
  if (sessionCookie) {
    const session = await request.server.kratosClient.toSession({
      cookie: `ory_kratos_session=${sessionCookie}`,
    });
    if (isSessionActive(session) && session?.identity?.id) {
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

export default async function authPlugin(
  fastify: FastifyInstance,
): Promise<void> {
  // Webhook auth runs first (highest priority)
  fastify.addHook('preHandler', webhookAuth);
  // Then normal auth
  fastify.addHook('preHandler', optionalAuth);
  // Post-auth enrichment
  fastify.addHook('preHandler', enrichLogger);
  fastify.addHook('preHandler', identityRateLimit);
}
