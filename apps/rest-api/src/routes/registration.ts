/**
 * Agent registration + credential management.
 *
 * POST /auth/register      — self-register with proof of key possession
 * POST /auth/enroll        — join a team with an enrollment token
 * POST /auth/rotate-secret — rotate OAuth2 client secret (authenticated)
 */

import { createHash } from 'node:crypto';

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth } from '@moltnet/auth';
import { DBOS } from '@moltnet/database';
import {
  buildSelfRegistrationMessage,
  buildTeamRegistrationMessage,
  ProblemDetailsSchema,
} from '@moltnet/models';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';

import { createProblem } from '../problems/index.js';
import {
  RegisterResponseSchema,
  RegistrationCredentialTypeSchema,
  RotateSecretResponseSchema,
} from '../schemas.js';
import { verifyRegistrationProof } from '../utils/registration-proof.js';
import {
  EnrollmentValidationError,
  issueRegistrationCredential,
  type RegistrationInput,
  registrationInputsEqual,
  registrationWorkflow,
  RegistrationWorkflowError,
} from '../workflows/index.js';

class IdempotencyKeyConflictError extends Error {}

const IdempotencyHeadersSchema = Type.Object({
  'idempotency-key': Type.String({
    pattern: '^[A-Za-z0-9_-]{43}$',
    description:
      'A random 32-byte base64url nonce. Reuse it only when retrying this exact request.',
  }),
});

const RegistrationIdentitySchema = Type.Object({
  publicKey: Type.String({
    minLength: 10,
    maxLength: 256,
    description:
      'Ed25519 public key in "ed25519:<base64>" format (32-byte raw key)',
  }),
  proof: Type.String({
    minLength: 1,
    maxLength: 256,
    description: 'Base64-encoded Ed25519 signature of the registration message',
  }),
  credentialType: RegistrationCredentialTypeSchema,
});

const EnrollBodySchema = Type.Intersect([
  RegistrationIdentitySchema,
  Type.Object({
    token: Type.String({
      pattern: '^mlt_inv_[A-Za-z0-9_-]{22}$',
      description: 'Team invite code, usable by people and managed agents',
    }),
  }),
]);

function registrationWorkflowId(
  route: 'self' | 'team',
  idempotencyKey: string,
): string {
  const nonceHash = createHash('sha256').update(idempotencyKey).digest('hex');
  return `registration-${route}-${nonceHash}`;
}

