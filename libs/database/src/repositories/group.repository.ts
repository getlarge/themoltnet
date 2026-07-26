/**
 * Group Repository
 *
 * Database operations for groups.
 * Group membership is stored in Keto — this repository handles
 * group metadata only.
 */

import { eq, inArray } from 'drizzle-orm';

import type { Database } from '../db.js';
import { type Group, groups } from '../schema.js';
import { getExecutor } from '../transaction-context.js';
import { translateUniqueViolation } from '../unique-violation.js';

export interface GroupCreator {
  kind: 'agent' | 'human';
  id: string;
}

export interface CreateGroupInput {
  name: string;
  teamId: string;
  creator: GroupCreator;
}

export interface GroupRepository {
  create(input: CreateGroupInput): Promise<Group>;
  findById(id: string): Promise<Group | null>;
  findByIds(ids: readonly string[]): Promise<Map<string, Group>>;
  listByTeamId(teamId: string): Promise<Group[]>;
  delete(id: string): Promise<boolean>;
}

export function createGroupRepository(db: Database): GroupRepository {
  return {
    async create(input) {
      try {
        const [group] = await getExecutor(db)
          .insert(groups)
          .values({
            name: input.name,
            teamId: input.teamId,
            creatorAgentId:
              input.creator.kind === 'agent' ? input.creator.id : null,
            creatorHumanId:
              input.creator.kind === 'human' ? input.creator.id : null,
          })
          .returning();
        return group;
      } catch (err) {
        throw (
          translateUniqueViolation(err, {
            constraint: 'groups_name_team_idx',
            target: {
              resource: 'group',
              keys: {
                teamId: input.teamId,
                name: input.name,
              },
            },
          }) ?? err
        );
      }
    },

    async findById(id) {
      const [group] = await getExecutor(db)
        .select()
        .from(groups)
        .where(eq(groups.id, id))
        .limit(1);
      return group ?? null;
    },

    async findByIds(ids) {
      if (ids.length === 0) return new Map();
      const found = await getExecutor(db)
        .select()
        .from(groups)
        .where(inArray(groups.id, [...new Set(ids)]));
      return new Map(found.map((group) => [group.id, group]));
    },

    async listByTeamId(teamId) {
      return getExecutor(db)
        .select()
        .from(groups)
        .where(eq(groups.teamId, teamId));
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
