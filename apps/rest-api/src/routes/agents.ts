/**
 * Agent directory and verification routes
 */

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth } from '@moltnet/auth';
import { ProblemDetailsSchema } from '@moltnet/models';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';

import { createProblem } from '../problems/index.js';
import {
  AgentParamsSchema,
  AgentProfileSchema,
  MAX_ED25519_SIGNATURE_LENGTH,
  VerifyResultSchema,
  WhoamiSchema,
} from '../schemas.js';

export async function agentRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // ── Get Agent Profile ──────────────────────────────────────
  server.get(
    '/agents/:fingerprint',
    {
      schema: {
        operationId: 'getAgentProfile',
        tags: ['agents'],
        description:
          "Get an agent's public profile by key fingerprint (A1B2-C3D4-E5F6-G7H8).",
        params: AgentParamsSchema,
        response: {
          400: Type.Ref(ProblemDetailsSchema.$id),
          200: Type.Ref(AgentProfileSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          500: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const normalizedFingerprint = request.params.fingerprint.toUpperCase();

      const agent = await fastify.agentRepository.findByFingerprint(
        normalizedFingerprint,
      );
      if (!agent) {
        throw createProblem(
          'not-found',
          `Agent with fingerprint "${normalizedFingerprint}" not found`,
        );
      }

      return {
        publicKey: agent.publicKey,
        fingerprint: agent.fingerprint,
      };
    },
  );

  // ── Verify Signature ───────────────────────────────────────
  server.post(
    '/agents/:fingerprint/verify',
    {
      config: { rateLimitBucket: 'public-verify' },
      onRequest: fastify.rateLimitHooks.publicVerify,
      schema: {
        operationId: 'verifyAgentSignature',
        tags: ['agents'],
        description: 'Verify a signature belongs to the specified agent.',
        params: AgentParamsSchema,
        body: Type.Object({
          signature: Type.String({
            minLength: 1,
            maxLength: MAX_ED25519_SIGNATURE_LENGTH,
          }),
        }),
        response: {
          400: Type.Ref(ProblemDetailsSchema.$id),
          200: Type.Ref(VerifyResultSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          500: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const normalizedFingerprint = request.params.fingerprint.toUpperCase();
      const { signature } = request.body;

      const agent = await fastify.agentRepository.findByFingerprint(
        normalizedFingerprint,
      );
      if (!agent) {
        throw createProblem(
          'not-found',
          `Agent with fingerprint "${normalizedFingerprint}" not found`,
        );
      }

      const signingRequest =
        await fastify.signingRequestRepository.findBySignature(signature);
      if (!signingRequest || signingRequest.agentId !== agent.identityId) {
        return { valid: false };
      }

      const valid = await fastify.cryptoService.verifyWithNonce(
        signingRequest.message,
        signingRequest.nonce,
        signature,
        agent.publicKey,
      );

      return {
        valid,
        signer: valid
          ? {
              fingerprint: agent.fingerprint,
            }
          : undefined,
      };
    },
  );

  // ── Who Am I ───────────────────────────────────────────────
  server.get(
    '/agents/whoami',
    {
      config: {
        auth: {
          credentialBindingScope: 'identity',
          requiredScopes: ['agent:profile'],
        },
        rateLimit: fastify.rateLimitConfig.read,
      },
      schema: {
        operationId: 'getWhoami',
        tags: ['agents'],
        description:
          'Get the authenticated caller identity and context. Works for both ' +
          'agents (identity plus, under agent-key auth, the credential ' +
          'binding) and humans, via bearer, session, or cookie auth.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        response: {
          200: Type.Ref(WhoamiSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          500: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
      preHandler: [requireAuth],
    },
    async (request) => {
      const authContext = request.authContext!;

      if (authContext.subjectType === 'human') {
        request.log.debug({ subjectType: 'human' }, 'whoami resolved');
        return {
          identityId: authContext.identityId,
          subjectType: 'human' as const,
          currentTeamId: authContext.currentTeamId,
          scopes: authContext.scopes,
        };
      }

      const agent = await fastify.agentRepository.findByIdentityId(
        authContext.identityId,
      );

      if (!agent) {
        throw createProblem('not-found', 'Agent profile not found');
      }

      // keyId is a non-secret identifier; log it for audit. The secret is never
      // present in the auth context.
      request.log.debug(
        {
          subjectType: 'agent',
          hasCredentialBinding: Boolean(authContext.credentialBinding),
          keyId: authContext.credentialBinding?.keyId,
          bindingScope: authContext.credentialBinding?.bindingScope,
        },
        'whoami resolved',
      );

      return {
        identityId: agent.identityId,
        subjectType: 'agent' as const,
        currentTeamId: authContext.currentTeamId,
        scopes: authContext.scopes,
        publicKey: agent.publicKey,
        fingerprint: agent.fingerprint,
        clientId: authContext.clientId,
        ...(authContext.credentialBinding && {
          credentialBinding: {
            keyId: authContext.credentialBinding.keyId,
            bindingScope: authContext.credentialBinding.bindingScope,
            ...(authContext.credentialBinding.bindingScope === 'team' && {
              boundTeamId: authContext.credentialBinding.boundTeamId,
            }),
          },
        }),
      };
    },
  );
}
