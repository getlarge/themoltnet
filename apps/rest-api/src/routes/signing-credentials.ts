import { randomUUID } from 'node:crypto';

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth } from '@moltnet/auth';
import type { PrincipalIdentity, SigningCredential } from '@moltnet/database';
import {
  ProblemDetailsSchema,
  TeamHeaderRequiredSchema,
  VerificationMethodSchema,
} from '@moltnet/models';
import {
  assertNoPrivateSigningMaterial,
  prepareSigningClaim,
  SigningCredentialError,
  SigningWorkflowError,
  verifySigningReceipt,
} from '@moltnet/signing-workflows';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from 'typebox';

import { createProblem } from '../problems/index.js';
import {
  SigningCredentialListSchema,
  SigningCredentialRegistrationSchema,
  SigningCredentialSchema,
  SigningMethodValueSchema,
} from '../schemas.js';
import {
  batchInflateRowsWithCreator,
  inflateRowCreator,
} from '../utils/auth-principal.js';
import { requireCurrentTeamId } from '../utils/require-current-team-id.js';

const ParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

const VersionedJsonSchema = Type.Intersect([
  Type.Object({ version: Type.Integer({ minimum: 1 }) }),
  Type.Record(Type.String(), Type.Unknown()),
]);

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

function humanId(request: FastifyRequest): string {
  const auth = request.authContext;
  if (!auth || auth.subjectType !== 'human') {
    throw createProblem(
      'forbidden',
      'A human session is required for credential enrollment',
    );
  }
  return auth.humanId;
}

function subjectNamespace(request: FastifyRequest): KetoNamespace {
  return request.authContext?.subjectType === 'human'
    ? KetoNamespace.Human
    : KetoNamespace.Agent;
}

function mapSigningError(error: unknown): never {
  if (error instanceof SigningCredentialError) {
    const conflict =
      error.code === 'credential_lifecycle_conflict' ||
      error.code === 'credential_registration_invalid';
    throw createProblem(
      conflict ? 'conflict' : 'validation-failed',
      error.message,
    );
  }
  if (error instanceof SigningWorkflowError) {
    throw createProblem('validation-failed', error.message);
  }
  throw error;
}

async function requireCredentialManager(
  request: FastifyRequest,
  teamId: string,
): Promise<void> {
  const auth = request.authContext!;
  const allowed =
    await request.server.permissionChecker.canManageTeamCredentials(
      teamId,
      auth.identityId,
      subjectNamespace(request),
    );
  if (!allowed) {
    throw createProblem(
      'forbidden',
      'Team credential management permission is required',
    );
  }
}

