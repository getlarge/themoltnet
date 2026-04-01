import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type RenderedPackVerification,
  renderedPackVerifications,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export type RenderedPackVerificationStatus =
  | 'created'
  | 'claimed'
  | 'submitted'
  | 'expired';

export function createVerificationRepository(db: Database) {
  return {
    async create(input: {
      renderedPackId: string;
      nonce: string;
      expiresAt: Date;
    }): Promise<RenderedPackVerification> {
      const [row] = await getExecutor(db)
        .insert(renderedPackVerifications)
        .values({
          renderedPackId: input.renderedPackId,
          nonce: input.nonce,
          expiresAt: input.expiresAt,
          status: 'created',
        })
        .onConflictDoNothing({ target: renderedPackVerifications.nonce })
        .returning();

      if (row) {
        return row;
      }

      const [existing] = await getExecutor(db)
        .select()
        .from(renderedPackVerifications)
        .where(eq(renderedPackVerifications.nonce, input.nonce))
        .limit(1);
      if (!existing) {
        throw new Error(
          `Verification nonce conflict without persisted row: ${input.nonce}`,
        );
      }
      return existing;
    },

    async findById(id: string): Promise<RenderedPackVerification | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(renderedPackVerifications)
        .where(eq(renderedPackVerifications.id, id))
        .limit(1);

      return row ?? null;
    },

    async findByNonce(nonce: string): Promise<RenderedPackVerification | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(renderedPackVerifications)
        .where(eq(renderedPackVerifications.nonce, nonce))
        .limit(1);

      return row ?? null;
    },

    async findLatestClaimableByRenderedPackId(
      renderedPackId: string,
      now = new Date(),
    ): Promise<RenderedPackVerification | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(renderedPackVerifications)
        .where(
          and(
            eq(renderedPackVerifications.renderedPackId, renderedPackId),
            inArray(renderedPackVerifications.status, ['created', 'claimed']),
            gt(renderedPackVerifications.expiresAt, now),
          ),
        )
        .orderBy(desc(renderedPackVerifications.createdAt))
        .limit(1);

      return row ?? null;
    },

    async updateStatus(
      id: string,
      status: RenderedPackVerificationStatus,
      claimedBy?: string,
    ): Promise<void> {
      const setValues: Record<string, unknown> = {
        status,
        updatedAt: sql`now()`,
      };
      if (claimedBy !== undefined) {
        setValues.claimedBy = claimedBy;
        setValues.claimedAt = sql`now()`;
      }

      await getExecutor(db)
        .update(renderedPackVerifications)
        .set(setValues)
        .where(eq(renderedPackVerifications.id, id));
    },
  };
}

export type VerificationRepository = ReturnType<
  typeof createVerificationRepository
>;
