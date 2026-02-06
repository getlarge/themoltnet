/**
 * VoucherRepository Integration Tests
 *
 * Runs against a real PostgreSQL database.
 * Requires DATABASE_URL environment variable pointing to a test database
 * with the schema from infra/supabase/init.sql applied.
 *
 * Start the test database: docker compose --profile dev up -d app-db
 * Run: DATABASE_URL=postgresql://moltnet:moltnet_secret@localhost:5433/moltnet pnpm --filter @moltnet/database test
 */

import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../src/db.js';
import { createVoucherRepository } from '../src/repositories/voucher.repository.js';
import { type AgentVoucher, agentVouchers } from '../src/schema.js';

const DATABASE_URL = process.env.DATABASE_URL;

describe.runIf(DATABASE_URL)('VoucherRepository (integration)', () => {
  let db: Database;
  let repo: ReturnType<typeof createVoucherRepository>;

  const ISSUER_ID = '00000000-0000-4000-a000-000000000001';
  const REDEEMER_A = '00000000-0000-4000-a000-000000000002';
  const REDEEMER_B = '00000000-0000-4000-a000-000000000003';

  beforeAll(() => {
    // createDatabase returns DatabaseConnection; the db property is typed
    // structurally the same — matches existing diary integration test pattern.
    db = createDatabase(DATABASE_URL!) as unknown as Database;
    repo = createVoucherRepository(db);
  });

  afterEach(async () => {
    await db.delete(agentVouchers);
  });

  afterAll(async () => {
    await db.delete(agentVouchers);
  });

  // ── Issue ──────────────────────────────────────────────────────────

  describe('issue', () => {
    it('issues a voucher and returns it', async () => {
      const voucher = await repo.issue(ISSUER_ID);

      expect(voucher).not.toBeNull();
      expect(voucher!.issuerId).toBe(ISSUER_ID);
      expect(voucher!.code).toHaveLength(64);
      expect(voucher!.redeemedAt).toBeNull();
      expect(voucher!.redeemedBy).toBeNull();
      expect(voucher!.expiresAt).toBeInstanceOf(Date);
      expect(voucher!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('returns null when max active vouchers reached', async () => {
      // Issue 5 vouchers (the max)
      for (let i = 0; i < 5; i++) {
        const v = await repo.issue(ISSUER_ID);
        expect(v).not.toBeNull();
      }

      // 6th should fail
      const sixth = await repo.issue(ISSUER_ID);
      expect(sixth).toBeNull();
    });

    it('allows issuance after a voucher is redeemed', async () => {
      // Issue 5 vouchers
      const vouchers: AgentVoucher[] = [];
      for (let i = 0; i < 5; i++) {
        vouchers.push((await repo.issue(ISSUER_ID))!);
      }

      // Redeem one to free up a slot
      await repo.redeem(vouchers[0]!.code, REDEEMER_A);

      // Should now be able to issue again
      const newVoucher = await repo.issue(ISSUER_ID);
      expect(newVoucher).not.toBeNull();
    });

    it('enforces max-5 invariant under concurrent issuance', async () => {
      // Issue 4 vouchers sequentially (leaving room for 1 more)
      for (let i = 0; i < 4; i++) {
        await repo.issue(ISSUER_ID);
      }

      // Fire 3 concurrent issue() calls — at most 1 should succeed
      const results = await Promise.allSettled([
        repo.issue(ISSUER_ID),
        repo.issue(ISSUER_ID),
        repo.issue(ISSUER_ID),
      ]);

      // Count successful issuances (non-null fulfilled values)
      const succeeded = results.filter(
        (r) => r.status === 'fulfilled' && r.value !== null,
      );
      // Serialization failures show up as rejected promises
      const failed = results.filter((r) => r.status === 'rejected');

      // At most 1 should have succeeded (the rest either return null or
      // get a serialization error from SERIALIZABLE isolation)
      expect(succeeded.length + failed.length).toBeGreaterThanOrEqual(2);
      expect(succeeded.length).toBeLessThanOrEqual(1);
    });
  });

  // ── Redeem ─────────────────────────────────────────────────────────

  describe('redeem', () => {
    it('redeems a valid voucher', async () => {
      const voucher = await repo.issue(ISSUER_ID);

      const redeemed = await repo.redeem(voucher!.code, REDEEMER_A);

      expect(redeemed).not.toBeNull();
      expect(redeemed!.redeemedBy).toBe(REDEEMER_A);
      expect(redeemed!.redeemedAt).toBeInstanceOf(Date);
      expect(redeemed!.code).toBe(voucher!.code);
    });

    it('returns null for already-redeemed voucher', async () => {
      const voucher = await repo.issue(ISSUER_ID);
      await repo.redeem(voucher!.code, REDEEMER_A);

      const second = await repo.redeem(voucher!.code, REDEEMER_B);

      expect(second).toBeNull();
    });

    it('returns null for expired voucher', async () => {
      const voucher = await repo.issue(ISSUER_ID);

      // Manually expire the voucher by setting expiresAt to the past
      await db
        .update(agentVouchers)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(agentVouchers.code, voucher!.code));

      const result = await repo.redeem(voucher!.code, REDEEMER_A);

      expect(result).toBeNull();
    });

    it('returns null for nonexistent code', async () => {
      const result = await repo.redeem('nonexistent-code', REDEEMER_A);

      expect(result).toBeNull();
    });

    it('only one concurrent redeemer wins', async () => {
      const voucher = await repo.issue(ISSUER_ID);

      // Race two concurrent redemptions
      const [resultA, resultB] = await Promise.all([
        repo.redeem(voucher!.code, REDEEMER_A),
        repo.redeem(voucher!.code, REDEEMER_B),
      ]);

      // Exactly one should succeed
      const winners = [resultA, resultB].filter((r) => r !== null);
      expect(winners).toHaveLength(1);

      // The winner should have the correct redeemedBy
      const winner = winners[0]!;
      expect([REDEEMER_A, REDEEMER_B]).toContain(winner.redeemedBy);
    });
  });

  // ── findByCode ─────────────────────────────────────────────────────

  describe('findByCode', () => {
    it('returns voucher by code', async () => {
      const issued = await repo.issue(ISSUER_ID);

      const found = await repo.findByCode(issued!.code);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(issued!.id);
    });

    it('returns null for nonexistent code', async () => {
      const found = await repo.findByCode('does-not-exist');

      expect(found).toBeNull();
    });
  });

  // ── listActiveByIssuer ─────────────────────────────────────────────

  describe('listActiveByIssuer', () => {
    it('returns unredeemed, unexpired vouchers', async () => {
      await repo.issue(ISSUER_ID);
      await repo.issue(ISSUER_ID);

      const active = await repo.listActiveByIssuer(ISSUER_ID);

      expect(active).toHaveLength(2);
    });

    it('excludes redeemed vouchers', async () => {
      const v1 = await repo.issue(ISSUER_ID);
      await repo.issue(ISSUER_ID);
      await repo.redeem(v1!.code, REDEEMER_A);

      const active = await repo.listActiveByIssuer(ISSUER_ID);

      expect(active).toHaveLength(1);
    });

    it('returns empty array for unknown issuer', async () => {
      const active = await repo.listActiveByIssuer(
        '99999999-0000-4000-a000-000000000099',
      );

      expect(active).toHaveLength(0);
    });
  });
});
