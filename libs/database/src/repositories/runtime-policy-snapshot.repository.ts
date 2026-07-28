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
  return {
    async persist(
      input: CreateRuntimePolicySnapshotInput,
    ): Promise<RuntimePolicySnapshot> {
      const [created] = await getExecutor(db)
        .insert(runtimePolicySnapshots)
        .values(input)
        .onConflictDoNothing({ target: runtimePolicySnapshots.hash })
        .returning();
      if (created) return created;

      const existing = await this.findByHash(input.hash);
      if (!existing) {
        throw new Error('Runtime policy snapshot persistence failed');
      }
      const sameContent =
        existing.schemaVersion === input.schemaVersion &&
        existing.runtimeKind === input.runtimeKind &&
        existing.capabilityManifestVersion ===
          input.capabilityManifestVersion &&
        existing.enforcement === input.enforcement &&
        JSON.stringify(existing.allowedTools) ===
          JSON.stringify(input.allowedTools);
      if (!sameContent) {
        throw new Error(
          `Runtime policy snapshot hash collision for ${input.hash}`,
        );
      }
      return existing;
    },

    async findByHash(hash: string): Promise<RuntimePolicySnapshot | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(runtimePolicySnapshots)
        .where(eq(runtimePolicySnapshots.hash, hash))
        .limit(1);
      return row ?? null;
    },
  };
}

export type RuntimePolicySnapshotRepository = ReturnType<
  typeof createRuntimePolicySnapshotRepository
>;
