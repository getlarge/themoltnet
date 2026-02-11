import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../src/db.js';
import {
  createDrizzleTransactionRunner,
  getExecutor,
} from '../src/transaction-context.js';

describe('transaction-context', () => {
  describe('getExecutor', () => {
    it('returns the fallback db when no ALS context is active', () => {
      const db = { __test: 'db' } as unknown as Database;
      expect(getExecutor(db)).toBe(db);
    });

    it('returns the ALS-stored tx inside a transaction', async () => {
      const db = {
        transaction: vi.fn().mockImplementation((fn) => fn({ __test: 'tx' })),
      } as unknown as Database;

      const runner = createDrizzleTransactionRunner(db);

      let captured: unknown;
      await runner.runInTransaction(async () => {
        captured = getExecutor(db);
      });

      // Inside the transaction, getExecutor should return the tx, not db
      expect(captured).not.toBe(db);
      expect((captured as Record<string, string>).__test).toBe('tx');
    });
  });

  describe('createDrizzleTransactionRunner', () => {
    it('wraps callback in db.transaction', async () => {
      const mockTx = { __test: 'tx' };
      const db = {
        transaction: vi.fn().mockImplementation((fn) => fn(mockTx)),
      } as unknown as Database;

      const runner = createDrizzleTransactionRunner(db);
      const result = await runner.runInTransaction(async () => 'ok');

      expect(db.transaction).toHaveBeenCalledOnce();
      expect(result).toBe('ok');
    });

    it('rolls back on callback error', async () => {
      const db = {
        transaction: vi.fn().mockImplementation((fn) => fn({ __test: 'tx' })),
      } as unknown as Database;

      const runner = createDrizzleTransactionRunner(db);

      await expect(
        runner.runInTransaction(async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
    });

    it('ALS context is cleared after transaction completes', async () => {
      const db = {
        transaction: vi.fn().mockImplementation((fn) => fn({ __test: 'tx' })),
      } as unknown as Database;

      const runner = createDrizzleTransactionRunner(db);

      await runner.runInTransaction(async () => {
        // Inside transaction, executor should be tx
        expect(getExecutor(db)).not.toBe(db);
      });

      // After transaction, executor should fall back to db
      expect(getExecutor(db)).toBe(db);
    });
  });
});
