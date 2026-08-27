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
  MAX_CHALLENGE_LENGTH,
  MAX_ED25519_SIGNATURE_LENGTH,
  MAX_PUBLIC_KEY_LENGTH,
  RecoveryChallengeResponseSchema,
  RecoveryCredentialsResponseSchema,
  RecoveryVerifyResponseSchema,
} from '../schemas.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface RecoveryRouteOptions {
  recoverySecret: string;
  identityClient: OryClients['identity'];
  nonceRepository: NonceRepository;
}

export async function recoveryRoutes(
  fastify: FastifyInstance,
  options: RecoveryRouteOptions,
) {
  const { recoverySecret, identityClient, nonceRepository } = options;
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();

  const RecoveryProofSchema = Type.Object({
    challenge: Type.String({
      minLength: 1,
      maxLength: MAX_CHALLENGE_LENGTH,
    }),
    hmac: Type.String({
      pattern: '^[a-f0-9]{64}$',
      description: 'Hex-encoded HMAC-SHA256',
    }),
    signature: Type.String({
      minLength: 1,
      maxLength: MAX_ED25519_SIGNATURE_LENGTH,
      description: 'Base64-encoded Ed25519 signature of the challenge',
    }),
    publicKey: Type.String({
      pattern: '^ed25519:[A-Za-z0-9+/=]+$',
      maxLength: MAX_PUBLIC_KEY_LENGTH,
      description: 'Ed25519 public key with prefix',
    }),
  });

  const verifyRecoveryProof = async (request: {
    body: {
      challenge: string;
      hmac: string;
      signature: string;
      publicKey: string;
    };
    id: string;
    ip: string;
  }): Promise<Agent> => {
    const { challenge, hmac, signature, publicKey } = request.body;
    const hmacResult = verifyChallenge(
      challenge,
      hmac,
      recoverySecret,
      CHALLENGE_TTL_MS,
      publicKey,
    );
    if (!hmacResult.valid) {
      fastify.log.warn(
        { requestId: request.id, ip: request.ip, publicKey },
        'Recovery challenge HMAC verification failed',
      );
      throw createProblem('invalid-challenge', hmacResult.reason);
    }

    const parts = challenge.split(':');
    const nonce = parts[4];
    const challengeExpiresAt = new Date(
      parseInt(parts[5], 10) + CHALLENGE_TTL_MS,
    );
    const fresh = await nonceRepository.consume(nonce, challengeExpiresAt);
    if (!fresh) {
      fastify.log.warn(
        { requestId: request.id, ip: request.ip, publicKey },
        'Recovery nonce replay attempt',
      );
      throw createProblem('invalid-challenge', 'Challenge already used');
    }

    const agent = await fastify.agentRepository.findByPublicKey(publicKey);
    if (!agent) {
      fastify.log.warn(
        { requestId: request.id, ip: request.ip, publicKey },
        'Recovery verify for unknown public key',
      );
      throw createProblem(
        'invalid-signature',
        'Ed25519 signature verification failed',
      );
    }

    const signatureValid = await fastify.cryptoService.verify(
      challenge,
      signature,
      publicKey,
    );
    if (!signatureValid) {
      fastify.log.warn(
        {
          requestId: request.id,
          ip: request.ip,
          fingerprint: agent.fingerprint,
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
        body: Type.Object({
          publicKey: Type.String({
            pattern: '^ed25519:[A-Za-z0-9+/=]+$',
            maxLength: MAX_PUBLIC_KEY_LENGTH,
            description: 'Ed25519 public key with prefix',
          }),
        }),
        response: {
          200: Type.Ref(RecoveryChallengeResponseSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          500: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { publicKey } = request.body;

      // Always generate a challenge regardless of whether the key exists
      // to prevent public key enumeration. Invalid keys will fail at /verify.
      const challenge = generateRecoveryChallenge(publicKey);
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
        body: RecoveryProofSchema,
        response: {
          200: Type.Ref(RecoveryVerifyResponseSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          500: Type.Ref(ProblemDetailsSchema.$id),
          502: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const agent = await verifyRecoveryProof(request);

      // 5. Call Kratos Admin API to create recovery code
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
        body: RecoveryProofSchema,
        response: {
          200: Type.Ref(RecoveryCredentialsResponseSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          500: Type.Ref(ProblemDetailsSchema.$id),
          502: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const agent = await verifyRecoveryProof(request);
      const clientId = `moltnet-agent-${agent.identityId}`;

      try {
        const existingClient = await fastify.oauth2Client.getOAuth2Client({
          id: clientId,
        });
        const clientSecret = crypto.randomUUID();
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
        fastify.tokenValidator.evictOAuthClient(clientId);
        await fastify.invalidateOAuth2ClientCache(clientId);

        const sealedCredentials = sealForEd25519PublicKey(
          JSON.stringify({ clientId, clientSecret }),
          agent.publicKey,
        );
        fastify.log.info(
          { fingerprint: agent.fingerprint },
          'OAuth2 credentials recovered via Ed25519 proof',
        );
        return { sealedCredentials };
      } catch (err) {
        fastify.log.error(
          { err, fingerprint: agent.fingerprint },
          'OAuth2 credential recovery failed',
        );
        throw createProblem(
          'upstream-error',
          'Failed to replace OAuth2 credentials',
        );
      }
    },
  );
}