export async function signingCredentialRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);

  server.post(
    '/crypto/signing-credentials/registrations',
    {
      config: {
        auth: { credentialBindingScope: 'team' },
        rateLimit: fastify.rateLimitConfig?.signing,
      },
      schema: {
        operationId: 'beginSigningCredentialRegistration',
        tags: ['crypto'],
        security: [{ sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        body: Type.Object({
          verificationMethod: VerificationMethodSchema,
          credentialType: Type.String({ minLength: 1, maxLength: 100 }),
          algorithm: Type.String({ minLength: 1, maxLength: 100 }),
          label: Type.String({ minLength: 1, maxLength: 255 }),
        }),
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
      const ownerHumanId = humanId(request);
      const teamId = requireCurrentTeamId(request, 'signing credentials');
      const canAccess = await fastify.permissionChecker.canAccessTeam(
        teamId,
        request.authContext!.identityId,
        KetoNamespace.Human,
      );
      if (!canAccess)
        throw createProblem('forbidden', 'Team access is required');

      const id = randomUUID();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      try {
        const prepared = await prepareSigningClaim({
          verificationMethod: request.body.verificationMethod,
          requestId: id,
          credentialId: id,
          signingPayload: JSON.stringify({
            ceremony: 'signing-credential-registration',
            id,
            teamId,
          }),
        });
        const challenge = {
          verificationMethod: request.body.verificationMethod,
          value: prepared.challenge,
        };
        await fastify.signingCredentialRepository.createRegistration({
          id,
          ownerHumanId,
          teamId,
          verificationMethod: request.body.verificationMethod,
          credentialType: request.body.credentialType,
          algorithm: request.body.algorithm,
          label: request.body.label,
          challenge,
          methodState: {
            verificationMethod: request.body.verificationMethod,
            value: prepared.verifierState,
          },
          expiresAt,
        });
        return await reply.status(201).send({ id, challenge, expiresAt });
      } catch (error) {
        mapSigningError(error);
      }
    },
  );

  server.post(
    '/crypto/signing-credentials/registrations/:id/complete',
    {
      config: { auth: { credentialBindingScope: 'team' } },
      schema: {
        operationId: 'completeSigningCredentialRegistration',
        tags: ['crypto'],
        security: [{ sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        params: ParamsSchema,
        body: Type.Object({
          publicMaterial: VersionedJsonSchema,
          receipt: SigningMethodValueSchema,
        }),
        response: {
          201: Type.Ref(SigningCredentialSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const ownerHumanId = humanId(request);
      const teamId = requireCurrentTeamId(request, 'signing credentials');
      try {
        assertNoPrivateSigningMaterial(request.body.publicMaterial);
        const registration =
          await fastify.signingCredentialRepository.findRegistrationById(
            request.params.id,
          );
        if (
          !registration ||
          registration.ownerHumanId !== ownerHumanId ||
          registration.teamId !== teamId ||
          registration.consumedAt ||
          registration.expiresAt <= new Date()
        ) {
          throw new SigningCredentialError(
            'credential_registration_invalid',
            'Credential registration is missing, expired, or already consumed',
          );
        }
        const receiptValue =
          request.body.receipt.value &&
          typeof request.body.receipt.value === 'object'
            ? request.body.receipt.value
            : { value: request.body.receipt.value };
        const evidence = await verifySigningReceipt({
          verificationMethod: registration.verificationMethod,
          requestId: registration.id,
          credentialId: registration.id,
          signingPayload: JSON.stringify({
            ceremony: 'signing-credential-registration',
            id: registration.id,
            teamId,
          }),
          verifierState: registration.methodState.value as never,
          receipt: {
            verificationMethod: request.body.receipt.verificationMethod,
            ...receiptValue,
          },
        });
        const credential = await fastify.transactionRunner.runInTransaction(
          async () => {
            const consumed =
              await fastify.signingCredentialRepository.consumeRegistration(
                registration.id,
                ownerHumanId,
              );
            if (!consumed) {
              throw new SigningCredentialError(
                'credential_registration_invalid',
                'Credential registration was already consumed',
              );
            }
            return fastify.signingCredentialRepository.create({
              owner: { kind: 'human', id: ownerHumanId },
              teamId,
              verificationMethod: registration.verificationMethod,
              credentialType: registration.credentialType,
              algorithm: registration.algorithm,
              publicMaterial: request.body.publicMaterial,
              enrollmentEvidence: {
                version: 1,
                evidence,
              },
              label: registration.label,
              status: 'pending_approval',
            });
          },
          { name: 'complete-signing-credential-registration' },
        );
        return await reply
          .status(201)
          .send(await signingCredentialToResponse(credential, fastify));
      } catch (error) {
        mapSigningError(error);
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
      const auth = request.authContext!;
      const manager = await fastify.permissionChecker.canManageTeamCredentials(
        teamId,
        auth.identityId,
        subjectNamespace(request),
      );
      let ownerHumanId: string | undefined;
      if (!manager) {
        if (auth.subjectType !== 'human') {
          throw createProblem('forbidden');
        }
        ownerHumanId = auth.humanId;
      }
      const { items, total } = await fastify.signingCredentialRepository.list({
        teamId,
        ownerHumanId,
        limit: request.query.limit,
        offset: request.query.offset,
      });
      return {
        items: await signingCredentialsToResponse(items, fastify),
        total,
        limit: request.query.limit ?? 20,
        offset: request.query.offset ?? 0,
      };
    },
  );

  for (const transition of [
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
  ]) {
    server.post(
      `/crypto/signing-credentials/:id/${transition.action}`,
      {
        config: { auth: { credentialBindingScope: 'team' } },
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
          response: {
            200: Type.Ref(SigningCredentialSchema.$id),
            401: Type.Ref(ProblemDetailsSchema.$id),
            403: Type.Ref(ProblemDetailsSchema.$id),
            404: Type.Ref(ProblemDetailsSchema.$id),
            409: Type.Ref(ProblemDetailsSchema.$id),
          },
        },
      },
      async (request) => {
        const teamId = requireCurrentTeamId(request, 'signing credentials');
        await requireCredentialManager(request, teamId);
        const credential = await fastify.signingCredentialRepository.transition(
          {
            id: request.params.id,
            teamId,
            from: [...transition.from],
            to: transition.to,
            approvedByHumanId:
              transition.to === 'active' &&
              request.authContext!.subjectType === 'human'
                ? request.authContext!.humanId
                : undefined,
          },
        );
        if (!credential) {
          throw createProblem(
            'conflict',
            `Credential cannot transition to ${transition.to}`,
          );
        }
        return signingCredentialToResponse(credential, fastify);
      },
    );
  }
}