export async function registrationRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();

  const runRegistration = async (
    input: RegistrationInput,
    route: 'self' | 'team',
  ) => {
    try {
      const handle = await DBOS.startWorkflow(
        registrationWorkflow.registerAgent,
        {
          workflowID: registrationWorkflowId(route, input.idempotencyKey),
        },
      )(input);
      const [recordedInput] =
        await handle.getWorkflowInputs<[RegistrationInput]>();
      if (!recordedInput || !registrationInputsEqual(recordedInput, input)) {
        throw new IdempotencyKeyConflictError(
          'Idempotency-Key was already used for a different registration request',
        );
      }
      return await issueRegistrationCredential(await handle.getResult());
    } catch (error: unknown) {
      if (error instanceof IdempotencyKeyConflictError) {
        throw createProblem('conflict', error.message);
      }
      if (error instanceof EnrollmentValidationError) {
        throw createProblem('registration-failed', error.message);
      }
      if (error instanceof RegistrationWorkflowError) {
        throw createProblem('upstream-error', error.message);
      }
      const message = error instanceof Error ? error.message : String(error);
      fastify.log.error({ error }, 'Registration workflow failed');
      throw createProblem('upstream-error', message);
    }
  };

  server.post(
    '/auth/register',
    {
      config: { rateLimit: fastify.rateLimitConfig?.registration },
      schema: {
        operationId: 'registerAgent',
        tags: ['auth'],
        description:
          'Self-register using an Ed25519 proof of key possession. Creates a personal team and private diary, then returns exactly one selected credential.',
        headers: IdempotencyHeadersSchema,
        body: RegistrationIdentitySchema,
        response: {
          200: Type.Ref(RegisterResponseSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          500: Type.Ref(ProblemDetailsSchema.$id),
          502: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { publicKey, proof, credentialType } = request.body;
      const idempotencyKey = request.headers['idempotency-key'];
      const fingerprint = await verifyRegistrationProof(fastify.cryptoService, {
        message: buildSelfRegistrationMessage({
          idempotencyKey,
          publicKey,
          credentialType,
        }),
        proof,
        publicKey,
      });
      return runRegistration(
        {
          publicKey,
          fingerprint,
          credentialType,
          idempotencyKey,
          mode: { type: 'self' },
        },
        'self',
      );
    },
  );

  server.post(
    '/auth/enroll',
    {
      config: { rateLimit: fastify.rateLimitConfig?.registration },
      schema: {
        operationId: 'enrollAgent',
        tags: ['auth'],
        description:
          'Redeem a team invite using an Ed25519 proof of key possession. Grants a managed agent membership in the issuing team and returns exactly one selected credential.',
        headers: IdempotencyHeadersSchema,
        body: EnrollBodySchema,
        response: {
          200: Type.Ref(RegisterResponseSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          500: Type.Ref(ProblemDetailsSchema.$id),
          502: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { token, publicKey, proof, credentialType } = request.body;
      const idempotencyKey = request.headers['idempotency-key'];
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const invite = await fastify.teamRepository.findInviteByCode(token);
      if (!invite) {
        throw createProblem(
          'registration-failed',
          'Invite is invalid or expired',
        );
      }
      const fingerprint = await verifyRegistrationProof(fastify.cryptoService, {
        message: buildTeamRegistrationMessage({
          enrollmentTokenHash: tokenHash,
          idempotencyKey,
          publicKey,
          credentialType,
        }),
        proof,
        publicKey,
      });
      return runRegistration(
        {
          publicKey,
          fingerprint,
          credentialType,
          idempotencyKey,
          mode: {
            type: 'team_invite',
            inviteId: invite.id,
            inviteCodeHash: tokenHash,
          },
        },
        'team',
      );
    },
  );

  server.post(
    '/auth/rotate-secret',
    {
      config: {
        auth: {
          credentialBindingScope: 'identity',
          requiredScopes: ['key:manage'],
        },
      },
      schema: {
        operationId: 'rotateClientSecret',
        tags: ['auth'],
        description:
          'Rotate the OAuth2 client secret. Returns the new clientId/clientSecret pair. The old secret is invalidated immediately.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        response: {
          400: Type.Ref(ProblemDetailsSchema.$id),
          200: Type.Ref(RotateSecretResponseSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          500: Type.Ref(ProblemDetailsSchema.$id),
          502: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
      preHandler: [requireAuth],
    },
    async (request) => {
      const authContext = request.authContext!;
      if (authContext.subjectType !== 'agent') {
        throw createProblem(
          'forbidden',
          'Only agents can rotate client secrets',
        );
      }
      const { clientId } = authContext;

      let existingClient;
      try {
        existingClient = await fastify.oauth2Client.getOAuth2Client({
          id: clientId,
        });
      } catch (err: unknown) {
        fastify.log.error({ err }, 'Failed to fetch OAuth2 client');
        throw createProblem('upstream-error', 'Failed to fetch OAuth2 client');
      }

      const newSecret = crypto.randomUUID();
      try {
        await fastify.oauth2Client.setOAuth2Client({
          id: clientId,
          oAuth2Client: {
            client_name: existingClient.client_name,
            grant_types: existingClient.grant_types,
            response_types: existingClient.response_types,
            token_endpoint_auth_method:
              existingClient.token_endpoint_auth_method,
            scope: existingClient.scope,
            metadata: existingClient.metadata,
            client_secret: newSecret,
          },
        });
        fastify.tokenValidator.evictOAuthClient(clientId);
        await fastify.invalidateOAuth2ClientCache(clientId);

        return { clientId, clientSecret: newSecret };
      } catch (err: unknown) {
        fastify.log.error({ err }, 'Failed to rotate client secret');
        throw createProblem('upstream-error', 'Failed to rotate client secret');
      }
    },
  );
}
