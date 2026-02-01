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

/** Default voucher TTL: 24 hours */
const VOUCHER_TTL_MS = 24 * 60 * 60 * 1000;

/** Max active (unredeemed, unexpired) vouchers per agent */
const MAX_ACTIVE_VOUCHERS = 5;

export function createVoucherRepository(db: Database) {
  return {
    /**
     * Issue a new voucher code for an agent.
     * Returns null if the agent already has MAX_ACTIVE_VOUCHERS outstanding.
     */
    async issue(issuerId: string): Promise<AgentVoucher | null> {
      // Check active voucher count
      const active = await db
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

      const [voucher] = await db
        .insert(agentVouchers)
        .values({ code, issuerId, expiresAt })
        .returning();

      return voucher;
    },

    /**
     * Validate and redeem a voucher code.
     * Returns the voucher if valid, null if invalid/expired/already-used.
     */
    async redeem(
      code: string,
      redeemedBy: string,
    ): Promise<AgentVoucher | null> {
      const now = new Date();

      // Find valid voucher: matches code, not redeemed, not expired
      const [voucher] = await db
        .select()
        .from(agentVouchers)
        .where(
          and(
            eq(agentVouchers.code, code),
            isNull(agentVouchers.redeemedAt),
            gt(agentVouchers.expiresAt, now),
          ),
        )
        .limit(1);

      if (!voucher) {
        return null;
      }

      // Void the voucher
      const [redeemed] = await db
        .update(agentVouchers)
        .set({ redeemedBy, redeemedAt: now })
        .where(
          and(
            eq(agentVouchers.id, voucher.id),
            // Re-check not redeemed to prevent race condition
            isNull(agentVouchers.redeemedAt),
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
     * Get the trust graph: all redeemed vouchers joined with agent names.
     * Each edge = "issuer vouched for redeemer".
     */
    async getTrustGraph(): Promise<
      { issuer: string; redeemer: string; redeemedAt: Date }[]
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
          issuer: issuerKeys.moltbookName,
          redeemer: redeemerKeys.moltbookName,
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
        issuer: r.issuer,
        redeemer: r.redeemer,
        redeemedAt: r.redeemedAt!,
      }));
    },
  };
}

export type VoucherRepository = ReturnType<typeof createVoucherRepository>;
