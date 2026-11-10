/**
 * @moltnet/mcp-server — Request Context Plugin
 *
 * Opens the AsyncLocalStorage context store for every request and records its
 * requestId. The MCP route adds identityId and clientId once it has verified
 * the bearer token.
 */

import { runWithRequestContext } from '@moltnet/observability';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

function requestContextPluginImpl(fastify: FastifyInstance): void {
  // Establish ALS scope for the entire async chain of each request.
  // Must use callback form: done() is called inside runWithRequestContext
  // so the continuation stays within the ALS scope.
  fastify.addHook('onRequest', (request, _reply, done) => {
    runWithRequestContext({ requestId: String(request.id) }, () => {
      done();
    });
  });
}

export const requestContextPlugin = fp(requestContextPluginImpl, {
  name: 'mcp-request-context',
  fastify: '5.x',
});
