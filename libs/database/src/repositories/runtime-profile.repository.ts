import { and, eq, sql } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type NewRuntimeProfile,
  type RuntimeProfile,
  runtimeProfiles,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';
import { translateUniqueViolation } from '../unique-violation.js';

export type CreateRuntimeProfileInput = Omit<
  NewRuntimeProfile,
  'id' | 'createdAt' | 'updatedAt' | 'revision'
>;

export type UpdateRuntimeProfileInput = Partial<
  Pick<
    NewRuntimeProfile,
    | 'name'
    | 'description'
    | 'provider'
    | 'model'
    | 'runtimeKind'
    | 'sandbox'
    | 'sessionStorageMode'
    | 'workspaceStorageMode'
    | 'defaultWorkspaceMode'
    | 'allowedWorkspaceModes'
    | 'sessionTtlSec'
    | 'workspaceTtlSec'
    | 'leaseTtlSec'
    | 'heartbeatIntervalMs'
    | 'maxBatchSize'
    | 'maxTurns'
    | 'maxBashTimeouts'
    | 'requiredEnv'
    | 'requiredTools'
    | 'context'
    | 'definitionCid'
  >
>;

export function createRuntimeProfileRepository(db: Database) {
  return {
    async create(input: CreateRuntimeProfileInput): Promise<RuntimeProfile> {
      try {
        const [row] = await getExecutor(db)
          .insert(runtimeProfiles)
          .values(input)
          .returning();
        return row;
      } catch (err) {
        throw (
          translateUniqueViolation(err, {
            constraint: 'runtime_profiles_team_name_idx',
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

    async findById(id: string): Promise<RuntimeProfile | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(runtimeProfiles)
        .where(eq(runtimeProfiles.id, id))
        .limit(1);
      return row ?? null;
    },

    async findByTeamAndName(
      teamId: string,
      name: string,
    ): Promise<RuntimeProfile | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(runtimeProfiles)
        .where(
          and(
            eq(runtimeProfiles.teamId, teamId),
            eq(runtimeProfiles.name, name),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    async listByTeamId(teamId: string): Promise<RuntimeProfile[]> {
      return getExecutor(db)
        .select()
        .from(runtimeProfiles)
        .where(eq(runtimeProfiles.teamId, teamId))
        .orderBy(runtimeProfiles.name);
    },

    async update(
      id: string,
      patch: UpdateRuntimeProfileInput,
    ): Promise<RuntimeProfile | null> {
      try {
        const [row] = await getExecutor(db)
          .update(runtimeProfiles)
          .set({
            ...patch,
            revision: sql`${runtimeProfiles.revision} + 1`,
            updatedAt: sql`now()`,
          })
          .where(eq(runtimeProfiles.id, id))
          .returning();
        return row ?? null;
      } catch (err) {
        throw (
          translateUniqueViolation(err, {
            constraint: 'runtime_profiles_team_name_idx',
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
        .delete(runtimeProfiles)
        .where(eq(runtimeProfiles.id, id))
        .returning({ id: runtimeProfiles.id });
      return rows.length > 0;
    },
  };
}

export type RuntimeProfileRepository = ReturnType<
  typeof createRuntimeProfileRepository
>;
