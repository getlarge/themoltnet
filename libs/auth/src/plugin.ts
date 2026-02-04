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

function createAuthError(message: string): Error & {
  statusCode: number;
  code: string;
  detail: string;
} {
  const error = new Error(message) as Error & {
    statusCode: number;
    code: string;
    detail: string;
  };
  error.statusCode = 401;
  error.code = 'UNAUTHORIZED';
  error.detail = message;
  return error;
}

export const requireAuth: preHandlerAsyncHookHandler =
  async function requireAuth(request: FastifyRequest, _reply: FastifyReply) {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      throw createAuthError('Missing authorization header');
    }

    if (!authHeader.startsWith('Bearer ')) {
      throw createAuthError('Invalid authorization scheme');
    }

    const token = extractBearerToken(request);
    if (!token) {
      throw createAuthError('Missing authorization header');
    }

    const authContext =
      await request.server.tokenValidator.resolveAuthContext(token);
    if (!authContext) {
      throw createAuthError('Invalid or expired token');
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
    _reply: FastifyReply,
  ) {
    if (!request.authContext) {
      throw createAuthError('Authentication required');
    }

    for (const scope of scopes) {
      if (!request.authContext.scopes.includes(scope)) {
        const error = new Error(`Missing required scope: ${scope}`) as Error & {
          statusCode: number;
          code: string;
          detail: string;
        };
        error.statusCode = 403;
        error.code = 'FORBIDDEN';
        error.detail = `Missing required scope: ${scope}`;
        throw error;
      }
    }
  };
}
