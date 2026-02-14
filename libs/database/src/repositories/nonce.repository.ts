/**
 * Nonce Repository
 *
 * Tracks consumed recovery challenge nonces to prevent replay attacks.
 */

import { lt } from 'drizzle-orm';

import type { Database } from '../db.js';
import { usedRecoveryNonces } from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export function createNonceRepository(db: Database) {
  return {
    /**
     * Attempt to consume a nonce. Returns true if the nonce was fresh
     * (inserted), false if it was already used (conflict).
     */
    async consume(nonce: string, expiresAt: Date): Promise<boolean> {
      const result = await getExecutor(db)
        .insert(usedRecoveryNonces)
        .values({ nonce, expiresAt })
        .onConflictDoNothing({ target: usedRecoveryNonces.nonce })
        .returning({ nonce: usedRecoveryNonces.nonce });

      return result.length > 0;
    },

    /**
     * Remove expired nonces to keep the table small.
     */
    async cleanup(): Promise<void> {
      await getExecutor(db)
        .delete(usedRecoveryNonces)
        .where(lt(usedRecoveryNonces.expiresAt, new Date()));
    },
  };
}

export type NonceRepository = ReturnType<typeof createNonceRepository>;
