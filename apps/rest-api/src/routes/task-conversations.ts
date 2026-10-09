import { Readable } from 'node:stream';
import { setTimeout } from 'node:timers/promises';

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth } from '@moltnet/auth';
import {
  ProblemDetailsSchema,
  TeamHeaderRequiredSchema,
} from '@moltnet/models';
import {
  ConversationList,
  ConversationParams,
  ConversationReadQuery,
  ConversationSnapshot,
} from '@moltnet/runtime-profiles';
import {
  createConversationService,
  createRuntimeStoreService,
} from '@moltnet/runtime-session-service';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from 'typebox';

import { PRINCIPAL_AUTH_SECURITY } from '../openapi-security.js';
import { requireCurrentTeamId } from '../utils/require-current-team-id.js';
import { requireKetoSubject } from '../utils/require-keto-subject.js';

export async function taskConversationRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);
  const service = createConversationService({
    stores: createRuntimeStoreService({
      repository: fastify.runtimeSessionRepository.durable,
      transactionRunner: fastify.transactionRunner,
      storage: fastify.runtimeSessionStorage,
      permissionChecker: fastify.permissionChecker,
      maxBytes: Math.min(fastify.runtimeSessionMaxBytes, 1024 * 1024),
    }),
    repository: fastify.runtimeSessionRepository.durable,
    tasks: fastify.taskRepository,
  });
  const config = {
    rateLimit: fastify.rateLimitConfig.read,
    auth: {
      credentialBindingScope: 'team' as const,
      requiredScopes: ['task:read'] as const,
    },
  };
  const common = {
    tags: ['tasks'],
    security: PRINCIPAL_AUTH_SECURITY,
    headers: TeamHeaderRequiredSchema,
  };
  const errors = {
    400: Type.Ref(ProblemDetailsSchema.$id),
    401: Type.Ref(ProblemDetailsSchema.$id),
    403: Type.Ref(ProblemDetailsSchema.$id),
    404: Type.Ref(ProblemDetailsSchema.$id),
    409: Type.Ref(ProblemDetailsSchema.$id),
    503: Type.Ref(ProblemDetailsSchema.$id),
  };
  const subject = (
    request: FastifyRequest,
    params: { id: string; n: number },
  ) => ({
    ...requireKetoSubject(request),
    teamId: requireCurrentTeamId(request, 'task conversations'),
    taskId: params.id,
    attemptN: params.n,
  });
  const path = '/tasks/:id/attempts/:n/conversations';
  server.get(
    path,
    {
      config,
      schema: {
        ...common,
        operationId: 'listTaskConversations',
        params: Type.Omit(ConversationParams, ['conversationId']),
        response: { ...errors, 200: ConversationList },
      },
    },
    async (request) => {
      const reader = await service.open(subject(request, request.params));
      try {
        return reader.list();
      } finally {
        await reader.close();
      }
    },
  );
  server.get(
    `${path}/:conversationId`,
    {
      config,
      schema: {
        ...common,
        operationId: 'getTaskConversation',
        params: ConversationParams,
        querystring: ConversationReadQuery,
        response: { ...errors, 200: ConversationSnapshot },
      },
    },
    async (request) => {
      const reader = await service.open(subject(request, request.params));
      try {
        return await reader.snapshot(
          request.params.conversationId,
          request.query,
        );
      } finally {
        await reader.close();
      }
    },
  );
  server.get(
    `${path}/:conversationId/events`,
    {
      config,
      schema: {
        ...common,
        operationId: 'watchTaskConversation',
        description:
          'SSE replacement snapshots of the latest 100 entries plus partial response. Each connection, including reconnects, starts with a fresh snapshot; replace prior state. IDs are opaque revision tokens, not replay offsets. Stream closes after five minutes; reconnect to continue. Reading never starts execution.',
        params: ConversationParams,
        response: {
          ...errors,
          200: {
            description:
              'conversation.snapshot events; subsequent failure terminates the stream. Reconnect to reauthorize and refresh.',
            content: {
              'text/event-stream': {
                schema: Type.String({ format: 'binary' }),
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const cancellation = new AbortController();
      const disconnected = () => cancellation.abort();
      reply.raw.once('close', disconnected);
      const signal = AbortSignal.any([
        cancellation.signal,
        AbortSignal.timeout(300_000),
      ]);
      let reader: Awaited<ReturnType<typeof service.open>>;
      try {
        reader = await service.open(subject(request, request.params));
      } catch (error) {
        reply.raw.off('close', disconnected);
        throw error;
      }
      let initial: ConversationSnapshot;
      try {
        initial = await reader.snapshot(request.params.conversationId);
      } catch (error) {
        await reader.close();
        reply.raw.off('close', disconnected);
        throw error;
      }
      async function* events() {
        let snapshot = initial;
        let cursor: string | undefined;
        try {
          while (!signal.aborted) {
            if (snapshot.cursor !== cursor) {
              const frame = `id: ${snapshot.cursor}\nevent: conversation.snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;
              if (Buffer.byteLength(frame) > 8 * 1024 * 1024)
                throw new Error(
                  'Conversation snapshot exceeds stream frame limit',
                );
              yield frame;
              cursor = snapshot.cursor;
            } else yield ': keepalive\n\n';
            await setTimeout(1000, undefined, { signal });
            await reader.refresh(signal);
            snapshot = await reader.snapshot(request.params.conversationId);
          }
        } catch (error) {
          if (!signal.aborted) throw error;
        } finally {
          reply.raw.off('close', disconnected);
          await reader.close();
        }
      }
      return reply
        .header('Cache-Control', 'no-store')
        .header('X-Accel-Buffering', 'no')
        .type('text/event-stream')
        .send(Readable.from(events(), { highWaterMark: 1 }) as never);
    },
  );
}
