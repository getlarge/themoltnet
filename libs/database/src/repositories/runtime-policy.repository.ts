import { and, eq, inArray, sql } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type NewRuntimePolicy,
  runtimePolicies,
  type RuntimePolicy,
  runtimeProfiles,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';
import { translateUniqueViolation } from '../unique-violation.js';

export type ToolEnforcement = 'off' | 'watch' | 'enforce';

/** Hard cap on a single team's policy listing (bounds response size). */
export const RUNTIME_POLICY_LIST_LIMIT = 500;

export type CreateRuntimePolicyInput = Omit<
  NewRuntimePolicy,
  'id' | 'createdAt' | 'updatedAt'
>;

export type UpdateRuntimePolicyInput = Partial<
  Pick<NewRuntimePolicy, 'name' | 'description'>
>;

/**
 * Repository over the thin `runtime_policies` metadata table. Tool grants and
 * profile bindings live in Keto (see `@moltnet/auth` relationship reader/writer)
 * — this repository only owns the SQL row and the profile's enforcement mode.
 */
export function createRuntimePolicyRepository(db: Database) {
  return {
    /**
     * Insert a `runtime_policies` row. Uniqueness of `(team_id, name)` is
     * enforced by `runtime_policies_team_name_idx`.
     */
    async create(input: CreateRuntimePolicyInput): Promise<RuntimePolicy> {
      try {
        const [row] = await getExecutor(db)
          .insert(runtimePolicies)
          .values(input)
          .returning();
        return row;
      } catch (err) {
        throw (
          translateUniqueViolation(err, [
            {
              constraint: 'runtime_policies_team_name_idx',
              target: {
                resource: 'runtime-policy',
                keys: { teamId: input.teamId, name: input.name },
              },
            },
          ]) ?? err
        );
      }
    },

    /** Team-scoped read: returns the policy only if it belongs to `teamId`. */
    async findByIdForTeam(
      id: string,
      teamId: string,
    ): Promise<RuntimePolicy | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(runtimePolicies)
        .where(
          and(eq(runtimePolicies.id, id), eq(runtimePolicies.teamId, teamId)),
        )
        .limit(1);
      return row ?? null;
    },

    async listByTeam(teamId: string): Promise<RuntimePolicy[]> {
      return getExecutor(db)
        .select()
        .from(runtimePolicies)
        .where(eq(runtimePolicies.teamId, teamId))
        .orderBy(runtimePolicies.name)
        .limit(RUNTIME_POLICY_LIST_LIMIT);
    },

    /**
     * Returns the subset of `ids` that exist in `teamId`, as a Set. One query —
     * used to validate a profile→policy binding set without N round trips.
     */
    async findExistingIdsForTeam(
      ids: readonly string[],
      teamId: string,
    ): Promise<Set<string>> {
      if (ids.length === 0) return new Set();
      const rows = await getExecutor(db)
        .select({ id: runtimePolicies.id })
        .from(runtimePolicies)
        .where(
          and(
            eq(runtimePolicies.teamId, teamId),
            inArray(runtimePolicies.id, [...ids]),
          ),
        );
      return new Set(rows.map((row) => row.id));
    },

    /**
     * Serialize concurrent binding replacements for a profile with a
     * transaction-scoped Postgres advisory lock (released on commit/rollback).
     * MUST be called inside a transaction.
     */
    async lockProfileBindings(profileId: string): Promise<void> {
      await getExecutor(db).execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${profileId}, 0))`,
      );
    },

    async update(
      id: string,
      teamId: string,
      patch: UpdateRuntimePolicyInput,
    ): Promise<RuntimePolicy | null> {
      try {
        const [row] = await getExecutor(db)
          .update(runtimePolicies)
          .set({ ...patch, updatedAt: sql`now()` })
          .where(
            and(eq(runtimePolicies.id, id), eq(runtimePolicies.teamId, teamId)),
          )
          .returning();
        return row ?? null;
      } catch (err) {
        throw (
          translateUniqueViolation(err, [
            {
              constraint: 'runtime_policies_team_name_idx',
              target: { resource: 'runtime-policy', id },
            },
          ]) ?? err
        );
      }
    },

    async delete(id: string, teamId: string): Promise<boolean> {
      const rows = await getExecutor(db)
        .delete(runtimePolicies)
        .where(
          and(eq(runtimePolicies.id, id), eq(runtimePolicies.teamId, teamId)),
        )
        .returning({ id: runtimePolicies.id });
      return rows.length > 0;
    },

    /**
     * Returns the profile's `tool_enforcement` mode, scoped by team. Returns
     * `null` when the profile does not exist or belongs to a different team —
     * the caller treats null as not-found (fail-closed team scoping).
     */
    async getProfileEnforcement(
      profileId: string,
      teamId: string,
    ): Promise<ToolEnforcement | null> {
      const [row] = await getExecutor(db)
        .select({ toolEnforcement: runtimeProfiles.toolEnforcement })
        .from(runtimeProfiles)
        .where(
          and(
            eq(runtimeProfiles.id, profileId),
            eq(runtimeProfiles.teamId, teamId),
          ),
        )
        .limit(1);
      return row ? (row.toolEnforcement as ToolEnforcement) : null;
    },

    /** Team-scoped existence check used before binding policies to a profile. */
    async profileExistsForTeam(
      profileId: string,
      teamId: string,
    ): Promise<boolean> {
      const [row] = await getExecutor(db)
        .select({ id: runtimeProfiles.id })
        .from(runtimeProfiles)
        .where(
          and(
            eq(runtimeProfiles.id, profileId),
            eq(runtimeProfiles.teamId, teamId),
          ),
        )
        .limit(1);
      return Boolean(row);
    },
  };
}

export type RuntimePolicyRepository = ReturnType<
  typeof createRuntimePolicyRepository
>;
