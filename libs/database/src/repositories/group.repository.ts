/**
 * Group Repository
 *
 * Database operations for groups.
 * Group membership is stored in Keto — this repository handles
 * group metadata only.
 */

import { eq } from 'drizzle-orm';

import type { Database } from '../db.js';
import { type Group, groups } from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export interface CreateGroupInput {
  name: string;
  teamId: string;
  createdBy: string;
}

export interface GroupRepository {
  create(input: CreateGroupInput): Promise<Group>;
  findById(id: string): Promise<Group | null>;
  listByTeamId(teamId: string): Promise<Group[]>;
  delete(id: string): Promise<boolean>;
}

export function createGroupRepository(db: Database): GroupRepository {
  return {
    async create(input) {
      const [group] = await getExecutor(db)
        .insert(groups)
        .values({
          name: input.name,
          teamId: input.teamId,
          createdBy: input.createdBy,
        })
        .returning();
      return group;
    },

    async findById(id) {
      const [group] = await db
        .select()
        .from(groups)
        .where(eq(groups.id, id))
        .limit(1);
      return group ?? null;
    },

    async listByTeamId(teamId) {
      return db.select().from(groups).where(eq(groups.teamId, teamId));
    },

    async delete(id) {
      const result = await getExecutor(db)
        .delete(groups)
        .where(eq(groups.id, id))
        .returning({ id: groups.id });
      return result.length > 0;
    },
  };
}
