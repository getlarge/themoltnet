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

import { isDeepStrictEqual } from 'node:util';

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth, teamRelationToRole } from '@moltnet/auth';
import { buildSigningBytes } from '@moltnet/crypto-service';
import type { SigningRequest } from '@moltnet/database';
import { DBOS, parseStatusFilter } from '@moltnet/database';
import {
  ConflictProblemDetailsSchema,
  ProblemDetailsSchema,
  SIGNER_CONSTRAINT_TYPE,
  SignerConstraintSchema,
  TeamHeaderRequiredSchema,
  VERIFICATION_METHOD,
  VerificationMethodSchema,
} from '@moltnet/models';
import {
  assertSigningVerifierRegistered,
  assertSupportedSignerConstraint,
  prepareSigningClaim,
  SigningCredentialError,
  type SigningMethodJson,
  SigningVerifierNotRegisteredError,
  SigningWorkflowError,
  signingWorkflows,
  toSigningMethodReceipt,
  verifySigningReceipt,
  waitForSigningResult,
} from '@moltnet/signing-workflows';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from 'typebox';

import { createProblem } from '../problems/index.js';
import {
  MAX_ED25519_SIGNATURE_LENGTH,
  SigningRequestListSchema,
  SigningRequestParamsSchema,
  SigningRequestSchema,
} from '../schemas.js';
import { requireCurrentTeamId } from '../utils/require-current-team-id.js';

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

function asSigningMethodJson(value: unknown): SigningMethodJson {
  return value as SigningMethodJson;
}

function signingPayload(row: SigningRequest): string {
  return Buffer.from(buildSigningBytes(row.message, row.nonce)).toString(
    'base64',
  );
}

interface EligibilityContext {
  humanId: string;
  identityId: string;
  rolesByTeam: Map<string, ReturnType<typeof teamRelationToRole>>;
  groupIds: Set<string>;
  groupTeamIds: Map<string, string>;
}

async function createEligibilityContext(
  fastify: FastifyInstance,
  request: Pick<FastifyRequest, 'authContext'>,
): Promise<EligibilityContext | null> {
  const auth = request.authContext;
  if (!auth || auth.subjectType !== 'human') return null;
  const [roles, groupIds] = await Promise.all([
    fastify.relationshipReader.listTeamIdsAndRolesBySubject(auth.identityId),
    fastify.relationshipReader.listGroupIdsBySubject(auth.identityId),
  ]);
  const groups = await Promise.all(
    groupIds.map((id) => fastify.groupRepository.findById(id)),
  );
  return {
    humanId: auth.humanId,
    identityId: auth.identityId,
    rolesByTeam: new Map(
      roles.map(({ teamId, relation }) => [
        teamId,
        teamRelationToRole(relation),
      ]),
    ),
    groupIds: new Set(groupIds),
    groupTeamIds: new Map(
      groups
        .filter((group) => group !== null)
        .map((group) => [group.id, group.teamId]),
    ),
  };
}

