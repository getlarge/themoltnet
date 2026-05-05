/**
 * Agent Repository
 *
 * Database operations for agents and identity lookups
 */

import { eq, inArray } from 'drizzle-orm';

import type { Database } from '../db.js';
import { type Agent, agents, type NewAgent } from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export function createAgentRepository(db: Database) {
  return {
    /**
     * Create or update an agent record.
     * Called when syncing from Ory Kratos identity.
     * Automatically participates in the active transaction (via ALS).
     */
    async upsert(agent: NewAgent): Promise<Agent> {
      const [result] = await getExecutor(db)
        .insert(agents)
        .values(agent)
        .onConflictDoUpdate({
          target: agents.identityId,
          set: {
            publicKey: agent.publicKey,
            fingerprint: agent.fingerprint,
            updatedAt: new Date(),
          },
        })
        .returning();

      return result;
    },

    /**
     * Find agent by Ory identity ID
     */
    async findByIdentityId(identityId: string): Promise<Agent | null> {
      const [agent] = await getExecutor(db)
        .select()
        .from(agents)
        .where(eq(agents.identityId, identityId))
        .limit(1);

      return agent || null;
    },

    /**
     * Batch lookup agents by Ory identity IDs. Returns a Map keyed by
     * identityId for O(1) per-row resolution. Used by route helpers to
     * avoid the N+1 pattern when inflating creator on a list of rows.
     */
    async findByIdentityIds(
      identityIds: readonly string[],
    ): Promise<Map<string, Agent>> {
      const unique = Array.from(new Set(identityIds.filter(Boolean)));
      if (unique.length === 0) return new Map();
      const rows = await getExecutor(db)
        .select()
        .from(agents)
        .where(inArray(agents.identityId, unique));
      return new Map(rows.map((a) => [a.identityId, a]));
    },

    /**
     * Find agent by public key
     */
    async findByPublicKey(publicKey: string): Promise<Agent | null> {
      const [agent] = await getExecutor(db)
        .select()
        .from(agents)
        .where(eq(agents.publicKey, publicKey))
        .limit(1);

      return agent || null;
    },

    /**
     * Find agent by key fingerprint
     */
    async findByFingerprint(fingerprint: string): Promise<Agent | null> {
      const [agent] = await getExecutor(db)
        .select()
        .from(agents)
        .where(eq(agents.fingerprint, fingerprint))
        .limit(1);

      return agent || null;
    },

    /**
     * Delete agent record (for cleanup/testing)
     */
    async delete(identityId: string): Promise<boolean> {
      const result = await getExecutor(db)
        .delete(agents)
        .where(eq(agents.identityId, identityId))
        .returning({ identityId: agents.identityId });

      return result.length > 0;
    },
  };
}

export type AgentRepository = ReturnType<typeof createAgentRepository>;
