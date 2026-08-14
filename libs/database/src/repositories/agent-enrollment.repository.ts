import { createHash, randomBytes } from 'node:crypto';

import { and, eq, gt, isNull } from 'drizzle-orm';

import type { Database } from '../db.js';
import { type AgentEnrollment, agentEnrollments } from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export interface EnrollmentCreator {
  kind: 'agent' | 'human';
  id: string;
}

export interface CreateAgentEnrollmentInput {
  creator: EnrollmentCreator;
  expiresAt: Date;
  teamId: string;
}

export interface CreatedAgentEnrollment {
  enrollment: AgentEnrollment;
  token: string;
}

export function hashAgentEnrollmentToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').toLowerCase();
}

export function createAgentEnrollmentRepository(db: Database) {
  return {
    async create(
      input: CreateAgentEnrollmentInput,
    ): Promise<CreatedAgentEnrollment> {
      const token = randomBytes(32).toString('base64url');
      const tokenHash = hashAgentEnrollmentToken(token);
      const [enrollment] = await getExecutor(db)
        .insert(agentEnrollments)
        .values({
          tokenHash,
          teamId: input.teamId,
          creatorAgentId:
            input.creator.kind === 'agent' ? input.creator.id : null,
          creatorHumanId:
            input.creator.kind === 'human' ? input.creator.id : null,
          expiresAt: input.expiresAt,
        })
        .returning();
      return { enrollment, token };
    },

    async findPendingByTokenHash(
      tokenHash: string,
    ): Promise<AgentEnrollment | null> {
      const [enrollment] = await getExecutor(db)
        .select()
        .from(agentEnrollments)
        .where(
          and(
            eq(agentEnrollments.tokenHash, tokenHash.toLowerCase()),
            isNull(agentEnrollments.redeemedAt),
            isNull(agentEnrollments.revokedAt),
            gt(agentEnrollments.expiresAt, new Date()),
          ),
        )
        .limit(1);
      return enrollment ?? null;
    },

    async redeem(
      tokenHash: string,
      resultingAgentId: string,
    ): Promise<AgentEnrollment | null> {
      const now = new Date();
      const [enrollment] = await getExecutor(db)
        .update(agentEnrollments)
        .set({ redeemedAt: now, resultingAgentId })
        .where(
          and(
            eq(agentEnrollments.tokenHash, tokenHash.toLowerCase()),
            isNull(agentEnrollments.redeemedAt),
            isNull(agentEnrollments.revokedAt),
            gt(agentEnrollments.expiresAt, now),
          ),
        )
        .returning();
      return enrollment ?? null;
    },

    async revoke(id: string, teamId: string): Promise<AgentEnrollment | null> {
      const [enrollment] = await getExecutor(db)
        .update(agentEnrollments)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(agentEnrollments.id, id),
            eq(agentEnrollments.teamId, teamId),
            isNull(agentEnrollments.redeemedAt),
            isNull(agentEnrollments.revokedAt),
          ),
        )
        .returning();
      return enrollment ?? null;
    },

    async releaseRedemption(
      tokenHash: string,
      resultingAgentId: string,
    ): Promise<boolean> {
      const rows = await getExecutor(db)
        .update(agentEnrollments)
        .set({ redeemedAt: null, resultingAgentId: null })
        .where(
          and(
            eq(agentEnrollments.tokenHash, tokenHash.toLowerCase()),
            eq(agentEnrollments.resultingAgentId, resultingAgentId),
            isNull(agentEnrollments.revokedAt),
          ),
        )
        .returning({ id: agentEnrollments.id });
      return rows.length > 0;
    },
  };
}

export type AgentEnrollmentRepository = ReturnType<
  typeof createAgentEnrollmentRepository
>;