function isEligibleHuman(
  context: EligibilityContext | null,
  row: SigningRequest,
): boolean {
  if (!context || !row.teamId || !row.signerConstraint) return false;
  if (!context.rolesByTeam.has(row.teamId)) return false;
  const constraint = row.signerConstraint;
  switch (constraint.type) {
    case SIGNER_CONSTRAINT_TYPE.Human:
      return (
        constraint.id === context.humanId ||
        constraint.id === context.identityId
      );
    case SIGNER_CONSTRAINT_TYPE.TeamRole:
      return context.rolesByTeam.get(row.teamId) === constraint.id;
    case SIGNER_CONSTRAINT_TYPE.Group:
      return (
        context.groupIds.has(constraint.id) &&
        context.groupTeamIds.get(constraint.id) === row.teamId
      );
    case SIGNER_CONSTRAINT_TYPE.Site:
    case SIGNER_CONSTRAINT_TYPE.Station:
      assertSupportedSignerConstraint(constraint.type);
      return false;
    default: {
      const exhaustive: never = constraint;
      return exhaustive;
    }
  }
}

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
        auth: { credentialBindingScope: 'identity' },
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
        assertSigningVerifierRegistered(verificationMethod);
      } catch (error) {
        if (error instanceof SigningVerifierNotRegisteredError) {
          throw createProblem(
            'validation-failed',
            `No signing verifier is registered for verification method: ${error.verificationMethod}`,
          );
        }
        throw error;
      }
      if (verificationMethod !== VERIFICATION_METHOD.AgentEd25519) {
        if (!teamId || !purpose || !signerConstraint) {
          throw createProblem(
            'validation-failed',
            'Delegated signing requires teamId, purpose, and signerConstraint',
          );
        }
        try {
          assertSupportedSignerConstraint(signerConstraint.type);
        } catch (error) {
          if (error instanceof SigningCredentialError) {
            throw createProblem('validation-failed', error.message);
          }
          throw error;
        }
        const allowed = await fastify.permissionChecker.canAccessTeam(
          teamId,
          request.authContext!.identityId,
          request.authContext!.subjectType === 'human'
            ? KetoNamespace.Human
            : KetoNamespace.Agent,
        );
        if (!allowed) throw createProblem('forbidden');
      }

      const agentId = request.authContext!.identityId;
      const timeoutSeconds = fastify.signingTimeoutSeconds;
      const expiresAt = new Date(Date.now() + timeoutSeconds * 1000);

      // Insert the signing request row first
      const created = await fastify.signingRequestRepository.create({
        agentId,
        message,
        expiresAt,
        verificationMethod,
        requestedBy: {
          id:
            request.authContext!.subjectType === 'human'
              ? request.authContext!.humanId
              : request.authContext!.identityId,
          type: request.authContext!.subjectType,
        },
        signerConstraint,
        teamId,
        purpose,
      });

      if (verificationMethod === VERIFICATION_METHOD.AgentEd25519) {
        // This legacy workflow call and its signing bytes remain unchanged.
        const workflowHandle = await DBOS.startWorkflow(
          signingWorkflows.requestSignature,
          { workflowID: `signing-${created.id}` },
        )(
          created.id,
          agentId,
          message,
          created.nonce,
          created.verificationMethod,
        );
        await fastify.signingRequestRepository.setWorkflowId(
          created.id,
          workflowHandle.workflowID,
        );
      }

      request.log.info(
        { signingId: created.id, agentId },
        'crypto.signature_prepared',
      );
      return reply.status(201).send(toSigningResponse(created));
    },
  );

  // ── List Signing Requests ─────────────────────────────────────
  server.get(
    '/crypto/signing-requests',
    {
      config: {
        auth: { credentialBindingScope: 'identity' },
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

      const statusFilter = status ? parseStatusFilter(status) : undefined;

      if (
        scope === 'signable' &&
        request.authContext!.subjectType !== 'human'
      ) {
        return { items: [], total: 0, limit: limit ?? 20, offset: offset ?? 0 };
      }
      const eligibility =
        scope === 'signable'
          ? await createEligibilityContext(fastify, request)
          : null;
      if (scope === 'signable' && eligibility?.rolesByTeam.size === 0) {
        return { items: [], total: 0, limit: limit ?? 20, offset: offset ?? 0 };
      }
      const result =
        scope === 'signable' && eligibility
          ? await fastify.signingRequestRepository.listSignable({
              teamRoles: [...eligibility.rolesByTeam].map(([teamId, role]) => ({
                teamId,
                role,
              })),
              humanIds: [eligibility.humanId, eligibility.identityId],
              groups: [...eligibility.groupTeamIds].map(
                ([groupId, teamId]) => ({ groupId, teamId }),
              ),
              status: statusFilter?.filter(
                (value): value is 'pending' | 'claimed' =>
                  value === 'pending' || value === 'claimed',
              ),
              limit,
              offset,
            })
          : await fastify.signingRequestRepository.list({
              agentId: request.authContext!.identityId,
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
    },
  );

  // ── Get Signing Request ───────────────────────────────────────
  server.get(
    '/crypto/signing-requests/:id',
    {
      config: {
        auth: { credentialBindingScope: 'identity' },
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
      const signingRequest =
        await fastify.signingRequestRepository.findById(id);

      if (
        !signingRequest ||
        (signingRequest.agentId !== request.authContext!.identityId &&
          signingRequest.claimedByHumanId !==
            (request.authContext!.subjectType === 'human'
              ? request.authContext!.humanId
              : null))
      ) {
        throw createProblem('not-found', 'Signing request not found');
      }

      return toSigningResponse(signingRequest);
    },
  );

  // ── Claim Delegated Signing Request ───────────────────────────
  server.post(
    '/crypto/signing-requests/:id/claim',
    {
      config: {
        auth: { credentialBindingScope: 'team' },
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
      const auth = request.authContext!;
      if (auth.subjectType !== 'human') throw createProblem('forbidden');
      const teamId = requireCurrentTeamId(request, 'signing requests');
      const row = await fastify.signingRequestRepository.findById(
        request.params.id,
      );
      if (!row || row.teamId !== teamId || !row.signerConstraint) {
        throw createProblem('not-found', 'Signing request not found');
      }
      if (
        row.status === 'claimed' &&
        row.claimedByHumanId === auth.humanId &&
        row.signingCredentialId === request.body.credentialId
      ) {
        return toSigningResponse(row);
      }
      try {
        if (
          !isEligibleHuman(
            await createEligibilityContext(fastify, request),
            row,
          )
        ) {
          throw createProblem('forbidden');
        }
      } catch (error) {
        if (error instanceof SigningCredentialError) {
          throw createProblem('validation-failed', error.message);
        }
        throw error;
      }
      const credential =
        await fastify.signingCredentialRepository.findActiveCompatible({
          id: request.body.credentialId,
          ownerHumanId: auth.humanId,
          teamId: row.teamId,
          verificationMethod: row.verificationMethod,
        });
      if (!credential) {
        throw createProblem(
          'validation-failed',
          'An active compatible signing credential is required',
        );
      }
      try {
        const prepared = await prepareSigningClaim({
          verificationMethod: row.verificationMethod,
          requestId: row.id,
          credentialId: credential.id,
          signingPayload: signingPayload(row),
          credentialPublicMaterial: asSigningMethodJson(
            credential.publicMaterial,
          ),
        });
        const claimed = await fastify.signingRequestRepository.claim({
          id: row.id,
          humanId: auth.humanId,
          credentialId: credential.id,
          challenge: {
            verificationMethod: row.verificationMethod,
            value: prepared.challenge,
          },
          methodState: {
            verificationMethod: row.verificationMethod,
            value: prepared.verifierState,
          },
        });
        if (!claimed) {
          throw createProblem(
            'conflict',
            'Signing request was already claimed, completed, rejected, or expired',
          );
        }
        return toSigningResponse(claimed);
      } catch (error) {
        if (error instanceof SigningWorkflowError) {
          throw createProblem('validation-failed', error.message);
        }
        throw error;
      }
    },
  );

  // ── Complete Delegated Signing Request ────────────────────────
  server.post(
    '/crypto/signing-requests/:id/complete',
    {
      config: {
        auth: { credentialBindingScope: 'team' },
        rateLimit: fastify.rateLimitConfig?.signing,
        bodyLimit: SIGNING_JSON_BODY_LIMIT,
      },
      schema: {
        operationId: 'completeSigningRequest',
        tags: ['crypto'],
        security: [{ sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        params: SigningRequestParamsSchema,
        body: Type.Object({
          receipt: Type.Object({
            verificationMethod: VerificationMethodSchema,
            value: Type.Record(Type.String(), Type.Unknown()),
          }),
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
      const auth = request.authContext!;
      if (auth.subjectType !== 'human') throw createProblem('forbidden');
      const teamId = requireCurrentTeamId(request, 'signing requests');
      const row = await fastify.signingRequestRepository.findById(
        request.params.id,
      );
      if (
        row?.status === 'completed' &&
        row.claimedByHumanId === auth.humanId &&
        row.signingCredentialId &&
        isDeepStrictEqual(row.receipt, request.body.receipt)
      ) {
        return toSigningResponse(row);
      }
      if (
        row?.teamId === teamId &&
        row.status === 'claimed' &&
        row.claimedByHumanId !== auth.humanId
      ) {
        throw createProblem('forbidden');
      }
      if (
        !row ||
        row.teamId !== teamId ||
        row.status !== 'claimed' ||
        row.claimedByHumanId !== auth.humanId ||
        !row.signingCredentialId ||
        !row.teamId ||
        !row.methodState
      ) {
        throw createProblem(
          'conflict',
          'Signing request is not claimed by this human',
        );
      }
      const credential =
        await fastify.signingCredentialRepository.findActiveCompatible({
          id: row.signingCredentialId,
          ownerHumanId: auth.humanId,
          teamId: row.teamId,
          verificationMethod: row.verificationMethod,
        });
      if (!credential) {
        throw createProblem(
          'validation-failed',
          'The claimed signing credential is no longer active',
        );
      }
      try {
        const completed = await fastify.transactionRunner.runInTransaction(
          async () => {
            const locked =
              await fastify.signingRequestRepository.lockClaimForCompletion({
                id: row.id,
                humanId: auth.humanId,
                credentialId: credential.id,
              });
            if (!locked?.methodState) {
              const current = await fastify.signingRequestRepository.findById(
                row.id,
              );
              if (
                current?.status === 'completed' &&
                current.claimedByHumanId === auth.humanId &&
                current.signingCredentialId === credential.id &&
                isDeepStrictEqual(current.receipt, request.body.receipt)
              ) {
                return current;
              }
              throw createProblem(
                'conflict',
                'Signing request was already completed, rejected, or expired',
              );
            }
            await verifySigningReceipt({
              verificationMethod: locked.verificationMethod,
              requestId: locked.id,
              credentialId: credential.id,
              signingPayload: signingPayload(locked),
              credentialPublicMaterial: asSigningMethodJson(
                credential.publicMaterial,
              ),
              verifierState: asSigningMethodJson(locked.methodState.value),
              receipt: toSigningMethodReceipt({
                verificationMethod: request.body.receipt.verificationMethod,
                value: asSigningMethodJson(request.body.receipt.value),
              }),
            });
            return fastify.signingRequestRepository.completeClaim({
              id: locked.id,
              humanId: auth.humanId,
              credentialId: credential.id,
              receipt: request.body.receipt,
              valid: true,
            });
          },
          { name: 'complete-signing-request' },
        );
        if (!completed) {
          throw createProblem(
            'conflict',
            'Signing request was already completed, rejected, or expired',
          );
        }
        return toSigningResponse(completed);
      } catch (error) {
        if (error instanceof SigningWorkflowError) {
          throw createProblem('validation-failed', error.message);
        }
        throw error;
      }
    },
  );

  // ── Reject Delegated Signing Request ──────────────────────────
  server.post(
    '/crypto/signing-requests/:id/reject',
    {
      config: {
        auth: { credentialBindingScope: 'team' },
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
      const auth = request.authContext!;
      if (auth.subjectType !== 'human') throw createProblem('forbidden');
      const teamId = requireCurrentTeamId(request, 'signing requests');
      const row = await fastify.signingRequestRepository.findById(
        request.params.id,
      );
      if (!row || row.teamId !== teamId) throw createProblem('not-found');
      const eligible = isEligibleHuman(
        await createEligibilityContext(fastify, request),
        row,
      );
      if (
        (row.status === 'claimed' && row.claimedByHumanId !== auth.humanId) ||
        (row.status === 'pending' && !eligible)
      ) {
        throw createProblem('forbidden');
      }
      const rejected = await fastify.signingRequestRepository.reject({
        id: row.id,
        humanId: auth.humanId,
        reason: request.body.reason,
      });
      if (!rejected) {
        throw createProblem(
          'conflict',
          'Signing request was already completed, rejected, or expired',
        );
      }
      return toSigningResponse(rejected);
    },
  );

  // ── Submit Signature ──────────────────────────────────────────
  server.post(
    '/crypto/signing-requests/:id/sign',
    {
      config: { auth: { credentialBindingScope: 'identity' } },
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
      const agentId = request.authContext!.identityId;

      const signingRequest =
        await fastify.signingRequestRepository.findById(id);

      if (!signingRequest || signingRequest.agentId !== agentId) {
        throw createProblem('not-found', 'Signing request not found');
      }
      if (
        signingRequest.verificationMethod !== VERIFICATION_METHOD.AgentEd25519
      ) {
        throw createProblem(
          'validation-failed',
          'This request requires the delegated claim/complete flow; sign only supports agent-ed25519',
        );
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

      const updated = await waitForSigningResult(id, {
        initial: signingRequest,
        load: (requestId) =>
          fastify.signingRequestRepository.findById(requestId),
      });

      request.log.info(
        { signingId: id, valid: updated.valid },
        'crypto.signature_submitted',
      );
      return toSigningResponse(updated);
    },
  );
}
