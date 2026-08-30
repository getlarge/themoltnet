/**
 * Cryptographic challenge-based recovery routes
 *
 * Allows agents to recover their Ory Kratos session by proving
 * ownership of their Ed25519 private key.
 *
 * POST /recovery/challenge — generate HMAC-signed challenge
 * POST /recovery/verify    — verify signature, return Kratos recovery code
 * POST /recovery/credentials — verify signature, replace OAuth2 credentials
 */

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { OryClients } from '@moltnet/auth';
import {
  generateRecoveryChallenge,
  type RecoveryPurpose,
  sealForEd25519PublicKey,
  signChallenge,
  verifyChallenge,
} from '@moltnet/crypto-service';
import type { Agent, NonceRepository } from '@moltnet/database';
import { ProblemDetailsSchema } from '@moltnet/models';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';

import { createProblem } from '../problems/index.js';
import {
  RecoveryChallengeRequestSchema,
  RecoveryChallengeResponseSchema,
  RecoveryCredentialsResponseSchema,
  RecoveryProofSchema,
  RecoveryVerifyResponseSchema,
} from '../schemas.js';
import { agentOAuth2ClientId } from '../utils/agent-oauth-client-id.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RecoveryChallengeBodySchema = {
  type: 'object',
  allOf: [Type.Ref(RecoveryChallengeRequestSchema.$id)],
  required: ['publicKey', 'purpose'],
} as unknown as typeof RecoveryChallengeRequestSchema;
const RecoveryProofBodySchema = {
  type: 'object',
  allOf: [Type.Ref(RecoveryProofSchema.$id)],
  required: ['challenge', 'hmac', 'signature', 'publicKey'],
} as unknown as typeof RecoveryProofSchema;

export interface RecoveryRouteOptions {
  recoverySecret: string;
  identityClient: OryClients['identity'];
  nonceRepository: NonceRepository;
}

function upstreamStatus(error: unknown): number | undefined {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('response' in error) ||
    typeof error.response !== 'object' ||
    error.response === null ||
    !('status' in error.response) ||
    typeof error.response.status !== 'number'
  ) {
    return undefined;
  }
  return error.response.status;
}

