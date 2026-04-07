/**
 * Team Repository
 *
 * Database operations for teams and team invites.
 * Team membership is stored in Keto — this repository handles
 * team metadata and invite lifecycle only.
 */

import { randomBytes } from 'node:crypto';

import { and, eq, inArray, sql } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type FoundingAcceptance,
  foundingAcceptances,
  type Team,
  type TeamInvite,
  teamInvites,
  teams,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

const INVITE_CODE_PREFIX = 'mlt_inv_';

export interface CreateTeamInput {
  name: string;
  personal: boolean;
  createdBy: string;
  status: 'founding' | 'active' | 'archived';
}

export interface CreateInviteInput {
  teamId: string;
  role: 'manager' | 'member';
  maxUses: number;
  expiresAt: Date;
  createdBy: string;
}

export interface CreateFoundingAcceptanceInput {
  teamId: string;
  subjectId: string;
  subjectNs: 'Agent' | 'Human';
  role: 'owner' | 'manager' | 'member';
}

export interface TeamRepository {
  create(input: CreateTeamInput): Promise<Team>;
  findById(id: string): Promise<Team | null>;
  listByIds(ids: string[]): Promise<Team[]>;
  findPersonalByCreator(createdBy: string): Promise<Team | null>;
  updateStatus(
    id: string,
    status: 'founding' | 'active' | 'archived',
  ): Promise<Team | null>;
  delete(id: string): Promise<boolean>;

  createInvite(input: CreateInviteInput): Promise<TeamInvite>;
  findInviteByCode(code: string): Promise<TeamInvite | null>;
  /** Atomically increment use_count if below max_uses. Returns null if exhausted. */
  claimInvite(id: string): Promise<TeamInvite | null>;
  incrementInviteUseCount(id: string): Promise<TeamInvite | null>;
  /** Decrement use_count by 1 (floor at 0). Used to compensate a claimed invite when Keto grant fails. */
  revertInviteClaim(id: string): Promise<TeamInvite | null>;
  listInvites(teamId: string): Promise<TeamInvite[]>;
  deleteInvite(id: string): Promise<boolean>;
  deleteInviteByTeam(inviteId: string, teamId: string): Promise<boolean>;

  createFoundingAcceptance(
    input: CreateFoundingAcceptanceInput,
  ): Promise<FoundingAcceptance>;
  listFoundingAcceptances(teamId: string): Promise<FoundingAcceptance[]>;
  acceptFoundingMember(
    teamId: string,
    subjectId: string,
  ): Promise<FoundingAcceptance | null>;
}

