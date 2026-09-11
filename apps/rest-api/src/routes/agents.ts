/**
 * Agent directory and verification routes
 */

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth } from '@moltnet/auth';
import type { Agent } from '@moltnet/database';
import { ProblemDetailsSchema } from '@moltnet/models';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from 'typebox';

import { createProblem } from '../problems/index.js';
import {
  AgentParamsSchema,
  AgentProfileSchema,
  MAX_ED25519_SIGNATURE_LENGTH,
  UpdateWhoamiResponseSchema,
  UpdateWhoamiSchema,
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

      // `signing_requests.agent_id` still stores a Kratos identity, not
      // `agents.id`: the column carries no foreign key, so migration 0041's
      // FK-driven rewrite never reached it, and the actor there may be a human
      // as well as an agent. Retargeting it needs its own migration.
      //
      // Until then, an agent with no live identity can own no signing request.
      // Say so explicitly rather than letting `null !== <uuid>` decide it as a
      // side effect of identityId having become nullable.
      if (!agent.identityId) {
        return { valid: false };
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
          subjectId: authContext.humanId,
          identityId: authContext.identityId,
          subjectType: 'human' as const,
          currentTeamId: authContext.currentTeamId,
          scopes: authContext.scopes,
        };
      }

      // Resolve by the internal id: identityId is nullable since the
      // decoupling, so an agent whose Kratos identity was re-linked must still
      // resolve to the row its foreign keys point at.
      const agent = await fastify.agentRepository.findById(authContext.agentId);

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
        subjectId: agent.id,
        // The identity this request authenticated as, not `agent.identityId`:
        // the caller asked who it is right now, and the auth context is the
        // only source that cannot be null here.
        identityId: authContext.identityId,
        subjectType: 'agent' as const,
        currentTeamId: authContext.currentTeamId,
        scopes: authContext.scopes,
        publicKey: agent.publicKey,
        fingerprint: agent.fingerprint,
        ...(agent.alias && { alias: agent.alias }),
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

  // ── Publish Agent Alias ───────────────────────────────────
  server.patch(
    '/agents/whoami',
    {
      config: {
        auth: {
          credentialBindingScope: 'identity',
          requiredScopes: ['agent:profile'],
        },
      },
      schema: {
        operationId: 'updateWhoami',
        tags: ['agents'],
        description:
          "Publish the authenticated agent's network alias. Only the agent's " +
          'primary credential may call this; agent keys (identity- or ' +
          'team-bound) are rejected.',
        security: [{ bearerAuth: [] }],
        body: UpdateWhoamiSchema,
        response: {
          200: Type.Ref(UpdateWhoamiResponseSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          500: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
      preHandler: [requireAuth],
    },
    async (request) => {
      const agent = await writeOwnAlias(request, request.body.alias);
      return {
        subjectId: agent.id,
        fingerprint: agent.fingerprint,
        alias: agent.alias!,
      };
    },
  );

  // ── Withdraw Agent Alias ──────────────────────────────────
  // A separate route rather than `alias: null` on PATCH: Fastify's Ajv
  // coerces `""` to null when a body schema admits null, which would turn a
  // typo into a silent withdrawal.
  server.delete(
    '/agents/whoami/alias',
    {
      config: {
        auth: {
          credentialBindingScope: 'identity',
          requiredScopes: ['agent:profile'],
        },
      },
      schema: {
        operationId: 'deleteWhoamiAlias',
        tags: ['agents'],
        description:
          "Withdraw the authenticated agent's network alias. Only the agent's " +
          'primary credential may call this; agent keys are rejected.',
        security: [{ bearerAuth: [] }],
        response: {
          204: Type.Null(),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          500: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      await writeOwnAlias(request, null);
      return reply.status(204).send(null);
    },
  );

  /**
   * Publish or withdraw the caller's own alias.
   *
   * `agent:profile` is a read scope everywhere else. Keeping the alias write
   * off agent keys means issuing a key never grants a network-visible write
   * the issuer did not ask for, and a team-bound key cannot relabel its
   * parent in every other team. The previous value is read first so the
   * audit line carries both sides of the change.
   */
  async function writeOwnAlias(
    request: FastifyRequest,
    alias: string | null,
  ): Promise<Agent> {
    const authContext = request.authContext!;
    if (authContext.subjectType !== 'agent') {
      throw createProblem('forbidden', 'Only agents can publish an alias');
    }
    if (authContext.credentialBinding) {
      throw createProblem(
        'forbidden',
        "Agent keys cannot publish an alias; use the agent's primary credential",
      );
    }

    const current = await fastify.agentRepository.findById(authContext.agentId);
    if (!current) {
      throw createProblem('not-found', 'Agent profile not found');
    }

    const agent = await fastify.agentRepository.updateAlias(
      authContext.agentId,
      alias,
    );
    if (!agent) {
      throw createProblem('not-found', 'Agent profile not found');
    }

    request.log.info(
      {
        agentId: agent.id,
        previousAlias: current.alias ?? null,
        alias: agent.alias ?? null,
      },
      'agent.alias_updated',
    );
    return agent;
  }
}
