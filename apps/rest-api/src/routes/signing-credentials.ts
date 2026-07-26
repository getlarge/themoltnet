import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth } from '@moltnet/auth';
import type { PrincipalIdentity, SigningCredential } from '@moltnet/database';
import {
  ConflictProblemDetailsSchema,
  ProblemDetailsSchema,
  TeamHeaderRequiredSchema,
} from '@moltnet/models';
import {
  assertNoPrivateSigningMaterial,
  SigningCredentialError,
} from '@moltnet/signing-workflows';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';

import { createProblem } from '../problems/index.js';
import {
  BeginPreviewSignCredentialRegistrationSchema,
  CompletePreviewSignCredentialRegistrationSchema,
  SigningCredentialListSchema,
  SigningCredentialRegistrationSchema,
  SigningCredentialSchema,
} from '../schemas.js';
import {
  batchInflateRowsWithCreator,
  inflateRowCreator,
} from '../utils/auth-principal.js';
import { requireCurrentTeamId } from '../utils/require-current-team-id.js';
import { throwSigningServiceProblem } from '../utils/signing-service-error.js';

const ParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
});
const SIGNING_JSON_BODY_LIMIT = 64 * 1024;

function rejectPrivateRegistrationMaterial(body: {
  publicMaterial?: unknown;
}): void {
  try {
    assertNoPrivateSigningMaterial(body.publicMaterial);
  } catch (error) {
    if (error instanceof SigningCredentialError) {
      throw createProblem('validation-failed', error.message);
    }
    throw error;
  }
}

const CREDENTIAL_TRANSITIONS = [
  {
    action: 'approve',
    from: ['pending_approval'] as const,
    to: 'active' as const,
    operationId: 'approveSigningCredential',
  },
  {
    action: 'suspend',
    from: ['active'] as const,
    to: 'suspended' as const,
    operationId: 'suspendSigningCredential',
  },
  {
    action: 'revoke',
    from: ['pending_approval', 'active', 'suspended'] as const,
    to: 'revoked' as const,
    operationId: 'revokeSigningCredential',
  },
] as const;

type SigningCredentialResponse = Omit<
  SigningCredential,
  'ownerAgentId' | 'ownerHumanId'
> & {
  owner: PrincipalIdentity;
};

async function signingCredentialToResponse(
  credential: SigningCredential,
  fastify: FastifyInstance,
): Promise<SigningCredentialResponse> {
  const { ownerAgentId, ownerHumanId, ...rest } = credential;
  return {
    ...rest,
    owner: await inflateRowCreator(
      {
        creatorAgentId: ownerAgentId,
        creatorHumanId: ownerHumanId,
      },
      fastify,
    ),
  };
}

async function signingCredentialsToResponse(
  credentials: readonly SigningCredential[],
  fastify: FastifyInstance,
): Promise<SigningCredentialResponse[]> {
  const rows = credentials.map(
    ({ ownerAgentId, ownerHumanId, ...credential }) => ({
      ...credential,
      creatorAgentId: ownerAgentId,
      creatorHumanId: ownerHumanId,
    }),
  );
  const resolved = await batchInflateRowsWithCreator(rows, fastify);
  return resolved.map(({ creator, ...credential }) => ({
    ...credential,
    owner: creator,
  }));
}

