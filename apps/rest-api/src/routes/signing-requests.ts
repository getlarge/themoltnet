/**
 * Signing request routes — DBOS durable signing workflow
 *
 * Agents create signing requests, sign locally, and submit signatures.
 * Private keys never leave the agent's runtime.
 *
 * ## Authorization
 *
 * Agent Ed25519 requests remain identity-owned and use a direct `agentId`
 * comparison. Delegated requests are team-scoped: Keto establishes team role
 * and group membership, while the persisted signer constraint selects which
 * eligible human may claim and complete the request.
 */

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth } from '@moltnet/auth';
import { buildSigningBytes } from '@moltnet/crypto-service';
import type { SigningRequest } from '@moltnet/database';
import {
  ConflictProblemDetailsSchema,
  ProblemDetailsSchema,
  SignerConstraintSchema,
  TeamHeaderRequiredSchema,
  VERIFICATION_METHOD,
  VerificationMethodSchema,
} from '@moltnet/models';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';

import {
  CompletePreviewSignRequestSchema,
  MAX_ED25519_SIGNATURE_LENGTH,
  SigningRequestListSchema,
  SigningRequestParamsSchema,
  SigningRequestSchema,
} from '../schemas.js';
import { requireCurrentTeamId } from '../utils/require-current-team-id.js';
import { throwSigningServiceProblem } from '../utils/signing-service-error.js';

function toSigningResponse(row: SigningRequest) {
  return {
    id: row.id,
    agentId: row.agentId,
    verificationMethod: row.verificationMethod,
    requestedBy: row.requestedBy ?? null,
    signerConstraint: row.signerConstraint ?? null,
    teamId: row.teamId ?? null,
    purpose: row.purpose ?? null,
    claimedByHumanId: row.claimedByHumanId ?? null,
    signingCredentialId: row.signingCredentialId ?? null,
    challenge: row.challenge ?? null,
    receipt: row.receipt ?? null,
    message: row.message,
    nonce: row.nonce,
    signingInput: Buffer.from(
      buildSigningBytes(row.message, row.nonce),
    ).toString('base64'),
    status: row.status,
    signature: row.signature,
    valid: row.valid,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    completedAt: row.completedAt,
    claimedAt: row.claimedAt ?? null,
    rejectedAt: row.rejectedAt ?? null,
    rejectionReason: row.rejectionReason ?? null,
  };
}

const SIGNING_JSON_BODY_LIMIT = 64 * 1024;

