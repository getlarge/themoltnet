import { eq } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type NewRuntimePolicySnapshot,
  type RuntimePolicySnapshot,
  runtimePolicySnapshots,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export type CreateRuntimePolicySnapshotInput = Omit<
  NewRuntimePolicySnapshot,
  'createdAt'
>;

export function createRuntimePolicySnapshotRepository(db: Database) {
  async function findByHash(
    hash: string,
  ): Promise<RuntimePolicySnapshot | null> {
    const [row] = await getExecutor(db)
      .select()
      .from(runtimePolicySnapshots)
      .where(eq(runtimePolicySnapshots.hash, hash))
      .limit(1);
    return row ?? null;
  }

  function assertSameContent(
    existing: RuntimePolicySnapshot,
    input: CreateRuntimePolicySnapshotInput,
  ): RuntimePolicySnapshot {
    const sameContent =
      existing.schemaVersion === input.schemaVersion &&
      existing.runtimeKind === input.runtimeKind &&
      existing.enforcement === input.enforcement &&
      JSON.stringify(existing.allowedTools) ===
        JSON.stringify(input.allowedTools);
    if (!sameContent) {
      throw new Error(
        `Runtime policy snapshot hash collision for ${input.hash}`,
      );
    }
    return existing;
  }

  return {
    async upsert(
      input: CreateRuntimePolicySnapshotInput,
    ): Promise<RuntimePolicySnapshot> {
      const existing = await findByHash(input.hash);
      if (existing) return assertSameContent(existing, input);

      const [created] = await getExecutor(db)
        .insert(runtimePolicySnapshots)
        .values(input)
        .onConflictDoNothing({ target: runtimePolicySnapshots.hash })
        .returning();
      if (created) return created;

      const concurrent = await findByHash(input.hash);
      if (!concurrent) {
        throw new Error(
          `Runtime policy snapshot persistence failed for ${input.hash}`,
        );
      }
      return assertSameContent(concurrent, input);
    },

    findByHash,
  };
}

export type RuntimePolicySnapshotRepository = ReturnType<
  typeof createRuntimePolicySnapshotRepository
>;
