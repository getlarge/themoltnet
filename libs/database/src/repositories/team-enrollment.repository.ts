import { and, eq, sql } from 'drizzle-orm';

import { acquireTransactionAdvisoryLock } from '../advisory-lock.js';
import type { Database } from '../db.js';
import { type TeamEnrollment, teamInvites, teams } from '../schema.js';
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

/** Only identifiers enter checkpoints; invitation codes and secrets never do. */
const claimFields = {
  id: teamInvites.id,
  agentId: teamInvites.enrollmentAgentId,
  teamId: teamInvites.teamId,
  idempotencyHash: teamInvites.idempotencyHash,
  requestHash: teamInvites.requestHash,
  inviteRole: teamInvites.role,
};

export function createTeamEnrollmentRepository(db: Database) {
  return {
    async findByRequest(
      agentId: string,
      idempotencyHash: string,
    ): Promise<TeamEnrollment | null> {
      const [claim] = await getExecutor(db)
        .select(claimFields)
        .from(teamInvites)
        .where(
          and(
            eq(teamInvites.enrollmentAgentId, agentId),
            eq(teamInvites.idempotencyHash, idempotencyHash),
          ),
        );
      return (claim as TeamEnrollment | undefined) ?? null;
    },

    /** Caller uses TransactionRunner: the claim and DBOS checkpoint commit together. */
    async claim(input: ClaimTeamEnrollment): Promise<TeamEnrollment> {
      await acquireTransactionAdvisoryLock(
        db,
        'team-enrollment',
        input.agentId,
        'claim enrollment',
      );
      const prior = await this.findByRequest(
        input.agentId,
        input.idempotencyHash,
      );
      if (prior) {
        if (
          prior.requestHash !== input.requestHash ||
          prior.id !== input.inviteId
        )
          throw new TeamEnrollmentError('conflict');
        return prior;
      }
      const tx = getExecutor(db);
      const [row] = await tx
        .select({ invite: teamInvites, team: teams })
        .from(teamInvites)
        .innerJoin(teams, eq(teams.id, teamInvites.teamId))
        .where(eq(teamInvites.id, input.inviteId))
        .for('update');
      if (!row || row.invite.revokedAt || row.team.personal)
        throw new TeamEnrollmentError('invalid-invite');
      if (row.team.status !== 'active')
        throw new TeamEnrollmentError('inactive-team');
      if (row.invite.enrollmentAgentId === input.agentId)
        throw new TeamEnrollmentError('conflict');
      const [claimed] = await tx
        .update(teamInvites)
        .set({
          usedAt: sql`clock_timestamp()`,
          enrollmentAgentId: input.agentId,
          idempotencyHash: input.idempotencyHash,
          requestHash: input.requestHash,
        })
        .where(
          and(
            eq(teamInvites.id, input.inviteId),
            sql`${teamInvites.usedAt} IS NULL`,
            sql`${teamInvites.expiresAt} > clock_timestamp()`,
          ),
        )
        .returning(claimFields);
      if (!claimed) {
        const result = await tx.execute<{ expired: boolean }>(
          sql`SELECT ${row.invite.expiresAt.toISOString()}::timestamptz <= clock_timestamp() AS expired`,
        );
        throw new TeamEnrollmentError(
          result.rows[0].expired ? 'expired' : 'exhausted',
        );
      }
      return claimed as TeamEnrollment;
    },
  };
}

export type TeamEnrollmentRepository = ReturnType<
  typeof createTeamEnrollmentRepository
>;
