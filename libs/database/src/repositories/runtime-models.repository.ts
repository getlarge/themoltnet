import { and, eq, isNull, or, sql } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type NewRuntimeModel,
  type RuntimeModel,
  runtimeModels,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export type CreateRuntimeModelInput = Omit<
  NewRuntimeModel,
  'id' | 'createdAt' | 'updatedAt'
>;

export type UpdateRuntimeModelInput = Partial<
  Pick<
    NewRuntimeModel,
    | 'displayName'
    | 'description'
    | 'capabilities'
    | 'isActive'
    | 'provider'
    | 'model'
  >
>;

export type ListRuntimeModelsFilter = {
  teamId?: string;
  provider?: string;
};

export function createRuntimeModelRepository(db: Database) {
  return {
    /**
     * Create a row in `runtime_models`. The caller is responsible for setting
     * `teamId` (team-scoped) or leaving it null (global). The DB enforces
     * uniqueness via the partial indexes:
     *   - `runtime_models_global_uq` (provider, model) WHERE team_id IS NULL
     *   - `runtime_models_team_uq` (team_id, provider, model) WHERE team_id IS NOT NULL
     */
    async create(input: CreateRuntimeModelInput): Promise<RuntimeModel> {
      const [row] = await getExecutor(db)
        .insert(runtimeModels)
        .values(input)
        .returning();
      return row;
    },

    async findById(id: string): Promise<RuntimeModel | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(runtimeModels)
        .where(eq(runtimeModels.id, id))
        .limit(1);
      return row ?? null;
    },

    /**
     * Look up a couple by provider+model, scoped to the visible set:
     *   - global entries (team_id IS NULL), always visible
     *   - team-scoped entries (team_id = $teamId)
     * Returns the first match (global wins on a tie because it's listed first).
     */
    async findVisibleByProviderAndModel(
      teamId: string,
      provider: string,
      model: string,
    ): Promise<RuntimeModel | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(runtimeModels)
        .where(
          and(
            eq(runtimeModels.provider, provider),
            eq(runtimeModels.model, model),
            isActiveFilter(),
            or(isNull(runtimeModels.teamId), eq(runtimeModels.teamId, teamId)),
          ),
        )
        .orderBy(sql`${runtimeModels.teamId} NULLS FIRST`)
        .limit(1);
      return row ?? null;
    },

    /**
     * List entries visible to a team: all global entries plus team-scoped
     * entries for that team. Optionally filter by `provider` for autocomplete
     * narrowing.
     */
    async listVisible(
      filter: ListRuntimeModelsFilter,
    ): Promise<RuntimeModel[]> {
      const conditions = [isActiveFilter()];
      if (filter.teamId) {
        conditions.push(
          or(
            isNull(runtimeModels.teamId),
            eq(runtimeModels.teamId, filter.teamId),
          )!,
        );
      } else {
        conditions.push(isNull(runtimeModels.teamId));
      }
      if (filter.provider) {
        conditions.push(eq(runtimeModels.provider, filter.provider));
      }
      return getExecutor(db)
        .select()
        .from(runtimeModels)
        .where(and(...conditions))
        .orderBy(
          runtimeModels.provider,
          runtimeModels.model,
          sql`${runtimeModels.teamId} NULLS FIRST`,
        );
    },

    async listByTeamId(teamId: string): Promise<RuntimeModel[]> {
      return getExecutor(db)
        .select()
        .from(runtimeModels)
        .where(eq(runtimeModels.teamId, teamId))
        .orderBy(runtimeModels.provider, runtimeModels.model);
    },

    async update(
      id: string,
      patch: UpdateRuntimeModelInput,
    ): Promise<RuntimeModel | null> {
      const [row] = await getExecutor(db)
        .update(runtimeModels)
        .set({
          ...patch,
          updatedAt: sql`now()`,
        })
        .where(eq(runtimeModels.id, id))
        .returning();
      return row ?? null;
    },

    async delete(id: string): Promise<boolean> {
      const rows = await getExecutor(db)
        .delete(runtimeModels)
        .where(eq(runtimeModels.id, id))
        .returning({ id: runtimeModels.id });
      return rows.length > 0;
    },
  };
}

/**
 * Shared predicate: only surface `is_active = true` rows by default.
 * Soft-disabled entries remain in the table for audit but are filtered out
 * of catalog reads.
 */
function isActiveFilter() {
  return eq(runtimeModels.isActive, true);
}

export type RuntimeModelRepository = ReturnType<
  typeof createRuntimeModelRepository
>;
