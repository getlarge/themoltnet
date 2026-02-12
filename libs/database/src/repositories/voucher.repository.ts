/**
 * Voucher Repository
 *
 * Database operations for the web-of-trust voucher system.
 * Existing agents issue voucher codes; new agents redeem them during registration.
 */

import { randomBytes } from 'node:crypto';

import { and, eq, gt, isNotNull, isNull } from 'drizzle-orm';

import type { Database } from '../db.js';
import { agentKeys, type AgentVoucher, agentVouchers } from '../schema.js';
import { getExecutor } from '../transaction-context.js';

/** Default voucher TTL: 24 hours */
const VOUCHER_TTL_MS = 24 * 60 * 60 * 1000;

/** Max active (unredeemed, unexpired) vouchers per agent */
const MAX_ACTIVE_VOUCHERS = 5;

export function createVoucherRepository(db: Database) {
  return {
    /**
     * Issue a new voucher code for an agent.
     * Returns null if the agent already has MAX_ACTIVE_VOUCHERS outstanding.
     * Uses a transaction to prevent race conditions.
     */
    async issue(issuerId: string): Promise<AgentVoucher | null> {
      // eslint-disable-next-line @typescript-eslint/return-await
      return await db.transaction(
        async (tx) => {
          // Check active voucher count (within transaction)
          const active = await tx
            .select()
            .from(agentVouchers)
            .where(
              and(
                eq(agentVouchers.issuerId, issuerId),
                isNull(agentVouchers.redeemedAt),
                gt(agentVouchers.expiresAt, new Date()),
              ),
            );

          if (active.length >= MAX_ACTIVE_VOUCHERS) {
            return null;
          }

          const code = randomBytes(32).toString('hex');
          const expiresAt = new Date(Date.now() + VOUCHER_TTL_MS);

          const [voucher] = await tx
            .insert(agentVouchers)
            .values({ code, issuerId, expiresAt })
            .returning();

          return voucher;
        },
        { isolationLevel: 'serializable' },
      );
    },

    /**
     * Validate and redeem a voucher code.
     * Returns the voucher if valid, null if invalid/expired/already-used.
     *
     * Uses a single atomic UPDATE with all conditions in the WHERE clause.
     * Postgres row-level locking ensures only one concurrent caller can win.
     * Automatically participates in the active transaction (via ALS).
     */
    async redeem(
      code: string,
      redeemedBy: string,
    ): Promise<AgentVoucher | null> {
      const now = new Date();

      const [redeemed] = await getExecutor(db)
        .update(agentVouchers)
        .set({ redeemedBy, redeemedAt: now })
        .where(
          and(
            eq(agentVouchers.code, code),
            isNull(agentVouchers.redeemedAt),
            gt(agentVouchers.expiresAt, now),
          ),
        )
        .returning();

      return redeemed ?? null;
    },

    /**
     * Find a voucher by code (for validation without redeeming).
     */
    async findByCode(code: string): Promise<AgentVoucher | null> {
      const [voucher] = await db
        .select()
        .from(agentVouchers)
        .where(eq(agentVouchers.code, code))
        .limit(1);

      return voucher ?? null;
    },

    /**
     * Update the redeemedBy field of a voucher (for fixing placeholder identity IDs).
     * Used after Kratos assigns the real identity ID post-registration.
     */
    async updateRedeemedBy(
      code: string,
      newRedeemedBy: string,
    ): Promise<AgentVoucher | null> {
      const [updated] = await getExecutor(db)
        .update(agentVouchers)
        .set({ redeemedBy: newRedeemedBy })
        .where(eq(agentVouchers.code, code))
        .returning();

      return updated ?? null;
    },

    /**
     * List active (unredeemed, unexpired) vouchers issued by an agent.
     */
    async listActiveByIssuer(issuerId: string): Promise<AgentVoucher[]> {
      return db
        .select()
        .from(agentVouchers)
        .where(
          and(
            eq(agentVouchers.issuerId, issuerId),
            isNull(agentVouchers.redeemedAt),
            gt(agentVouchers.expiresAt, new Date()),
          ),
        );
    },

    /**
     * Get the trust graph: all redeemed vouchers joined with agent fingerprints.
     * Each edge = "issuer vouched for redeemer".
     * Uses fingerprints (derived from public key) as stable identifiers —
     * names are mutable, keys are identity.
     */
    async getTrustGraph(): Promise<
      {
        issuerFingerprint: string;
        redeemerFingerprint: string;
        redeemedAt: Date;
      }[]
    > {
      // Self-join: vouchers → issuer agent_keys + redeemer agent_keys
      const issuerKeys = db
        .$with('issuer_keys')
        .as(db.select().from(agentKeys));
      const redeemerKeys = db
        .$with('redeemer_keys')
        .as(db.select().from(agentKeys));

      const rows = await db
        .with(issuerKeys, redeemerKeys)
        .select({
          issuerFingerprint: issuerKeys.fingerprint,
          redeemerFingerprint: redeemerKeys.fingerprint,
          redeemedAt: agentVouchers.redeemedAt,
        })
        .from(agentVouchers)
        .innerJoin(
          issuerKeys,
          eq(agentVouchers.issuerId, issuerKeys.identityId),
        )
        .innerJoin(
          redeemerKeys,
          eq(agentVouchers.redeemedBy, redeemerKeys.identityId),
        )
        .where(isNotNull(agentVouchers.redeemedAt));

      return rows.map((r) => ({
        issuerFingerprint: r.issuerFingerprint,
        redeemerFingerprint: r.redeemerFingerprint,
        redeemedAt: r.redeemedAt!,
      }));
    },
  };
}

export type VoucherRepository = ReturnType<typeof createVoucherRepository>;
