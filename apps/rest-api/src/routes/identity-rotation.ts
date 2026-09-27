/**
 * Identity key rotation route
 *
 * POST /auth/rotate-identity-key — replace the authenticated agent's Ed25519
 * identity key using a proof signed by both the current and the new key.
 */

import { createHash } from 'node:crypto';

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth } from '@moltnet/auth';
import { DBOS } from '@moltnet/database';
import {
  buildIdentityKeyRotationMessage,
  IDENTITY_KEY_ROTATION_MAX_SKEW_MS,
  ProblemDetailsSchema,
} from '@moltnet/models';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';

import { PRINCIPAL_AUTH_SECURITY } from '../openapi-security.js';
import { createProblem } from '../problems/index.js';
import {
  RotateIdentityKeyRequestSchema,
  RotateIdentityKeyResponseSchema,
} from '../schemas.js';
import { agentOAuth2ClientId } from '../utils/agent-oauth2-client.js';
import { identityKeyRotationWorkflow } from '../workflows/index.js';

export async function identityRotationRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();

  server.post(
    '/auth/rotate-identity-key',
    {
      config: {
        auth: {
          credentialBindingScope: 'identity',
          requiredScopes: ['key:manage'],
        },
      },
      schema: {
        operationId: 'rotateIdentityKey',
        tags: ['auth'],
        description:
          "Replace the agent's Ed25519 identity key. Both the current and the new key sign the rotation message `moltnet:identity:rotate:v1\\n<agentId>\\n<currentPublicKey>\\n<newPublicKey>\\n<issuedAt>`. The old key stays verifiable for signatures made while it was current, and its fingerprint still resolves to the agent. Access tokens authenticate the agent, not its key: JWT access tokens issued before the rotation stay valid until they expire (opaque tokens are revoked), and every key the API reports is read from the current agent record, never from token claims.",
        security: PRINCIPAL_AUTH_SECURITY,
        body: Type.Ref(RotateIdentityKeyRequestSchema.$id),
        response: {
          200: Type.Ref(RotateIdentityKeyResponseSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ProblemDetailsSchema.$id),
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
          'Only agents can rotate identity keys',
        );
      }
      const body = request.body as {
        newPublicKey: string;
        issuedAt: string;
        previousKeySignature: string;
        newKeySignature: string;
      };

      // Token claims can lag a rotation; the database holds the current key.
      const agent = await fastify.agentRepository.findById(authContext.agentId);
      if (!agent) {
        throw createProblem('forbidden', 'Agent not found');
      }

      let newKeyBytes: Uint8Array;
      try {
        newKeyBytes = fastify.cryptoService.parsePublicKey(body.newPublicKey);
      } catch {
        throw createProblem(
          'validation-failed',
          'newPublicKey must use format "ed25519:<base64>"',
        );
      }
      if (newKeyBytes.length !== 32) {
        throw createProblem(
          'validation-failed',
          `newPublicKey must be exactly 32 bytes (got ${newKeyBytes.length}).`,
        );
      }
      const newFingerprint =
        fastify.cryptoService.generateFingerprint(newKeyBytes);

      const issuedAt = Date.parse(body.issuedAt);
      if (
        Number.isNaN(issuedAt) ||
        Math.abs(Date.now() - issuedAt) > IDENTITY_KEY_ROTATION_MAX_SKEW_MS
      ) {
        throw createProblem(
          'validation-failed',
          'issuedAt must be within 10 minutes of the server time',
        );
      }

      const message = buildIdentityKeyRotationMessage({
        agentId: agent.id,
        currentPublicKey: agent.publicKey,
        newPublicKey: body.newPublicKey,
        issuedAt: body.issuedAt,
      });
      const verify = async (signature: string, publicKey: string) => {
        try {
          return await fastify.cryptoService.verify(
            message,
            signature,
            publicKey,
          );
        } catch {
          return false;
        }
      };
      if (
        !(await verify(body.previousKeySignature, agent.publicKey)) ||
        !(await verify(body.newKeySignature, body.newPublicKey))
      ) {
        throw createProblem(
          'invalid-signature',
          'The rotation message must be signed by both the current and the new identity key',
        );
      }

      if (
        (await fastify.agentIdentityKeyRepository.findByFingerprint(
          newFingerprint,
        )) ||
        (await fastify.agentRepository.findByFingerprint(newFingerprint))
      ) {
        throw createProblem(
          'conflict',
          'The new key is already, or was previously, registered',
        );
      }

      const clientIds = [agentOAuth2ClientId(agent.id)];
      if (authContext.clientId && !clientIds.includes(authContext.clientId)) {
        clientIds.push(authContext.clientId);
      }
      // One workflow per (agent, new key), so a duplicate request cannot
      // rotate twice.
      const workflowID = `identity-rotation-${agent.id}-${createHash('sha256')
        .update(newKeyBytes)
        .digest('hex')
        .slice(0, 32)}`;

      let result;
      try {
        const handle = await DBOS.startWorkflow(
          identityKeyRotationWorkflow.rotateIdentityKey,
          { workflowID },
        )({
          agentId: agent.id,
          identityId: agent.identityId,
          currentPublicKey: agent.publicKey,
          newPublicKey: body.newPublicKey,
          newFingerprint,
          proof: {
            message,
            previousPublicKey: agent.publicKey,
            previousKeySignature: body.previousKeySignature,
            newKeySignature: body.newKeySignature,
          },
          clientIds,
        });
        result = await handle.getResult();
      } catch (err) {
        request.log.error(
          { err, agentId: agent.id, workflowID },
          'identity.rotation.workflow_failed',
        );
        // The detail names no internals and tells the agent what to check,
        // so it is exposed despite the 5xx status.
        throw Object.assign(
          createProblem(
            'upstream-error',
            'The identity key rotation did not complete. Check GET /agents/whoami for the current key before retrying; an operator can resume a partially applied rotation from the logged workflow.',
          ),
          { exposeServerDetail: true },
        );
      }

      if (result.status === 'stale') {
        throw createProblem(
          'conflict',
          'The current identity key changed; sign a new rotation message',
        );
      }
      if (result.status === 'conflict') {
        throw createProblem(
          'conflict',
          'The new key is already, or was previously, registered',
        );
      }
      return {
        agentId: result.agentId,
        publicKey: result.publicKey,
        fingerprint: result.fingerprint,
        previousFingerprint: result.previousFingerprint,
      };
    },
  );
}