export function createTeamRepository(db: Database): TeamRepository {
  return {
    async create(input) {
      const [team] = await getExecutor(db)
        .insert(teams)
        .values({
          name: input.name,
          personal: input.personal,
          createdBy: input.createdBy,
          status: input.status,
        })
        .returning();
      return team;
    },

    async findById(id) {
      const [team] = await db
        .select()
        .from(teams)
        .where(eq(teams.id, id))
        .limit(1);
      return team ?? null;
    },

    async listByIds(ids) {
      if (ids.length === 0) return [];
      return db.select().from(teams).where(inArray(teams.id, ids));
    },

    async findPersonalByCreator(createdBy) {
      const [team] = await db
        .select()
        .from(teams)
        .where(and(eq(teams.createdBy, createdBy), eq(teams.personal, true)))
        .limit(1);
      return team ?? null;
    },

    async updateStatus(id, status) {
      // State machine guard: only allow valid transitions
      // active requires founding; archived requires founding
      type TeamStatus = 'founding' | 'active' | 'archived';
      const allowedPrior: Partial<Record<TeamStatus, TeamStatus>> = {
        active: 'founding',
        archived: 'founding',
      };
      const priorStatus = allowedPrior[status];
      const condition = priorStatus
        ? and(eq(teams.id, id), eq(teams.status, priorStatus))
        : eq(teams.id, id);
      const [team] = await getExecutor(db)
        .update(teams)
        .set({ status })
        .where(condition)
        .returning();
      return team ?? null;
    },

    async delete(id) {
      const result = await getExecutor(db)
        .delete(teams)
        .where(eq(teams.id, id))
        .returning({ id: teams.id });
      return result.length > 0;
    },

    async createInvite(input) {
      const code = INVITE_CODE_PREFIX + randomBytes(16).toString('base64url');
      const [invite] = await getExecutor(db)
        .insert(teamInvites)
        .values({
          teamId: input.teamId,
          code,
          role: input.role,
          maxUses: input.maxUses,
          expiresAt: input.expiresAt,
          createdBy: input.createdBy,
        })
        .returning();
      return invite;
    },

    async findInviteByCode(code) {
      const [invite] = await db
        .select()
        .from(teamInvites)
        .where(eq(teamInvites.code, code))
        .limit(1);
      return invite ?? null;
    },

    async claimInvite(id) {
      const [invite] = await getExecutor(db)
        .update(teamInvites)
        .set({ useCount: sql`${teamInvites.useCount} + 1` })
        .where(
          and(
            eq(teamInvites.id, id),
            sql`${teamInvites.useCount} < ${teamInvites.maxUses}`,
          ),
        )
        .returning();
      return invite ?? null;
    },

    async incrementInviteUseCount(id) {
      const [invite] = await getExecutor(db)
        .update(teamInvites)
        .set({ useCount: sql`${teamInvites.useCount} + 1` })
        .where(eq(teamInvites.id, id))
        .returning();
      return invite ?? null;
    },

    async revertInviteClaim(id) {
      const [invite] = await getExecutor(db)
        .update(teamInvites)
        .set({
          useCount: sql`GREATEST(${teamInvites.useCount} - 1, 0)`,
        })
        .where(eq(teamInvites.id, id))
        .returning();
      return invite ?? null;
    },

    async listInvites(teamId) {
      return db
        .select()
        .from(teamInvites)
        .where(eq(teamInvites.teamId, teamId));
    },

    async deleteInvite(id) {
      const result = await getExecutor(db)
        .delete(teamInvites)
        .where(eq(teamInvites.id, id))
        .returning({ id: teamInvites.id });
      return result.length > 0;
    },

    async deleteInviteByTeam(inviteId, teamId) {
      const result = await getExecutor(db)
        .delete(teamInvites)
        .where(
          and(eq(teamInvites.id, inviteId), eq(teamInvites.teamId, teamId)),
        )
        .returning({ id: teamInvites.id });
      return result.length > 0;
    },

    async createFoundingAcceptance(input) {
      // ON CONFLICT DO NOTHING makes this idempotent — safe to call in a
      // retried DBOS step without hitting the unique(teamId, subjectId) constraint.
      const [row] = await getExecutor(db)
        .insert(foundingAcceptances)
        .values({
          teamId: input.teamId,
          subjectId: input.subjectId,
          subjectNs: input.subjectNs,
          role: input.role,
        })
        .onConflictDoNothing()
        .returning();
      // If the row already existed the insert is a no-op; fetch the existing row.
      if (!row) {
        const [existing] = await db
          .select()
          .from(foundingAcceptances)
          .where(
            and(
              eq(foundingAcceptances.teamId, input.teamId),
              eq(foundingAcceptances.subjectId, input.subjectId),
            ),
          )
          .limit(1);
        return existing;
      }
      return row;
    },

    async listFoundingAcceptances(teamId) {
      return db
        .select()
        .from(foundingAcceptances)
        .where(eq(foundingAcceptances.teamId, teamId));
    },

    async acceptFoundingMember(teamId, subjectId) {
      const [row] = await getExecutor(db)
        .update(foundingAcceptances)
        .set({ status: 'accepted', acceptedAt: new Date() })
        .where(
          and(
            eq(foundingAcceptances.teamId, teamId),
            eq(foundingAcceptances.subjectId, subjectId),
            eq(foundingAcceptances.status, 'pending'),
          ),
        )
        .returning();
      return row ?? null;
    },
  };
}
