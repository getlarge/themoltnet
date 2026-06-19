import { and, eq, sql } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type DaemonProfile,
  daemonProfiles,
  type NewDaemonProfile,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';
import { translateUniqueViolation } from '../unique-violation.js';

export type CreateDaemonProfileInput = Omit<
  NewDaemonProfile,
  'id' | 'createdAt' | 'updatedAt' | 'revision'
>;

export type UpdateDaemonProfileInput = Partial<
  Pick<
    NewDaemonProfile,
    | 'name'
    | 'description'
    | 'provider'
    | 'model'
    | 'runtimeKind'
    | 'sandbox'
    | 'sessionStorageMode'
    | 'workspaceStorageMode'
    | 'sessionTtlSec'
    | 'workspaceTtlSec'
    | 'leaseTtlSec'
    | 'heartbeatIntervalMs'
    | 'maxBatchSize'
    | 'requiredEnv'
    | 'requiredTools'
    | 'context'
    | 'definitionCid'
  >
>;

export function createDaemonProfileRepository(db: Database) {
  return {
    async create(input: CreateDaemonProfileInput): Promise<DaemonProfile> {
      try {
        const [row] = await getExecutor(db)
          .insert(daemonProfiles)
          .values(input)
          .returning();
        return row;
      } catch (err) {
        throw (
          translateUniqueViolation(err, {
            constraint: 'daemon_profiles_team_name_idx',
            target: {
              resource: 'runtime-profile',
              keys: {
                teamId: input.teamId,
                name: input.name,
              },
            },
          }) ?? err
        );
      }
    },

    async findById(id: string): Promise<DaemonProfile | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(daemonProfiles)
        .where(eq(daemonProfiles.id, id))
        .limit(1);
      return row ?? null;
    },

    async findByTeamAndName(
      teamId: string,
      name: string,
    ): Promise<DaemonProfile | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(daemonProfiles)
        .where(
          and(eq(daemonProfiles.teamId, teamId), eq(daemonProfiles.name, name)),
        )
        .limit(1);
      return row ?? null;
    },

    async listByTeamId(teamId: string): Promise<DaemonProfile[]> {
      return getExecutor(db)
        .select()
        .from(daemonProfiles)
        .where(eq(daemonProfiles.teamId, teamId))
        .orderBy(daemonProfiles.name);
    },

    async update(
      id: string,
      patch: UpdateDaemonProfileInput,
    ): Promise<DaemonProfile | null> {
      try {
        const [row] = await getExecutor(db)
          .update(daemonProfiles)
          .set({
            ...patch,
            revision: sql`${daemonProfiles.revision} + 1`,
            updatedAt: sql`now()`,
          })
          .where(eq(daemonProfiles.id, id))
          .returning();
        return row ?? null;
      } catch (err) {
        throw (
          translateUniqueViolation(err, {
            constraint: 'daemon_profiles_team_name_idx',
            target: {
              resource: 'runtime-profile',
              id,
            },
          }) ?? err
        );
      }
    },

    async delete(id: string): Promise<boolean> {
      const rows = await getExecutor(db)
        .delete(daemonProfiles)
        .where(eq(daemonProfiles.id, id))
        .returning({ id: daemonProfiles.id });
      return rows.length > 0;
    },
  };
}

export type DaemonProfileRepository = ReturnType<
  typeof createDaemonProfileRepository
>;
