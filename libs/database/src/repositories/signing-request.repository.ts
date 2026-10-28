/**
 * Signing Request Repository
 *
 * Database operations for the DBOS durable signing workflow.
 * Agents create signing requests; the workflow waits for a signature
 * submission, verifies it, and persists the result.
 */

import {
  type PrincipalRef,
  SIGNER_CONSTRAINT_TYPE,
  VERIFICATION_METHOD,
} from '@moltnet/models';
import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';

import { acquireTransactionAdvisoryLock } from '../advisory-lock.js';
import type { Database } from '../db.js';
import {
  type NewSigningRequest,
  type SigningRequest,
  signingRequests,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export type SigningRequestStatus = SigningRequest['status'];

/** The principal that created a signing request. */
export type SigningRequester = PrincipalRef;

/** The row's requester; the `signing_requests_requester_xor` check holds one. */
export function signingRequester(
  row: Pick<SigningRequest, 'id' | 'requesterAgentId' | 'requesterHumanId'>,
): SigningRequester {
  if (row.requesterAgentId) return { kind: 'agent', id: row.requesterAgentId };
  if (row.requesterHumanId) return { kind: 'human', id: row.requesterHumanId };
  throw new Error(`Signing request ${row.id} has no requester`);
}

/** Whether `principal` created the row. */
export function isSigningRequester(
  row: Pick<SigningRequest, 'requesterAgentId' | 'requesterHumanId'>,
  principal: SigningRequester,
): boolean {
  const column =
    principal.kind === 'agent' ? row.requesterAgentId : row.requesterHumanId;
  return column === principal.id;
}

function whereRequester(requester: SigningRequester) {
  return requester.kind === 'agent'
    ? eq(signingRequests.requesterAgentId, requester.id)
    : eq(signingRequests.requesterHumanId, requester.id);
}

export function createSigningRequestRepository(db: Database) {
  return {
    async create(
      input: Pick<NewSigningRequest, 'message'> & {
        requester: SigningRequester;
        expiresAt: Date;
        verificationMethod?: NewSigningRequest['verificationMethod'];
        workflowId?: string;
        signerConstraint?: NewSigningRequest['signerConstraint'];
        teamId?: string;
        purpose?: string;
      },
    ): Promise<SigningRequest> {
      const [request] = await getExecutor(db)
        .insert(signingRequests)
        .values({
          requesterAgentId:
            input.requester.kind === 'agent' ? input.requester.id : null,
          requesterHumanId:
            input.requester.kind === 'human' ? input.requester.id : null,
          message: input.message,
          expiresAt: input.expiresAt,
          verificationMethod:
            input.verificationMethod ?? VERIFICATION_METHOD.AgentEd25519,
          workflowId: input.workflowId,
          signerConstraint: input.signerConstraint,
          teamId: input.teamId,
          purpose: input.purpose,
        })
        .returning();

      return request;
    },

    async findById(id: string): Promise<SigningRequest | null> {
      const [request] = await getExecutor(db)
        .select()
        .from(signingRequests)
        .where(eq(signingRequests.id, id))
        .limit(1);

      return request ?? null;
    },

    /**
     * The newest request whose signature verified. Requests that failed
     * verification are skipped, so a newer request carrying the same
     * signature cannot shadow the one it was made for.
     */
    async findVerifiedBySignature(
      signature: string,
    ): Promise<SigningRequest | null> {
      const [request] = await getExecutor(db)
        .select()
        .from(signingRequests)
        .where(
          and(
            eq(signingRequests.signature, signature),
            eq(signingRequests.valid, true),
          ),
        )
        .orderBy(desc(signingRequests.createdAt))
        .limit(1);

      return request ?? null;
    },

    /**
     * The newest request whose signature verified over `message`. Requests
     * that failed verification are skipped, so another agent resubmitting the
     * same signature on its own request cannot shadow the real one.
     */
    async findVerifiedBySignatureForMessage(
      message: string,
      signature: string,
    ): Promise<SigningRequest | null> {
      const [request] = await getExecutor(db)
        .select()
        .from(signingRequests)
        .where(
          and(
            eq(signingRequests.signature, signature),
            eq(signingRequests.message, message),
            eq(signingRequests.valid, true),
          ),
        )
        .orderBy(desc(signingRequests.createdAt))
        .limit(1);

      return request ?? null;
    },

    async list(options: {
      requester?: SigningRequester;
      teamIds?: string[];
      status?: SigningRequestStatus[];
      unexpired?: boolean;
      limit?: number;
      offset?: number;
    }): Promise<{ items: SigningRequest[]; total: number }> {
      const {
        requester,
        teamIds,
        status,
        unexpired,
        limit = 20,
        offset = 0,
      } = options;

      const conditions = [];
      if (requester) {
        conditions.push(whereRequester(requester));
      }
      if (teamIds?.length) {
        conditions.push(inArray(signingRequests.teamId, teamIds));
      }
      if (status && status.length > 0) {
        conditions.push(inArray(signingRequests.status, status));
      }
      if (unexpired) {
        conditions.push(gt(signingRequests.expiresAt, sql`now()`));
      }

      const where = conditions.length ? and(...conditions) : undefined;

      const executor = getExecutor(db);
      const [items, [{ value: total }]] = await Promise.all([
        executor
          .select()
          .from(signingRequests)
          .where(where)
          .orderBy(desc(signingRequests.createdAt))
          .limit(limit)
          .offset(offset),
        executor.select({ value: count() }).from(signingRequests).where(where),
      ]);

      return { items, total };
    },

    async listSignable(options: {
      teamRoles: Array<{
        teamId: string;
        role: 'owner' | 'manager' | 'executor' | 'member';
      }>;
      humanIds: string[];
      groups: Array<{ groupId: string; teamId: string }>;
      status?: SigningRequestStatus[];
      limit?: number;
      offset?: number;
    }): Promise<{ items: SigningRequest[]; total: number }> {
      const {
        teamRoles,
        humanIds,
        groups,
        status = ['pending', 'claimed'],
        limit = 20,
        offset = 0,
      } = options;
      const constraintType = sql<string>`${signingRequests.signerConstraint}->>'type'`;
      const constraintId = sql<string>`${signingRequests.signerConstraint}->>'id'`;
      const eligible = or(
        and(
          eq(constraintType, SIGNER_CONSTRAINT_TYPE.Human),
          inArray(constraintId, humanIds),
        ),
        ...teamRoles.map(({ teamId, role }) =>
          and(
            eq(signingRequests.teamId, teamId),
            eq(constraintType, SIGNER_CONSTRAINT_TYPE.TeamRole),
            eq(constraintId, role),
          ),
        ),
        ...groups.map(({ groupId, teamId }) =>
          and(
            eq(signingRequests.teamId, teamId),
            eq(constraintType, SIGNER_CONSTRAINT_TYPE.Group),
            eq(constraintId, groupId),
          ),
        ),
      );
      const where = and(
        inArray(
          signingRequests.teamId,
          teamRoles.map(({ teamId }) => teamId),
        ),
        inArray(signingRequests.status, status),
        gt(signingRequests.expiresAt, sql`now()`),
        eligible,
      );
      const executor = getExecutor(db);
      const [items, [{ value: total }]] = await Promise.all([
        executor
          .select()
          .from(signingRequests)
          .where(where)
          .orderBy(desc(signingRequests.createdAt))
          .limit(limit)
          .offset(offset),
        executor.select({ value: count() }).from(signingRequests).where(where),
      ]);
      return { items, total };
    },

    async setWorkflowId(
      id: string,
      workflowId: string,
    ): Promise<SigningRequest | null> {
      const [updated] = await getExecutor(db)
        .update(signingRequests)
        .set({ workflowId })
        .where(
          and(
            eq(signingRequests.id, id),
            eq(signingRequests.status, 'pending'),
            isNull(signingRequests.workflowId),
          ),
        )
        .returning();

      return updated ?? null;
    },

    async completeAgentRequest(input: {
      id: string;
      status: 'completed' | 'expired';
      signature?: string;
      valid?: boolean;
      signerPublicKey?: string;
      completedAt: Date;
    }): Promise<SigningRequest | null> {
      const [updated] = await getExecutor(db)
        .update(signingRequests)
        .set({
          status: input.status,
          signature: input.signature,
          valid: input.valid,
          signerPublicKey: input.signerPublicKey,
          completedAt: input.completedAt,
        })
        .where(
          and(
            eq(signingRequests.id, input.id),
            eq(signingRequests.status, 'pending'),
            eq(
              signingRequests.verificationMethod,
              VERIFICATION_METHOD.AgentEd25519,
            ),
          ),
        )
        .returning();
      return updated ?? null;
    },

    async claim(input: {
      id: string;
      humanId: string;
      credentialId: string;
      challenge: NonNullable<SigningRequest['challenge']>;
      methodState: NonNullable<SigningRequest['methodState']>;
      now?: Date;
    }): Promise<SigningRequest | null> {
      const now = input.now ?? new Date();
      const [claimed] = await getExecutor(db)
        .update(signingRequests)
        .set({
          status: 'claimed',
          claimedByHumanId: input.humanId,
          signingCredentialId: input.credentialId,
          challenge: input.challenge,
          methodState: input.methodState,
          claimedAt: now,
        })
        .where(
          and(
            eq(signingRequests.id, input.id),
            eq(signingRequests.status, 'pending'),
            gt(signingRequests.expiresAt, sql`now()`),
          ),
        )
        .returning();
      return claimed ?? null;
    },

    async completeClaim(input: {
      id: string;
      humanId: string;
      credentialId: string;
      receipt: NonNullable<SigningRequest['receipt']>;
      valid: boolean;
      signature?: string;
      now?: Date;
    }): Promise<SigningRequest | null> {
      const now = input.now ?? new Date();
      const [completed] = await getExecutor(db)
        .update(signingRequests)
        .set({
          status: 'completed',
          receipt: input.receipt,
          valid: input.valid,
          signature: input.signature,
          completedAt: now,
        })
        .where(
          and(
            eq(signingRequests.id, input.id),
            eq(signingRequests.status, 'claimed'),
            eq(signingRequests.claimedByHumanId, input.humanId),
            eq(signingRequests.signingCredentialId, input.credentialId),
            gt(signingRequests.expiresAt, sql`now()`),
          ),
        )
        .returning();
      return completed ?? null;
    },

    async lockClaimForCompletion(input: {
      id: string;
      humanId: string;
      credentialId: string;
    }): Promise<SigningRequest | null> {
      const [request] = await getExecutor(db)
        .select()
        .from(signingRequests)
        .where(
          and(
            eq(signingRequests.id, input.id),
            eq(signingRequests.status, 'claimed'),
            eq(signingRequests.claimedByHumanId, input.humanId),
            eq(signingRequests.signingCredentialId, input.credentialId),
            gt(signingRequests.expiresAt, sql`now()`),
          ),
        )
        .limit(1)
        .for('update');
      return request ?? null;
    },

    async reject(input: {
      id: string;
      humanId: string;
      reason?: string;
      now?: Date;
    }): Promise<SigningRequest | null> {
      const now = input.now ?? new Date();
      const [rejected] = await getExecutor(db)
        .update(signingRequests)
        .set({
          status: 'rejected',
          rejectedAt: now,
          rejectionReason: input.reason,
        })
        .where(
          and(
            eq(signingRequests.id, input.id),
            inArray(signingRequests.status, ['pending', 'claimed']),
            sql`(${signingRequests.claimedByHumanId} IS NULL OR ${signingRequests.claimedByHumanId} = ${input.humanId})`,
            gt(signingRequests.expiresAt, sql`now()`),
          ),
        )
        .returning();
      return rejected ?? null;
    },

    async acquirePendingCreateLock(requester: SigningRequester): Promise<void> {
      await acquireTransactionAdvisoryLock(
        db,
        'signing-request:create',
        `${requester.kind}:${requester.id}`,
        'acquirePendingCreateLock',
      );
    },

    async getActivePendingSummaryByRequester(
      requester: SigningRequester,
    ): Promise<{
      count: number;
      earliestExpiresAt: Date | null;
    }> {
      const [summary] = await getExecutor(db)
        .select({
          count: count(),
          earliestExpiresAt: sql<
            string | null
          >`min(${signingRequests.expiresAt})`,
        })
        .from(signingRequests)
        .where(
          and(
            whereRequester(requester),
            eq(signingRequests.status, 'pending'),
            gt(signingRequests.expiresAt, sql`now()`),
          ),
        );

      return {
        count: summary.count,
        earliestExpiresAt:
          summary.earliestExpiresAt === null
            ? null
            : new Date(summary.earliestExpiresAt),
      };
    },

    async expireDelegated(now = new Date(), limit = 100): Promise<number> {
      const candidates = await getExecutor(db)
        .select({ id: signingRequests.id })
        .from(signingRequests)
        .where(
          and(
            inArray(signingRequests.status, ['pending', 'claimed']),
            ne(
              signingRequests.verificationMethod,
              VERIFICATION_METHOD.AgentEd25519,
            ),
            lte(signingRequests.expiresAt, now),
          ),
        )
        .limit(limit);
      if (candidates.length === 0) return 0;
      const expired = await getExecutor(db)
        .update(signingRequests)
        .set({ status: 'expired', completedAt: now })
        .where(
          and(
            inArray(
              signingRequests.id,
              candidates.map(({ id }) => id),
            ),
            inArray(signingRequests.status, ['pending', 'claimed']),
            lte(signingRequests.expiresAt, now),
          ),
        )
        .returning({ id: signingRequests.id });
      return expired.length;
    },
  };
}

export type SigningRequestRepository = ReturnType<
  typeof createSigningRequestRepository
>;
