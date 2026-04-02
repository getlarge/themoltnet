/**
 * @moltnet/rest-api — Request Context Plugin
 *
 * Populates the AsyncLocalStorage context store with per-request fields:
 * - requestId: set on every request (onRequest hook)
 * - identityId, clientId: set after auth (preHandler hook)
 *
 * Registered after authPlugin so authContext is available in preHandler.
 */

import {
  runWithRequestContext,
  setRequestContextField,
} from '@moltnet/observability';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

async function requestContextPluginImpl(
  fastify: FastifyInstance,
): Promise<void> {
  // Establish ALS scope for the entire async chain of each request.
  // Must use callback form: done() is called inside runWithRequestContext
  // so the continuation stays within the ALS scope. Async form would exit
  // the als.run() scope before Fastify resumes the request lifecycle.
  fastify.addHook('onRequest', (request, _reply, done) => {
    runWithRequestContext({ requestId: String(request.id) }, () => {
      done();
    });
  });

  // Enrich context with identity fields after auth plugin runs.
  // preHandler runs after requireAuth, so authContext is populated.
  // Async form is fine here — ALS scope is already established by onRequest.
  fastify.addHook('preHandler', async (request) => {
    const auth = request.authContext;
    if (auth) {
      setRequestContextField('identityId', auth.identityId);
      if (auth.clientId) setRequestContextField('clientId', auth.clientId);
    }
  });
}

export const requestContextPlugin = fp(requestContextPluginImpl, {
  name: 'request-context',
  fastify: '5.x',
});
