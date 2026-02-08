/**
 * Signing request routes — DBOS durable signing workflow
 *
 * Agents create signing requests, sign locally, and submit signatures.
 * Private keys never leave the agent's runtime.
 *
 * ## Authorization: agentId field comparison (no Keto)
 *
 * Unlike diary entries, signing requests don't use Keto relationships.
 * Ownership is enforced by comparing `signingRequest.agentId` against
 * the authenticated `identityId` from the JWT. This is sufficient because:
 * - Requests are ephemeral (configurable TTL) — Keto cleanup on expiry adds complexity for no gain
 * - Single-owner, no sharing — no viewer/editor relations needed
 * - The only permission is "am I the creator?" — a direct field comparison
 *
 * If multi-party signing or delegation is added later, introduce a
 * `SigningRequest` Keto namespace at that point.
 */

import { requireAuth } from '@moltnet/auth';
import { DBOS, parseStatusFilter, signingWorkflows } from '@moltnet/database';
import { ProblemDetailsSchema } from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';
import {
  SigningRequestListSchema,
  SigningRequestParamsSchema,
  SigningRequestSchema,
} from '../schemas.js';

export async function signingRequestRoutes(fastify: FastifyInstance) {
  // All signing request routes require authentication
  fastify.addHook('preHandler', requireAuth);

  // ── Create Signing Request ────────────────────────────────────
  fastify.post(
    '/crypto/signing-requests',
    {
      schema: {
        operationId: 'createSigningRequest',
        tags: ['crypto'],
        description:
          'Create a signing request. The server generates a nonce and starts a DBOS workflow that waits for the agent to submit a signature.',
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          message: Type.String({ minLength: 1, maxLength: 100000 }),
        }),
        response: {
          201: Type.Ref(SigningRequestSchema),
          401: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const { message } = request.body as { message: string };
      const agentId = request.authContext!.identityId;
      const timeoutSeconds = fastify.signingTimeoutSeconds;
      const expiresAt = new Date(Date.now() + timeoutSeconds * 1000);

      // CRITICAL: DB insert + workflow start inside runTransaction for atomicity.
      // If the workflow start fails, the DB row is rolled back.
      const signingRequest = await fastify.dataSource.runTransaction(
        async () => {
          const created = await fastify.signingRequestRepository.create({
            agentId,
            message,
            expiresAt,
          });

          const workflowHandle = await DBOS.startWorkflow(
            signingWorkflows.requestSignature,
            { workflowID: `signing-${created.id}` },
          )(created.id, agentId, message, created.nonce);

          await fastify.signingRequestRepository.updateStatus(created.id, {
            workflowId: workflowHandle.workflowID,
          });

          return created;
        },
        { name: 'signing.createRequest' },
      );

      return reply.status(201).send(signingRequest);
    },
  );

  // ── List Signing Requests ─────────────────────────────────────
  fastify.get(
    '/crypto/signing-requests',
    {
      schema: {
        operationId: 'listSigningRequests',
        tags: ['crypto'],
        description: 'List signing requests for the authenticated agent.',
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({
          limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
          offset: Type.Optional(Type.Number({ minimum: 0 })),
          status: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Ref(SigningRequestListSchema),
          401: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { limit, offset, status } = request.query as {
        limit?: number;
        offset?: number;
        status?: string;
      };

      const statusFilter = status ? parseStatusFilter(status) : undefined;

      const { items, total } = await fastify.signingRequestRepository.list({
        agentId: request.authContext!.identityId,
        status: statusFilter,
        limit,
        offset,
      });

      return {
        items,
        total,
        limit: limit ?? 20,
        offset: offset ?? 0,
      };
    },
  );

  // ── Get Signing Request ───────────────────────────────────────
  fastify.get(
    '/crypto/signing-requests/:id',
    {
      schema: {
        operationId: 'getSigningRequest',
        tags: ['crypto'],
        description: 'Get a specific signing request by ID.',
        security: [{ bearerAuth: [] }],
        params: SigningRequestParamsSchema,
        response: {
          200: Type.Ref(SigningRequestSchema),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const signingRequest =
        await fastify.signingRequestRepository.findById(id);

      if (
        !signingRequest ||
        signingRequest.agentId !== request.authContext!.identityId
      ) {
        throw createProblem('not-found', 'Signing request not found');
      }

      return signingRequest;
    },
  );

  // ── Submit Signature ──────────────────────────────────────────
  fastify.post(
    '/crypto/signing-requests/:id/sign',
    {
      schema: {
        operationId: 'submitSignature',
        tags: ['crypto'],
        description:
          'Submit a signature for a signing request. The DBOS workflow verifies the signature and updates the request status.',
        security: [{ bearerAuth: [] }],
        params: SigningRequestParamsSchema,
        body: Type.Object({
          signature: Type.String({ minLength: 1 }),
        }),
        response: {
          200: Type.Ref(SigningRequestSchema),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          409: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const { signature } = request.body as { signature: string };
      const agentId = request.authContext!.identityId;

      const signingRequest =
        await fastify.signingRequestRepository.findById(id);

      if (!signingRequest || signingRequest.agentId !== agentId) {
        throw createProblem('not-found', 'Signing request not found');
      }

      // Check expiry server-side (workflow may not have expired it yet)
      if (
        signingRequest.status === 'expired' ||
        (signingRequest.expiresAt &&
          new Date(signingRequest.expiresAt).getTime() <= Date.now())
      ) {
        throw createProblem(
          'signing-request-expired',
          'This signing request has expired',
        );
      }

      if (signingRequest.status === 'completed') {
        throw createProblem(
          'signing-request-already-completed',
          'A signature has already been submitted for this request',
        );
      }

      if (!signingRequest.workflowId) {
        throw createProblem(
          'not-found',
          'Signing request workflow not initialized',
        );
      }

      // Send signature to the DBOS workflow
      await DBOS.send(signingRequest.workflowId, { signature }, 'signature');

      // Brief poll for the result (the workflow verifies immediately)
      const maxWaitMs = 5000;
      const pollIntervalMs = 100;
      const deadline = Date.now() + maxWaitMs;

      let updated = signingRequest;
      while (Date.now() < deadline) {
        const result = await fastify.signingRequestRepository.findById(id);
        if (result && result.status !== 'pending') {
          updated = result;
          break;
        }
        await new Promise<void>((resolve) => {
          setTimeout(resolve, pollIntervalMs);
        });
      }

      return updated;
    },
  );
}
