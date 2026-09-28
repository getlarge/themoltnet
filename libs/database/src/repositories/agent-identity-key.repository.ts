/**
 * Agent Identity Key Repository
 *
 * Read access to every Ed25519 key an agent has held. Rows are written by the
 * `agents_identity_key_history` trigger; the only direct write is attaching a
 * rotation proof to the row a rotation opened.
 */

import { and, asc, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type AgentIdentityKey,
  agentIdentityKeys,
  type IdentityKeyRotationProof,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export function createAgentIdentityKeyRepository(db: Database) {
  return {
    /**
     * Keys that were current at any instant in [from, to], newest first.
     * A signature made between `from` and `to` was made by one of them.
     * Usually one key; two when a rotation happened inside the window.
     */
    async findKeysValidBetween(
      agentId: string,
      from: Date,
      to: Date,
    ): Promise<AgentIdentityKey[]> {
      return getExecutor(db)
        .select()
        .from(agentIdentityKeys)
        .where(
          and(
            eq(agentIdentityKeys.agentId, agentId),
            lte(agentIdentityKeys.validFrom, to),
            or(
              isNull(agentIdentityKeys.validUntil),
              gte(agentIdentityKeys.validUntil, from),
            ),
          ),
        )
        .orderBy(desc(agentIdentityKeys.validFrom));
    },

    /** The history row for a fingerprint, current or retired. */
    async findByFingerprint(
      fingerprint: string,
    ): Promise<AgentIdentityKey | null> {
      const [row] = await getExecutor(db)
        .select()
        .from(agentIdentityKeys)
        .where(eq(agentIdentityKeys.fingerprint, fingerprint))
        .limit(1);
      return row ?? null;
    },

    /** Every key the agent has held, oldest first. */
    async listForAgent(agentId: string): Promise<AgentIdentityKey[]> {
      return getExecutor(db)
        .select()
        .from(agentIdentityKeys)
        .where(eq(agentIdentityKeys.agentId, agentId))
        .orderBy(asc(agentIdentityKeys.validFrom));
    },

    /**
     * Record the dual-signed proof on the current row for `publicKey`. Returns
     * false when that key is not the agent's current one.
     */
    async attachRotationProof(
      agentId: string,
      publicKey: string,
      proof: IdentityKeyRotationProof,
    ): Promise<boolean> {
      const rows = await getExecutor(db)
        .update(agentIdentityKeys)
        .set({ rotationProof: proof })
        .where(
          and(
            eq(agentIdentityKeys.agentId, agentId),
            eq(agentIdentityKeys.publicKey, publicKey),
            isNull(agentIdentityKeys.validUntil),
          ),
        )
        .returning({ id: agentIdentityKeys.id });
      return rows.length > 0;
    },
  };
}

export type AgentIdentityKeyRepository = ReturnType<
  typeof createAgentIdentityKeyRepository
>;
