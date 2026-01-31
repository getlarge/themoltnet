/**
 * @moltnet/auth — Fastify Auth Plugin
 *
 * Provides request.authContext decorator, and preHandler factories
 * for protecting routes with OAuth2 token validation and scope checks.
 */

import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify';
import fp from 'fastify-plugin';

import type { PermissionChecker } from './permission-checker.js';
import type { TokenValidator } from './token-validator.js';
import type { AuthContext } from './types.js';

export interface AuthPluginOptions {
  tokenValidator: TokenValidator;
  permissionChecker: PermissionChecker;
}

declare module 'fastify' {
  interface FastifyInstance {
    tokenValidator: TokenValidator;
    permissionChecker: PermissionChecker;
  }
  interface FastifyRequest {
    authContext: AuthContext | null;
  }
}

function extractBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;

  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;

  const token = parts[1].trim();
  return token || null;
}

export const authPlugin = fp(
  async function authPluginImpl(
    fastify: FastifyInstance,
    opts: AuthPluginOptions,
  ) {
    fastify.decorateRequest('authContext', null);
    fastify.decorate('tokenValidator', opts.tokenValidator);
    fastify.decorate('permissionChecker', opts.permissionChecker);
  },
  {
    name: '@moltnet/auth',
    fastify: '5.x',
  },
);

export const requireAuth: preHandlerAsyncHookHandler =
  async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Missing authorization header',
        statusCode: 401,
      });
    }

    if (!authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Invalid authorization scheme',
        statusCode: 401,
      });
    }

    const token = extractBearerToken(request);
    if (!token) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Missing authorization header',
        statusCode: 401,
      });
    }

    const authContext =
      await request.server.tokenValidator.resolveAuthContext(token);
    if (!authContext) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Invalid or expired token',
        statusCode: 401,
      });
    }

    request.authContext = authContext;
  };

export const optionalAuth: preHandlerAsyncHookHandler =
  async function optionalAuth(request: FastifyRequest) {
    const token = extractBearerToken(request);
    if (!token) return;

    const authContext =
      await request.server.tokenValidator.resolveAuthContext(token);
    if (authContext) {
      request.authContext = authContext;
    }
  };

export function requireScopes(scopes: string[]): preHandlerAsyncHookHandler {
  return async function requireScopesHandler(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    if (!request.authContext) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
        statusCode: 401,
      });
    }

    for (const scope of scopes) {
      if (!request.authContext.scopes.includes(scope)) {
        return reply.status(403).send({
          error: 'FORBIDDEN',
          message: `Missing required scope: ${scope}`,
          statusCode: 403,
        });
      }
    }
  };
}