export async function signingCredentialRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);

  server.post(
    '/crypto/signing-credentials/registrations',
    {
      bodyLimit: SIGNING_JSON_BODY_LIMIT,
      config: {
        auth: { credentialBindingScope: 'team' },
        rateLimit: fastify.rateLimitConfig?.signing,
      },
      preHandler: async (request) => {
        rejectPrivateRegistrationMaterial(request.body);
      },
      schema: {
        operationId: 'beginSigningCredentialRegistration',
        tags: ['crypto'],
        security: [{ sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        body: BeginPreviewSignCredentialRegistrationSchema,
        response: {
          201: Type.Ref(SigningCredentialRegistrationSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const teamId = requireCurrentTeamId(request, 'signing credentials');
      try {
        const registration =
          await fastify.signingService.credentials.beginRegistration({
            actor: request.authContext!,
            teamId,
            ...request.body,
          });
        return await reply.status(201).send(registration);
      } catch (error) {
        throwSigningServiceProblem(error);
      }
    },
  );

  server.post(
    '/crypto/signing-credentials/registrations/:id/complete',
    {
      bodyLimit: SIGNING_JSON_BODY_LIMIT,
      config: {
        auth: { credentialBindingScope: 'team' },
        rateLimit: fastify.rateLimitConfig?.signing,
      },
      preHandler: async (request) => {
        rejectPrivateRegistrationMaterial(request.body);
      },
      schema: {
        operationId: 'completeSigningCredentialRegistration',
        tags: ['crypto'],
        security: [{ sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        params: ParamsSchema,
        body: CompletePreviewSignCredentialRegistrationSchema,
        response: {
          201: Type.Ref(SigningCredentialSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ConflictProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const teamId = requireCurrentTeamId(request, 'signing credentials');
      try {
        const credential =
          await fastify.signingService.credentials.completeRegistration({
            actor: request.authContext!,
            teamId,
            registrationId: request.params.id,
            publicMaterial: request.body.publicMaterial,
            receipt: request.body.receipt,
          });
        return await reply
          .status(201)
          .send(await signingCredentialToResponse(credential, fastify));
      } catch (error) {
        throwSigningServiceProblem(error);
      }
    },
  );

  server.get(
    '/crypto/signing-credentials',
    {
      config: {
        auth: { credentialBindingScope: 'team' },
        rateLimit: fastify.rateLimitConfig.read,
      },
      schema: {
        operationId: 'listSigningCredentials',
        tags: ['crypto'],
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        querystring: Type.Object({
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          offset: Type.Optional(Type.Integer({ minimum: 0 })),
        }),
        response: {
          200: Type.Ref(SigningCredentialListSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const teamId = requireCurrentTeamId(request, 'signing credentials');
      try {
        const { items, total } = await fastify.signingService.credentials.list({
          actor: request.authContext!,
          teamId,
          limit: request.query.limit,
          offset: request.query.offset,
        });
        return {
          items: await signingCredentialsToResponse(items, fastify),
          total,
          limit: request.query.limit ?? 20,
          offset: request.query.offset ?? 0,
        };
      } catch (error) {
        throwSigningServiceProblem(error);
      }
    },
  );

  server.get(
    '/crypto/signing-credentials/:id',
    {
      config: {
        auth: { credentialBindingScope: 'team' },
        rateLimit: fastify.rateLimitConfig.read,
      },
      schema: {
        operationId: 'getSigningCredential',
        tags: ['crypto'],
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        params: ParamsSchema,
        response: {
          200: Type.Ref(SigningCredentialSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const teamId = requireCurrentTeamId(request, 'signing credentials');
      try {
        const credential = await fastify.signingService.credentials.get({
          actor: request.authContext!,
          teamId,
          credentialId: request.params.id,
        });
        return await signingCredentialToResponse(credential, fastify);
      } catch (error) {
        throwSigningServiceProblem(error);
      }
    },
  );

  for (const transition of CREDENTIAL_TRANSITIONS) {
    server.post(
      `/crypto/signing-credentials/:id/${transition.action}`,
      {
        config: {
          auth: { credentialBindingScope: 'team' },
          rateLimit: fastify.rateLimitConfig?.signing,
        },
        preValidation: (request, _reply, done) => {
          request.body ??= {};
          done();
        },
        schema: {
          operationId: transition.operationId,
          tags: ['crypto'],
          security: [
            { bearerAuth: [] },
            { sessionAuth: [] },
            { cookieAuth: [] },
          ],
          headers: TeamHeaderRequiredSchema,
          params: ParamsSchema,
          body: Type.Optional(
            Type.Object({
              reason: Type.Optional(Type.String({ maxLength: 1000 })),
            }),
          ),
          response: {
            200: Type.Ref(SigningCredentialSchema.$id),
            401: Type.Ref(ProblemDetailsSchema.$id),
            403: Type.Ref(ProblemDetailsSchema.$id),
            404: Type.Ref(ProblemDetailsSchema.$id),
            409: Type.Ref(ConflictProblemDetailsSchema.$id),
          },
        },
      },
      async (request) => {
        const teamId = requireCurrentTeamId(request, 'signing credentials');
        try {
          const { credential, fromStatus } =
            await fastify.signingService.credentials.transition({
              actor: request.authContext!,
              teamId,
              credentialId: request.params.id,
              action: transition.action,
              from: [...transition.from],
              to: transition.to,
              reason: request.body?.reason,
            });
          request.log.info(
            {
              credentialId: credential.id,
              teamId,
              actorIdentityId: request.authContext!.identityId,
              actorSubjectType: request.authContext!.subjectType,
              from: fromStatus,
              to: transition.to,
            },
            `crypto.signing_credential_${transition.action}`,
          );
          return await signingCredentialToResponse(credential, fastify);
        } catch (error) {
          throwSigningServiceProblem(error);
        }
      },
    );
  }
}
