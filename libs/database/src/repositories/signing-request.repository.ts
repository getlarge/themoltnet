/**
 * Signing Request Repository
 *
 * Database operations for the DBOS durable signing workflow.
 * Agents create signing requests; the workflow waits for a signature
 * submission, verifies it, and persists the result.
 */

import { and, count, desc, eq, inArray } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type NewSigningRequest,
  type SigningRequest,
  signingRequests,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

/** Allowed values for the signing request status filter */
const VALID_STATUSES = new Set<string>(['pending', 'completed', 'expired']);

type SigningRequestStatus = 'pending' | 'completed' | 'expired';

export function createSigningRequestRepository(db: Database) {
  return {
    async create(
      input: Pick<NewSigningRequest, 'agentId' | 'message'> & {
        expiresAt: Date;
        workflowId?: string;
      },
    ): Promise<SigningRequest> {
      const [request] = await getExecutor(db)
        .insert(signingRequests)
        .values({
          agentId: input.agentId,
          message: input.message,
          expiresAt: input.expiresAt,
          workflowId: input.workflowId,
        })
        .returning();

      return request;
    },

    async findById(id: string): Promise<SigningRequest | null> {
      const [request] = await db
        .select()
        .from(signingRequests)
        .where(eq(signingRequests.id, id))
        .limit(1);

      return request ?? null;
    },

    async findBySignature(signature: string): Promise<SigningRequest | null> {
      const [request] = await db
        .select()
        .from(signingRequests)
        .where(eq(signingRequests.signature, signature))
        .orderBy(desc(signingRequests.createdAt))
        .limit(1);

      return request ?? null;
    },

    async list(options: {
      agentId: string;
      status?: SigningRequestStatus[];
      limit?: number;
      offset?: number;
    }): Promise<{ items: SigningRequest[]; total: number }> {
      const { agentId, status, limit = 20, offset = 0 } = options;

      const conditions = [eq(signingRequests.agentId, agentId)];
      if (status && status.length > 0) {
        conditions.push(inArray(signingRequests.status, status));
      }

      const where = and(...conditions);

      const [items, [{ value: total }]] = await Promise.all([
        db
          .select()
          .from(signingRequests)
          .where(where)
          .orderBy(desc(signingRequests.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ value: count() }).from(signingRequests).where(where),
      ]);

      return { items, total };
    },

    async updateStatus(
      id: string,
      updates: Partial<
        Pick<
          SigningRequest,
          'status' | 'signature' | 'valid' | 'completedAt' | 'workflowId'
        >
      >,
    ): Promise<SigningRequest | null> {
      const [updated] = await getExecutor(db)
        .update(signingRequests)
        .set(updates)
        .where(eq(signingRequests.id, id))
        .returning();

      return updated ?? null;
    },

    async countByAgent(agentId: string): Promise<number> {
      const [{ value }] = await db
        .select({ value: count() })
        .from(signingRequests)
        .where(
          and(
            eq(signingRequests.agentId, agentId),
            eq(signingRequests.status, 'pending'),
          ),
        );

      return value;
    },
  };
}

/**
 * Filter and validate status strings against the allowed enum values.
 * Returns only valid statuses, discarding empty strings and unknown values.
 */
export function parseStatusFilter(
  raw: string,
): SigningRequestStatus[] | undefined {
  const statuses = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => VALID_STATUSES.has(s)) as SigningRequestStatus[];
  return statuses.length > 0 ? statuses : undefined;
}

export type SigningRequestRepository = ReturnType<
  typeof createSigningRequestRepository
>;