export async function recoveryRoutes(
  fastify: FastifyInstance,
  options: RecoveryRouteOptions,
) {
  const { recoverySecret, identityClient, nonceRepository } = options;
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();

  const verifyRecoveryProof = async (
    request: {
      body: {
        challenge: string;
        hmac: string;
        signature: string;
        publicKey: string;
      };
      id: string;
      ip: string;
    },
    purpose: RecoveryPurpose,
  ): Promise<Agent> => {
    const { challenge, hmac, signature, publicKey } = request.body;
    const hmacResult = verifyChallenge(
      challenge,
      hmac,
      recoverySecret,
      CHALLENGE_TTL_MS,
      publicKey,
      purpose,
    );
    if (!hmacResult.valid) {
      fastify.log.warn(
        { requestId: request.id, ip: request.ip, publicKey },
        'Recovery challenge HMAC verification failed',
      );
      throw createProblem('invalid-challenge', hmacResult.reason);
    }

    const parts = challenge.split(':');
    const nonce = parts[5];
    const challengeExpiresAt = new Date(
      parseInt(parts[6], 10) + CHALLENGE_TTL_MS,
    );
    const fresh = await nonceRepository.consume(nonce, challengeExpiresAt);
    if (!fresh) {
      fastify.log.warn(
        { requestId: request.id, ip: request.ip, publicKey },
        'Recovery nonce replay attempt',
      );
      throw createProblem('invalid-challenge', 'Challenge already used');
    }

    // Always perform both operations so an unknown key and a bad signature
    // follow the same externally observable verification path.
    const [agent, signatureValid] = await Promise.all([
      fastify.agentRepository.findByPublicKey(publicKey),
      fastify.cryptoService.verify(challenge, signature, publicKey),
    ]);
    if (!agent || !signatureValid) {
      fastify.log.warn(
        {
          requestId: request.id,
          ip: request.ip,
          fingerprint: agent?.fingerprint,
        },
        'Recovery signature verification failed',
      );
      throw createProblem(
        'invalid-signature',
        'Ed25519 signature verification failed',
      );
    }

    return agent;
  };

  // ── Request Challenge ──────────────────────────────────────
  server.post(
    '/recovery/challenge',
    {
      config: {
        rateLimit: fastify.rateLimitConfig?.recovery,
      },
      schema: {
        operationId: 'requestRecoveryChallenge',
        tags: ['recovery'],
        description:
          'Generate a recovery challenge for an agent to sign with their Ed25519 private key.',
        body: RecoveryChallengeBodySchema,
        response: {
          200: Type.Ref(RecoveryChallengeResponseSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          500: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { publicKey, purpose } = request.body;

      // Always generate a challenge regardless of whether the key exists
      // to prevent public key enumeration. Invalid keys will fail at /verify.
      const challenge = generateRecoveryChallenge(publicKey, purpose);
      const hmac = signChallenge(challenge, recoverySecret);

      const agent = await fastify.agentRepository.findByPublicKey(publicKey);
      if (agent) {
        fastify.log.info(
          { fingerprint: agent.fingerprint },
          'Recovery challenge issued',
        );
      }

      return { challenge, hmac };
    },
  );

  // ── Verify Signed Challenge ────────────────────────────────
  server.post(
    '/recovery/verify',
    {
      config: {
        rateLimit: fastify.rateLimitConfig?.recovery,
      },
      schema: {
        operationId: 'verifyRecoveryChallenge',
        tags: ['recovery'],
        description:
          'Verify a signed recovery challenge and return a Kratos recovery code.',
        body: RecoveryProofBodySchema,
        response: {
          200: Type.Ref(RecoveryVerifyResponseSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          500: Type.Ref(ProblemDetailsSchema.$id),
          502: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const agent = await verifyRecoveryProof(request, 'identity');

      // Call Kratos Admin API to create the recovery code.
      try {
        const data = await identityClient.createRecoveryCodeForIdentity({
          createRecoveryCodeForIdentityBody: {
            identity_id: agent.identityId,
            flow_type: 'api',
          },
        });

        fastify.log.info(
          { fingerprint: agent.fingerprint },
          'Recovery code issued via Kratos Admin API',
        );

        return {
          recoveryCode: data.recovery_code,
          recoveryFlowUrl: data.recovery_link,
        };
      } catch (err) {
        fastify.log.error(
          { err, fingerprint: agent.fingerprint },
          'Kratos Admin API recovery failed',
        );
        throw createProblem(
          'upstream-error',
          'Failed to create recovery code via identity provider',
        );
      }
    },
  );

  server.post(
    '/recovery/credentials',
    {
      config: {
        rateLimit: fastify.rateLimitConfig?.recovery,
      },
      schema: {
        operationId: 'recoverAgentCredentials',
        tags: ['recovery'],
        description:
          'Replace an agent OAuth2 client secret after proving possession of its Ed25519 identity key. The replacement credentials are sealed to that key.',
        body: RecoveryProofBodySchema,
        response: {
          200: Type.Ref(RecoveryCredentialsResponseSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          500: Type.Ref(ProblemDetailsSchema.$id),
          502: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const agent = await verifyRecoveryProof(request, 'credentials');
      const clientId = agentOAuth2ClientId(agent.identityId);

      let existingClient;
      try {
        existingClient = await fastify.oauth2Client.getOAuth2Client({
          id: clientId,
        });
      } catch (err) {
        if (upstreamStatus(err) === 404) {
          fastify.log.warn(
            {
              fingerprint: agent.fingerprint,
              identityId: agent.identityId,
              clientId,
              requestId: request.id,
              ip: request.ip,
              rotated: false,
            },
            'OAuth2 credential recovery client not found',
          );
          throw createProblem(
            'not-found',
            'No OAuth2 client exists for this agent',
          );
        }
        fastify.log.error(
          {
            err,
            fingerprint: agent.fingerprint,
            identityId: agent.identityId,
            clientId,
            requestId: request.id,
            ip: request.ip,
            rotated: false,
          },
          'OAuth2 credential recovery lookup failed',
        );
        throw createProblem('upstream-error', 'Failed to fetch OAuth2 client');
      }

      const clientSecret = crypto.randomUUID();
      let sealedClientSecret: string;
      try {
        // Validate and prepare delivery before the irreversible Hydra write.
        sealedClientSecret = sealForEd25519PublicKey(
          clientSecret,
          agent.publicKey,
        );
      } catch (err) {
        fastify.log.error(
          {
            err,
            fingerprint: agent.fingerprint,
            identityId: agent.identityId,
            clientId,
            requestId: request.id,
            ip: request.ip,
            rotated: false,
          },
          'OAuth2 credential recovery sealing failed',
        );
        throw createProblem(
          'internal-server-error',
          'Failed to prepare replacement credentials',
        );
      }

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
            client_secret: clientSecret,
          },
        });
      } catch (err) {
        fastify.log.error(
          {
            err,
            fingerprint: agent.fingerprint,
            identityId: agent.identityId,
            clientId,
            requestId: request.id,
            ip: request.ip,
            rotated: false,
          },
          'OAuth2 credential recovery mutation failed',
        );
        throw createProblem(
          'upstream-error',
          'Failed to replace OAuth2 credentials',
        );
      }

      try {
        fastify.tokenValidator.evictOAuthClient(clientId);
      } catch (err) {
        fastify.log.warn(
          { err, clientId, requestId: request.id, rotated: true },
          'OAuth2 credential recovery validator eviction failed',
        );
      }
      try {
        await fastify.invalidateOAuth2ClientCache(clientId);
      } catch (err) {
        fastify.log.warn(
          { err, clientId, requestId: request.id, rotated: true },
          'OAuth2 credential recovery grant-cache invalidation failed',
        );
      }

      fastify.log.warn(
        {
          fingerprint: agent.fingerprint,
          identityId: agent.identityId,
          clientId,
          requestId: request.id,
          ip: request.ip,
          rotated: true,
        },
        'OAuth2 credentials recovered via Ed25519 proof',
      );
      return { clientId, sealedClientSecret };
    },
  );
}
