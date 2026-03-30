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
import { type Team, type TeamInvite, teamInvites, teams } from '../schema.js';
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
      const [team] = await getExecutor(db)
        .update(teams)
        .set({ status })
        .where(eq(teams.id, id))
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
  };
}
