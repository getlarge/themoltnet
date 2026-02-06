import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../src/db.js';
import { createVoucherRepository } from '../src/repositories/voucher.repository.js';
import type { AgentVoucher } from '../src/schema.js';

// Helper to create a mock Drizzle database
function createMockDb() {
  const mockChain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  };

  const db = {
    insert: vi.fn().mockReturnValue(mockChain),
    select: vi.fn().mockReturnValue(mockChain),
    update: vi.fn().mockReturnValue(mockChain),
    delete: vi.fn().mockReturnValue(mockChain),
    transaction: vi.fn().mockImplementation((fn) => fn(db)),
    _chain: mockChain,
  };

  return db as unknown as Database & { _chain: typeof mockChain };
}

const ISSUER_ID = '550e8400-e29b-41d4-a716-446655440000';
const REDEEMER_ID = '660e8400-e29b-41d4-a716-446655440001';

const mockVoucher: AgentVoucher = {
  id: '770e8400-e29b-41d4-a716-446655440002',
  code: 'a'.repeat(64),
  issuerId: ISSUER_ID,
  redeemedBy: null,
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  redeemedAt: null,
  createdAt: new Date(),
};

describe('createVoucherRepository', () => {
  let db: ReturnType<typeof createMockDb>;
  let repo: ReturnType<typeof createVoucherRepository>;

  beforeEach(() => {
    db = createMockDb();
    repo = createVoucherRepository(db);
  });

  describe('issue', () => {
    it('issues a voucher when under the limit', async () => {
      // Active vouchers query returns empty (under limit)
      db._chain.where.mockResolvedValueOnce([]);
      db._chain.returning.mockResolvedValueOnce([mockVoucher]);

      const result = await repo.issue(ISSUER_ID);

      expect(db.transaction).toHaveBeenCalled();
      expect(result).toEqual(mockVoucher);
    });

    it('returns null when at the voucher limit', async () => {
      // Active vouchers query returns 5 items (at limit)
      const fiveVouchers = Array.from({ length: 5 }, () => mockVoucher);
      db._chain.where.mockResolvedValueOnce(fiveVouchers);

      const result = await repo.issue(ISSUER_ID);

      expect(result).toBeNull();
    });

    it('passes serializable isolation level to transaction', async () => {
      db._chain.where.mockResolvedValueOnce([]);
      db._chain.returning.mockResolvedValueOnce([mockVoucher]);

      await repo.issue(ISSUER_ID);

      expect(db.transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'serializable',
      });
    });
  });

  describe('redeem', () => {
    it('redeems a valid voucher', async () => {
      const redeemed = {
        ...mockVoucher,
        redeemedBy: REDEEMER_ID,
        redeemedAt: new Date(),
      };
      db._chain.returning.mockResolvedValueOnce([redeemed]);

      const result = await repo.redeem(mockVoucher.code, REDEEMER_ID);

      expect(db.update).toHaveBeenCalled();
      expect(result).toEqual(redeemed);
    });

    it('returns null when voucher not found or already redeemed', async () => {
      db._chain.returning.mockResolvedValueOnce([]);

      const result = await repo.redeem('nonexistent-code', REDEEMER_ID);

      expect(result).toBeNull();
    });

    it('uses a single UPDATE (no SELECT)', async () => {
      db._chain.returning.mockResolvedValueOnce([]);

      await repo.redeem(mockVoucher.code, REDEEMER_ID);

      // Should call update directly, not select-then-update
      expect(db.update).toHaveBeenCalled();
      expect(db.select).not.toHaveBeenCalled();
    });
  });

  describe('findByCode', () => {
    it('returns voucher when found', async () => {
      db._chain.limit.mockResolvedValueOnce([mockVoucher]);

      const result = await repo.findByCode(mockVoucher.code);

      expect(db.select).toHaveBeenCalled();
      expect(result).toEqual(mockVoucher);
    });

    it('returns null when not found', async () => {
      db._chain.limit.mockResolvedValueOnce([]);

      const result = await repo.findByCode('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('listActiveByIssuer', () => {
    it('returns active vouchers for the issuer', async () => {
      db._chain.where.mockResolvedValueOnce([mockVoucher]);

      const result = await repo.listActiveByIssuer(ISSUER_ID);

      expect(db.select).toHaveBeenCalled();
      expect(result).toEqual([mockVoucher]);
    });

    it('returns empty array when no active vouchers', async () => {
      db._chain.where.mockResolvedValueOnce([]);

      const result = await repo.listActiveByIssuer(ISSUER_ID);

      expect(result).toEqual([]);
    });
  });
});
