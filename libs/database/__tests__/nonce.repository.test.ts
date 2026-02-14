import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../src/db.js';
import { createNonceRepository } from '../src/repositories/nonce.repository.js';

function createMockDb() {
  const mockChain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
  };

  const db = {
    insert: vi.fn().mockReturnValue(mockChain),
    delete: vi.fn().mockReturnValue(mockChain),
    _chain: mockChain,
  };

  return db as unknown as Database & { _chain: typeof mockChain };
}

describe('createNonceRepository', () => {
  let db: ReturnType<typeof createMockDb>;
  let repo: ReturnType<typeof createNonceRepository>;

  beforeEach(() => {
    db = createMockDb();
    repo = createNonceRepository(db);
  });

  describe('consume', () => {
    it('returns true when nonce is fresh (first use)', async () => {
      db._chain.returning.mockResolvedValueOnce([{ nonce: 'abc123' }]);

      const result = await repo.consume(
        'abc123',
        new Date(Date.now() + 300_000),
      );

      expect(result).toBe(true);
      expect(db.insert).toHaveBeenCalled();
    });

    it('returns false when nonce is replayed (conflict)', async () => {
      db._chain.returning.mockResolvedValueOnce([]);

      const result = await repo.consume(
        'abc123',
        new Date(Date.now() + 300_000),
      );

      expect(result).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('deletes expired nonces', async () => {
      await repo.cleanup();

      expect(db.delete).toHaveBeenCalled();
      expect(db._chain.where).toHaveBeenCalled();
    });
  });
});
