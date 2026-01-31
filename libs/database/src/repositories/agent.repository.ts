/**
 * Agent Repository
 *
 * Database operations for agent keys and lookups
 */

import { eq } from 'drizzle-orm';

import type { Database } from '../db.js';
import { type AgentKey, agentKeys, type NewAgentKey } from '../schema.js';

export function createAgentRepository(db: Database) {
  return {
    /**
     * Create or update agent key record
     * Called when syncing from Ory Kratos identity
     */
    async upsert(agent: NewAgentKey): Promise<AgentKey> {
      const [result] = await db
        .insert(agentKeys)
        .values(agent)
        .onConflictDoUpdate({
          target: agentKeys.identityId,
          set: {
            moltbookName: agent.moltbookName,
            publicKey: agent.publicKey,
            fingerprint: agent.fingerprint,
            moltbookVerified: agent.moltbookVerified,
            updatedAt: new Date(),
          },
        })
        .returning();

      return result;
    },

    /**
     * Find agent by Ory identity ID
     */
    async findByIdentityId(identityId: string): Promise<AgentKey | null> {
      const [agent] = await db
        .select()
        .from(agentKeys)
        .where(eq(agentKeys.identityId, identityId))
        .limit(1);

      return agent || null;
    },

    /**
     * Find agent by Moltbook name
     */
    async findByMoltbookName(moltbookName: string): Promise<AgentKey | null> {
      const [agent] = await db
        .select()
        .from(agentKeys)
        .where(eq(agentKeys.moltbookName, moltbookName))
        .limit(1);

      return agent || null;
    },

    /**
     * Find agent by key fingerprint
     */
    async findByFingerprint(fingerprint: string): Promise<AgentKey | null> {
      const [agent] = await db
        .select()
        .from(agentKeys)
        .where(eq(agentKeys.fingerprint, fingerprint))
        .limit(1);

      return agent || null;
    },

    /**
     * Get public key for an agent (for signature verification or encryption)
     */
    async getPublicKey(moltbookName: string): Promise<string | null> {
      const agent = await this.findByMoltbookName(moltbookName);
      return agent?.publicKey || null;
    },

    /**
     * Mark agent as Moltbook verified
     */
    async markMoltbookVerified(identityId: string): Promise<boolean> {
      const result = await db
        .update(agentKeys)
        .set({
          moltbookVerified: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(agentKeys.identityId, identityId))
        .returning({ identityId: agentKeys.identityId });

      return result.length > 0;
    },

    /**
     * Check if Moltbook name is available
     */
    async isNameAvailable(moltbookName: string): Promise<boolean> {
      const agent = await this.findByMoltbookName(moltbookName);
      return agent === null;
    },

    /**
     * Delete agent record (for cleanup/testing)
     */
    async delete(identityId: string): Promise<boolean> {
      const result = await db
        .delete(agentKeys)
        .where(eq(agentKeys.identityId, identityId))
        .returning({ identityId: agentKeys.identityId });

      return result.length > 0;
    },
  };
}

export type AgentRepository = ReturnType<typeof createAgentRepository>;
