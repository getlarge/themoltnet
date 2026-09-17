import type {
  AuthContext,
  RelationshipReader,
  RelationshipWriter,
} from '@moltnet/auth';
import type { TeamRepository } from '@moltnet/database';
import Fastify from 'fastify';

import { teamRoutes } from '../../src/routes/teams.js';
import { sharedSchemas } from '../../src/schemas.js';
import type { RedeemTeamInvite } from '../../src/workflows/team-invite-workflow.js';

/** Real production routes; only identity verification is injected in this isolated crash fixture. */
export async function startInviteHttpServer(
  input: RedeemTeamInvite,
  teamRepository: TeamRepository,
  relationshipReader: RelationshipReader,
  relationshipWriter: RelationshipWriter,
) {
  const app = Fastify();
  const limit = { max: 100, timeWindow: '1 minute' };
  app.decorate('rateLimitConfig', {
    embedding: limit,
    signing: limit,
    recovery: limit,
    publicSearch: limit,
    legreffierStart: limit,
    legreffierStatus: limit,
    registration: limit,
    readiness: limit,
    taskArtifactUpload: { ...limit, groupId: 'fixture' },
    read: { ...limit, groupId: 'fixture' },
  });
  for (const schema of sharedSchemas) app.addSchema(schema);
  app.decorate('teamRepository', teamRepository);
  app.decorate('relationshipReader', relationshipReader);
  app.decorate('relationshipWriter', relationshipWriter);
  app.decorateRequest('authContext', null);
  app.addHook('onRequest', async (request) => {
    request.authContext = {
      subjectType: input.subjectNs === 'Human' ? 'human' : 'agent',
      agentId: input.subjectId,
      humanId: input.subjectId,
      identityId: input.subjectId,
      publicKey: '',
      fingerprint: '',
      clientId: 'fixture',
      scopes: ['team:join'],
      currentTeamId: null,
    } as AuthContext;
  });
  app.setErrorHandler(
    (
      error: Error & { statusCode?: number; code?: string },
      _request,
      reply,
    ) => {
      const status = error.statusCode ?? 500;
      void reply.status(status).send({
        type: 'about:blank',
        title: error.message,
        status,
        code: error.code,
      });
    },
  );
  await app.register(teamRoutes);
  return app.listen({ host: '127.0.0.1', port: 0 });
}
