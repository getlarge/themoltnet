/**
 * Agent Repository
 *
 * Database operations for agents and identity lookups
 */

import { eq, inArray } from 'drizzle-orm';

import type { Database } from '../db.js';
import { type Agent, agents, type NewAgent } from '../schema.js';
import { getExecutor } from '../transaction-context.js';

/**
 * A different public key already holds this fingerprint.
 *
 * The fingerprint is a truncated display form, so this is either a genuine
 * collision or a deliberate one. Either way the existing agent's key is left
 * untouched: rebinding it would hand over that agent's durable id, permissions
 * and credentials.
 */
export class AgentFingerprintConflictError extends Error {
  constructor(readonly fingerprint: string) {
    super(
      `Fingerprint ${fingerprint} is already registered to a different public key`,
    );
    this.name = 'AgentFingerprintConflictError';
  }
}

/** Concurrent insert won and its row vanished before we could read it. */
export class AgentFingerprintRaceError extends Error {
  constructor(readonly fingerprint: string) {
    super(`Agent for fingerprint ${fingerprint} disappeared during upsert`);
    this.name = 'AgentFingerprintRaceError';
  }
}

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
     * Create an agent by its key fingerprint, or return the existing row when
     * the SAME key is presented again.
     *
     * Registration creates the agent row FIRST, so `agents.id` exists before
     * the Kratos identity is minted and can be written into the identity's
     * metadata_public. At that point `identity_id` is still NULL, so it cannot
     * serve as the conflict target — the fingerprint is the only stable key
     * available.
     *
     * The fingerprint is a DISPLAY form, not the key: 64 bits, which is
     * birthday-attackable. So a conflict is never resolved by trusting it.
     * The stored public key must equal the presented one exactly, and is never
     * overwritten — otherwise presenting a colliding fingerprint with a
     * different key would rebind an existing agent's durable id, its Keto
     * grants and its deterministic OAuth2 client secret to the attacker's key.
     *
     * Idempotent for a genuine retry (same key, same fingerprint); rejects a
     * collision outright.
     *
     * `created` tells the caller whether this row is theirs to compensate.
     * A retry that resolves to a pre-existing agent must not tear down
     * resources that agent already owned.
     */
    async upsertByFingerprint(agent: {
      publicKey: string;
      fingerprint: string;
    }): Promise<{ agent: Agent; created: boolean }> {
      const [inserted] = await getExecutor(db)
        .insert(agents)
        .values({ publicKey: agent.publicKey, fingerprint: agent.fingerprint })
        .onConflictDoNothing({ target: agents.fingerprint })
        .returning();

      if (inserted) return { agent: inserted, created: true };

      const [existing] = await getExecutor(db)
        .select()
        .from(agents)
        .where(eq(agents.fingerprint, agent.fingerprint))
        .limit(1);

      if (!existing) {
        // Lost the insert race and the winner's row is already gone. Retryable
        // rather than fatal: nothing has been bound to a wrong key.
        throw new AgentFingerprintRaceError(agent.fingerprint);
      }

      if (existing.publicKey !== agent.publicKey) {
        throw new AgentFingerprintConflictError(agent.fingerprint);
      }

      return { agent: existing, created: false };
    },

    /**
     * Delete an agent by its internal ID. Used by registration compensation,
     * which knows the agent it created but may have no Kratos identity to
     * delete by (the identity step may never have run).
     */
    async deleteById(agentId: string): Promise<boolean> {
      const result = await getExecutor(db)
        .delete(agents)
        .where(eq(agents.id, agentId))
        .returning({ id: agents.id });

      return result.length > 0;
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
      // identityId is nullable since agents were decoupled from Kratos, but a
      // row matched by `identity_id IN (...)` necessarily has one. The
      // predicate makes that provable rather than merely asserted.
      return new Map(
        rows
          .filter(
            (a): a is Agent & { identityId: string } => a.identityId !== null,
          )
          .map((a) => [a.identityId, a]),
      );
    },

    /**
     * Batch lookup agents by internal MoltNet ID. Returns a Map keyed by `id`.
     *
     * This is the batch form to use when inflating a creator: `*_agent_id` FK
     * columns reference `agents.id`, not the Kratos identity. Using
     * `findByIdentityIds` for that misses every agent whose id and identity
     * differ — which is all of them once an identity is recreated.
     */
    async findByIds(agentIds: readonly string[]): Promise<Map<string, Agent>> {
      const unique = Array.from(new Set(agentIds.filter(Boolean)));
      if (unique.length === 0) return new Map();
      const rows = await getExecutor(db)
        .select()
        .from(agents)
        .where(inArray(agents.id, unique));
      return new Map(rows.map((a) => [a.id, a]));
    },

    /**
     * Find an agent by its internal MoltNet ID.
     *
     * This is the stable lookup: `id` never changes, whereas `identityId` moves
     * whenever the Kratos identity is recreated.
     */
    async findById(agentId: string): Promise<Agent | null> {
      const [agent] = await getExecutor(db)
        .select()
        .from(agents)
        .where(eq(agents.id, agentId))
        .limit(1);

      return agent || null;
    },

    /**
     * Bind an agent to a Kratos identity, or clear the binding with `null`.
     * Used to relink after an identity loss without touching any other column.
     */
    async relinkIdentity(
      agentId: string,
      identityId: string | null,
    ): Promise<void> {
      await getExecutor(db)
        .update(agents)
        .set({ identityId, updatedAt: new Date() })
        .where(eq(agents.id, agentId));
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
