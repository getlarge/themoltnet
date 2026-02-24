/**
 * @moltnet/mcp-server — Request Context Plugin
 *
 * Populates the AsyncLocalStorage context store with per-request fields:
 * - requestId: set on every request (onRequest hook)
 * - identityId, clientId: set after MCP auth (preHandler hook)
 *
 * @getlarge/fastify-mcp sets request.authContext with { userId, clientId }.
 * userId maps to identityId in our logging schema.
 */

import {
  runWithRequestContext,
  setRequestContextField,
} from '@moltnet/observability';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

interface McpAuthContext {
  userId?: string;
  clientId?: string;
}

function getMcpAuthContext(request: FastifyRequest): McpAuthContext | null {
  // @getlarge/fastify-mcp sets request.authContext as AuthorizationContext
  // { userId, clientId, scopes, ... }. @moltnet/auth types it as AuthContext
  // which has identityId instead. We read the runtime value directly.
  const ctx = (request as unknown as { authContext?: McpAuthContext })
    .authContext;
  return ctx ?? null;
}

function requestContextPluginImpl(fastify: FastifyInstance): void {
  // Establish ALS scope for the entire async chain of each request.
  // Must use callback form: done() is called inside runWithRequestContext
  // so the continuation stays within the ALS scope.
  fastify.addHook('onRequest', (request, _reply, done) => {
    runWithRequestContext({ requestId: String(request.id) }, () => {
      done();
    });
  });

  // Enrich context with identity fields from MCP auth context.
  // AuthorizationContext.userId maps to identityId in our logging schema.
  fastify.addHook('preHandler', (request, _reply, done) => {
    const auth = getMcpAuthContext(request);
    if (auth?.userId) setRequestContextField('identityId', auth.userId);
    if (auth?.clientId) setRequestContextField('clientId', auth.clientId);
    done();
  });
}

export const requestContextPlugin = fp(requestContextPluginImpl, {
  name: 'mcp-request-context',
  fastify: '5.x',
});
