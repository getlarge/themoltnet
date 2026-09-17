import { and, eq, sql } from 'drizzle-orm';

import { acquireTransactionAdvisoryLock } from '../advisory-lock.js';
import type { Database } from '../db.js';
import {
  type TeamEnrollment,
  teamEnrollments,
  teamInvites,
  teams,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export interface ClaimTeamEnrollment {
  agentId: string;
  inviteId: string;
  idempotencyHash: string;
  requestHash: string;
}

export class TeamEnrollmentError extends Error {
  constructor(
    readonly reason:
      | 'conflict'
      | 'invalid-invite'
      | 'expired'
      | 'exhausted'
      | 'inactive-team',
  ) {
    super(`Team enrollment: ${reason}`);
    this.name = 'TeamEnrollmentError';
  }
}

export function createTeamEnrollmentRepository(db: Database) {
  return {
    async findByRequest(
      agentId: string,
      idempotencyHash: string,
    ): Promise<TeamEnrollment | null> {
      const [receipt] = await getExecutor(db)
        .select()
        .from(teamEnrollments)
        .where(
          and(
            eq(teamEnrollments.agentId, agentId),
            eq(teamEnrollments.idempotencyHash, idempotencyHash),
          ),
        );
      return receipt ?? null;
    },

    /** Caller must use TransactionRunner: receipt and invite use commit together. */
    async claim(input: ClaimTeamEnrollment): Promise<TeamEnrollment> {
      // Serialize all requests from one subject, including different inputs with
      // the same idempotency key. Invite-row locking handles competing subjects.
      await acquireTransactionAdvisoryLock(
        db,
        'team-enrollment',
        input.agentId,
        'claim enrollment',
      );
      const tx = getExecutor(db);
      const [prior] = await tx
        .select()
        .from(teamEnrollments)
        .where(
          and(
            eq(teamEnrollments.agentId, input.agentId),
            eq(teamEnrollments.idempotencyHash, input.idempotencyHash),
          ),
        );
      if (prior) {
        if (
          prior.requestHash !== input.requestHash ||
          prior.inviteId !== input.inviteId
        ) {
          throw new TeamEnrollmentError('conflict');
        }
        return prior;
      }
      const [redeemed] = await tx
        .select({ id: teamEnrollments.id })
        .from(teamEnrollments)
        .where(
          and(
            eq(teamEnrollments.agentId, input.agentId),
            eq(teamEnrollments.inviteId, input.inviteId),
          ),
        );
      if (redeemed) throw new TeamEnrollmentError('conflict');

      const [row] = await tx
        .select({ invite: teamInvites, team: teams })
        .from(teamInvites)
        .innerJoin(teams, eq(teams.id, teamInvites.teamId))
        .where(eq(teamInvites.id, input.inviteId))
        .for('update');
      if (!row || row.team.personal)
        throw new TeamEnrollmentError('invalid-invite');
      if (row.team.status !== 'active')
        throw new TeamEnrollmentError('inactive-team');
      // Use the database clock inside the transaction, including after waiting
      // for a contended row lock. An expired invite must never be claimed.
      const [claimed] = await tx
        .update(teamInvites)
        .set({ useCount: sql`${teamInvites.useCount} + 1` })
        .where(
          and(
            eq(teamInvites.id, input.inviteId),
            sql`${teamInvites.expiresAt} > clock_timestamp()`,
            sql`${teamInvites.useCount} < ${teamInvites.maxUses}`,
          ),
        )
        .returning();
      if (!claimed) {
        const result = await tx.execute<{ expired: boolean }>(
          sql`SELECT ${row.invite.expiresAt.toISOString()}::timestamptz <= clock_timestamp() AS expired`,
        );
        throw new TeamEnrollmentError(
          result.rows[0].expired ? 'expired' : 'exhausted',
        );
      }
      const [receipt] = await tx
        .insert(teamEnrollments)
        .values({
          ...input,
          teamId: claimed.teamId,
          inviteRole: claimed.role,
        })
        .returning();
      return receipt;
    },

    async markMembership(
      id: string,
      role: NonNullable<TeamEnrollment['role']>,
    ): Promise<TeamEnrollment> {
      const [receipt] = await getExecutor(db)
        .update(teamEnrollments)
        .set({
          role,
          membershipGrantedAt: sql`COALESCE(${teamEnrollments.membershipGrantedAt}, clock_timestamp())`,
        })
        .where(
          and(
            eq(teamEnrollments.id, id),
            sql`${teamEnrollments.issuedKeyId} IS NULL`,
          ),
        )
        .returning();
      if (!receipt) throw new TeamEnrollmentError('conflict');
      return receipt;
    },

    async markIssued(id: string, keyId: string): Promise<void> {
      const [receipt] = await getExecutor(db)
        .update(teamEnrollments)
        .set({ issuedKeyId: keyId })
        .where(
          and(
            eq(teamEnrollments.id, id),
            sql`${teamEnrollments.membershipGrantedAt} IS NOT NULL`,
            sql`(${teamEnrollments.issuedKeyId} IS NULL OR ${teamEnrollments.issuedKeyId} = ${keyId})`,
          ),
        )
        .returning({ id: teamEnrollments.id });
      if (!receipt) throw new TeamEnrollmentError('conflict');
    },
  };
}

export type TeamEnrollmentRepository = ReturnType<
  typeof createTeamEnrollmentRepository
>;