export async function signingRequestRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // All signing request routes require authentication
  server.addHook('preHandler', requireAuth);

  // ── Create Signing Request ────────────────────────────────────
  server.post(
    '/crypto/signing-requests',
    {
      // Each workflow consumes DBOS resources — apply a stricter per-agent limit
      config: {
        auth: {
          credentialBindingScope: 'identity',
          requiredScopes: ['crypto:sign'],
        },
        rateLimit: fastify.rateLimitConfig?.signing,
      },
      schema: {
        operationId: 'createSigningRequest',
        tags: ['crypto'],
        description:
          'Create a signing request. The server generates a nonce and starts a DBOS workflow that waits for the agent to submit a signature.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        body: Type.Object({
          message: Type.String({ minLength: 1, maxLength: 100000 }),
          verificationMethod: Type.Optional(VerificationMethodSchema),
          teamId: Type.Optional(Type.String({ format: 'uuid' })),
          purpose: Type.Optional(
            Type.String({ minLength: 1, maxLength: 1000 }),
          ),
          signerConstraint: Type.Optional(SignerConstraintSchema),
        }),
        response: {
          400: Type.Ref(ProblemDetailsSchema.$id),
          201: Type.Ref(SigningRequestSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          429: Type.Ref(ProblemDetailsSchema.$id),
          500: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const {
        message,
        verificationMethod = VERIFICATION_METHOD.AgentEd25519,
        teamId,
        purpose,
        signerConstraint,
      } = request.body;
      try {
        const created = await fastify.signingService.requests.create({
          actor: request.authContext!,
          message,
          verificationMethod,
          teamId,
          purpose,
          signerConstraint,
        });
        request.log.info(
          {
            signingId: created.id,
            agentId: request.authContext!.identityId,
          },
          'crypto.signature_prepared',
        );
        return await reply.status(201).send(toSigningResponse(created));
      } catch (error) {
        throwSigningServiceProblem(error);
      }
    },
  );

  // ── List Signing Requests ─────────────────────────────────────
  server.get(
    '/crypto/signing-requests',
    {
      config: {
        auth: {
          credentialBindingScope: 'identity',
          requiredScopes: ['crypto:sign'],
        },
        rateLimit: fastify.rateLimitConfig.read,
      },
      schema: {
        operationId: 'listSigningRequests',
        tags: ['crypto'],
        description: 'List signing requests for the authenticated agent.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        querystring: Type.Object({
          limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
          offset: Type.Optional(Type.Number({ minimum: 0 })),
          status: Type.Optional(
            Type.Array(
              Type.Union([
                Type.Literal('pending'),
                Type.Literal('claimed'),
                Type.Literal('completed'),
                Type.Literal('rejected'),
                Type.Literal('expired'),
              ]),
              {
                maxItems: 5,
                description:
                  'Repeated status filter. Single value also accepted.',
              },
            ),
          ),
          scope: Type.Optional(
            Type.Union([Type.Literal('requested'), Type.Literal('signable')]),
          ),
        }),
        response: {
          400: Type.Ref(ProblemDetailsSchema.$id),
          200: Type.Ref(SigningRequestListSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          500: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { limit, offset, status, scope = 'requested' } = request.query;

      const statusFilter = status;

      try {
        const result = await fastify.signingService.requests.list({
          actor: request.authContext!,
          scope,
          status: statusFilter,
          limit,
          offset,
        });
        return {
          items: result.items.map(toSigningResponse),
          total: result.total,
          limit: limit ?? 20,
          offset: offset ?? 0,
        };
      } catch (error) {
        throwSigningServiceProblem(error);
      }
    },
  );

  // ── Get Signing Request ───────────────────────────────────────
  server.get(
    '/crypto/signing-requests/:id',
    {
      config: {
        auth: {
          credentialBindingScope: 'identity',
          requiredScopes: ['crypto:sign'],
        },
        rateLimit: fastify.rateLimitConfig.read,
      },
      schema: {
        operationId: 'getSigningRequest',
        tags: ['crypto'],
        description: 'Get a specific signing request by ID.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: SigningRequestParamsSchema,
        response: {
          400: Type.Ref(ProblemDetailsSchema.$id),
          200: Type.Ref(SigningRequestSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          500: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { id } = request.params;
      try {
        const signingRequest = await fastify.signingService.requests.get({
          actor: request.authContext!,
          requestId: id,
        });
        return toSigningResponse(signingRequest);
      } catch (error) {
        throwSigningServiceProblem(error);
      }
    },
  );

  // ── Claim Delegated Signing Request ───────────────────────────
  server.post(
    '/crypto/signing-requests/:id/claim',
    {
      config: {
        auth: {
          credentialBindingScope: 'team',
          requiredScopes: ['crypto:sign'],
        },
        rateLimit: fastify.rateLimitConfig?.signing,
      },
      schema: {
        operationId: 'claimSigningRequest',
        tags: ['crypto'],
        security: [{ sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        params: SigningRequestParamsSchema,
        body: Type.Object({
          credentialId: Type.String({ format: 'uuid' }),
        }),
        response: {
          200: Type.Ref(SigningRequestSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ConflictProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const teamId = requireCurrentTeamId(request, 'signing requests');
      try {
        const claimed = await fastify.signingService.requests.claim({
          actor: request.authContext!,
          teamId,
          requestId: request.params.id,
          credentialId: request.body.credentialId,
        });
        request.log.info(
          {
            requestId: claimed.id,
            teamId,
            humanId:
              request.authContext!.subjectType === 'human'
                ? request.authContext!.humanId
                : undefined,
            credentialId: claimed.signingCredentialId,
            verificationMethod: claimed.verificationMethod,
          },
          'crypto.signing_request_claimed',
        );
        return toSigningResponse(claimed);
      } catch (error) {
        throwSigningServiceProblem(error);
      }
    },
  );

  // ── Complete Delegated Signing Request ────────────────────────
  server.post(
    '/crypto/signing-requests/:id/complete',
    {
      config: {
        auth: {
          credentialBindingScope: 'team',
          requiredScopes: ['crypto:sign'],
        },
        rateLimit: fastify.rateLimitConfig?.signing,
        bodyLimit: SIGNING_JSON_BODY_LIMIT,
      },
      schema: {
        operationId: 'completeSigningRequest',
        tags: ['crypto'],
        security: [{ sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        params: SigningRequestParamsSchema,
        body: CompletePreviewSignRequestSchema,
        response: {
          200: Type.Ref(SigningRequestSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ConflictProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const teamId = requireCurrentTeamId(request, 'signing requests');
      try {
        const completed = await fastify.signingService.requests.complete({
          actor: request.authContext!,
          teamId,
          requestId: request.params.id,
          receipt: request.body.receipt,
        });
        request.log.info(
          {
            requestId: completed.id,
            teamId,
            humanId:
              request.authContext!.subjectType === 'human'
                ? request.authContext!.humanId
                : undefined,
            credentialId: completed.signingCredentialId,
            verificationMethod: completed.verificationMethod,
          },
          'crypto.signing_request_completed',
        );
        return toSigningResponse(completed);
      } catch (error) {
        throwSigningServiceProblem(error);
      }
    },
  );

  // ── Reject Delegated Signing Request ──────────────────────────
  server.post(
    '/crypto/signing-requests/:id/reject',
    {
      config: {
        auth: {
          credentialBindingScope: 'team',
          requiredScopes: ['crypto:sign'],
        },
        rateLimit: fastify.rateLimitConfig?.signing,
      },
      schema: {
        operationId: 'rejectSigningRequest',
        tags: ['crypto'],
        security: [{ sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        params: SigningRequestParamsSchema,
        body: Type.Object({
          reason: Type.Optional(Type.String({ maxLength: 1000 })),
        }),
        response: {
          200: Type.Ref(SigningRequestSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ConflictProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const teamId = requireCurrentTeamId(request, 'signing requests');
      try {
        const rejected = await fastify.signingService.requests.reject({
          actor: request.authContext!,
          teamId,
          requestId: request.params.id,
          reason: request.body.reason,
        });
        request.log.info(
          {
            requestId: rejected.id,
            teamId,
            humanId:
              request.authContext!.subjectType === 'human'
                ? request.authContext!.humanId
                : undefined,
            verificationMethod: rejected.verificationMethod,
          },
          'crypto.signing_request_rejected',
        );
        return toSigningResponse(rejected);
      } catch (error) {
        throwSigningServiceProblem(error);
      }
    },
  );

  // ── Submit Signature ──────────────────────────────────────────
  server.post(
    '/crypto/signing-requests/:id/sign',
    {
      config: {
        auth: {
          credentialBindingScope: 'identity',
          requiredScopes: ['crypto:sign'],
        },
      },
      schema: {
        operationId: 'submitSignature',
        tags: ['crypto'],
        description:
          'Submit a signature for a signing request. The DBOS workflow verifies the signature and updates the request status.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: SigningRequestParamsSchema,
        body: Type.Object({
          signature: Type.String({
            minLength: 1,
            maxLength: MAX_ED25519_SIGNATURE_LENGTH,
          }),
        }),
        response: {
          400: Type.Ref(ProblemDetailsSchema.$id),
          200: Type.Ref(SigningRequestSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ConflictProblemDetailsSchema.$id),
          500: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { id } = request.params;
      const { signature } = request.body;
      try {
        const updated =
          await fastify.signingService.requests.submitAgentSignature({
            actor: request.authContext!,
            requestId: id,
            signature,
          });
        request.log.info(
          { signingId: id, valid: updated.valid },
          'crypto.signature_submitted',
        );
        return toSigningResponse(updated);
      } catch (error) {
        throwSigningServiceProblem(error);
      }
    },
  );
}
