import { and, eq, isNull, notInArray, or, sql } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type NewRuntimeModel,
  type RuntimeModel,
  runtimeModels,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';
import { translateUniqueViolation } from '../unique-violation.js';

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

export type GlobalRuntimeModelCatalogEntry = Pick<
  NewRuntimeModel,
  'provider' | 'model' | 'displayName' | 'description' | 'capabilities'
>;

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
      try {
        const [row] = await getExecutor(db)
          .insert(runtimeModels)
          .values(input)
          .returning();
        return row;
      } catch (err) {
        throw (
          translateUniqueViolation(err, [
            {
              constraint: 'runtime_models_global_uq',
              target: {
                resource: 'runtime-model',
                keys: {
                  provider: input.provider,
                  model: input.model,
                },
              },
            },
            {
              constraint: 'runtime_models_team_uq',
              target: {
                resource: 'runtime-model',
                keys: {
                  teamId: input.teamId ?? 'global',
                  provider: input.provider,
                  model: input.model,
                },
              },
            },
          ]) ?? err
        );
      }
    },

    /**
     * Reconcile the source-controlled global catalog without touching team
     * entries. Present rows are refreshed and re-enabled; models removed from
     * one of the catalog's providers are retained as inactive history.
     */
    async reconcileGlobalCatalog(
      entries: readonly GlobalRuntimeModelCatalogEntry[],
    ): Promise<void> {
      const executor = getExecutor(db);
      for (const entry of entries) {
        await executor
          .insert(runtimeModels)
          .values({ ...entry, teamId: null, isActive: true })
          .onConflictDoUpdate({
            target: [runtimeModels.provider, runtimeModels.model],
            targetWhere: sql`team_id IS NULL`,
            set: {
              displayName: entry.displayName,
              description: entry.description,
              capabilities: entry.capabilities,
              isActive: true,
              updatedAt: sql`now()`,
            },
          });
      }

      const modelsByProvider = new Map<string, string[]>();
      for (const entry of entries) {
        const models = modelsByProvider.get(entry.provider) ?? [];
        models.push(entry.model);
        modelsByProvider.set(entry.provider, models);
      }
      for (const [provider, models] of modelsByProvider) {
        await executor
          .update(runtimeModels)
          .set({ isActive: false, updatedAt: sql`now()` })
          .where(
            and(
              isNull(runtimeModels.teamId),
              eq(runtimeModels.provider, provider),
              notInArray(runtimeModels.model, models),
            ),
          );
      }
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
          ),
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
          sql`${runtimeModels.teamId} NULLS LAST`,
        );
    },

    async update(
      id: string,
      patch: UpdateRuntimeModelInput,
    ): Promise<RuntimeModel | null> {
      try {
        const [row] = await getExecutor(db)
          .update(runtimeModels)
          .set({
            ...patch,
            updatedAt: sql`now()`,
          })
          .where(eq(runtimeModels.id, id))
          .returning();
        return row ?? null;
      } catch (err) {
        throw (
          translateUniqueViolation(err, [
            {
              constraint: 'runtime_models_global_uq',
              target: {
                resource: 'runtime-model',
                id,
              },
            },
            {
              constraint: 'runtime_models_team_uq',
              target: {
                resource: 'runtime-model',
                id,
              },
            },
          ]) ?? err
        );
      }
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
