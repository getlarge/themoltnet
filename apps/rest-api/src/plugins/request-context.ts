/**
 * @moltnet/rest-api — Request Context Plugin
 *
 * Populates the AsyncLocalStorage context store with per-request fields:
 * - requestId: set on every request (onRequest hook)
 * - identityId, clientId: set after auth (preHandler hook)
 *
 * Registered after authPlugin so authContext is available in preHandler.
 */

import { enterRequestContext } from '@moltnet/observability';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

async function requestContextPluginImpl(
  fastify: FastifyInstance,
): Promise<void> {
  // Establish the ALS scope for every request as early as possible.
  // Using enterWith() (not als.run()) is critical: Fastify's hook chain
  // resumes via its own scheduler after `done()`, and a callback-wrapped
  // als.run() leaks the scope the moment Fastify takes over. enterWith()
  // mutates the current async context in place; child async resources
  // (subsequent hooks, the route handler, downstream awaits) inherit it.
  //
  // Identity fields (identityId, clientId, subjectType, currentTeamId)
  // are written into the same ALS store from inside the auth plugin's
  // requireAuth/optionalAuth handlers — they're route-scoped preHandlers
  // and run AFTER any global preHandler we could register here.
  fastify.addHook('onRequest', async (request) => {
    enterRequestContext({ requestId: String(request.id) });
  });
}

export const requestContextPlugin = fp(requestContextPluginImpl, {
  name: 'request-context',
  fastify: '5.x',
});
