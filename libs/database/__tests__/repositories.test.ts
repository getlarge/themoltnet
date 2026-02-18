import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../src/db.js';
import { createAgentRepository } from '../src/repositories/agent.repository.js';
import { createDiaryRepository } from '../src/repositories/diary.repository.js';
import type { AgentKey, DiaryEntry } from '../src/schema.js';

// Helper to create a mock Drizzle database
function createMockDb() {
  const mockChain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    then: vi
      .fn()
      .mockImplementation((resolve?: (v: unknown) => unknown) =>
        Promise.resolve([]).then(resolve),
      ),
    catch: vi.fn().mockReturnThis(),
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

const AGENT_ID = '550e8400-e29b-41d4-a716-446655440000';
const ENTRY_ID = '660e8400-e29b-41d4-a716-446655440001';

const mockAgent: AgentKey = {
  identityId: AGENT_ID,
  publicKey: 'ed25519:dGVzdA==',
  fingerprint: 'A1B2-C3D4-E5F6-07A8',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockEntry: DiaryEntry = {
  id: ENTRY_ID,
  ownerId: AGENT_ID,
  title: 'Test Entry',
  content: 'Hello world',
  embedding: null,
  visibility: 'private',
  tags: ['test'],
  injectionRisk: false,
  importance: 5,
  accessCount: 0,
  lastAccessedAt: null,
  entryType: 'semantic',
  supersededBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('createAgentRepository', () => {
  let db: ReturnType<typeof createMockDb>;
  let repo: ReturnType<typeof createAgentRepository>;

  beforeEach(() => {
    db = createMockDb();
    repo = createAgentRepository(db);
  });

  it('upsert inserts an agent and returns the result', async () => {
    db._chain.returning.mockResolvedValue([mockAgent]);

    const result = await repo.upsert({
      identityId: AGENT_ID,
      publicKey: 'ed25519:dGVzdA==',
      fingerprint: 'A1B2-C3D4-E5F6-07A8',
    });

    expect(db.insert).toHaveBeenCalled();
    expect(result).toEqual(mockAgent);
  });

  it('findByIdentityId returns agent when found', async () => {
    db._chain.limit.mockResolvedValue([mockAgent]);

    const result = await repo.findByIdentityId(AGENT_ID);

    expect(db.select).toHaveBeenCalled();
    expect(result).toEqual(mockAgent);
  });

  it('findByIdentityId returns null when not found', async () => {
    db._chain.limit.mockResolvedValue([]);

    const result = await repo.findByIdentityId('nonexistent');
    expect(result).toBeNull();
  });

  it('findByFingerprint returns agent when found', async () => {
    db._chain.limit.mockResolvedValue([mockAgent]);

    const result = await repo.findByFingerprint('A1B2-C3D4-E5F6-07A8');
    expect(result).toEqual(mockAgent);
  });

  it('delete returns true when agent deleted', async () => {
    db._chain.returning.mockResolvedValue([{ identityId: AGENT_ID }]);

    const result = await repo.delete(AGENT_ID);
    expect(result).toBe(true);
  });

  it('delete returns false when agent not found', async () => {
    db._chain.returning.mockResolvedValue([]);

    const result = await repo.delete('nonexistent');
    expect(result).toBe(false);
  });
});

describe('createDiaryRepository', () => {
  let db: ReturnType<typeof createMockDb>;
  let repo: ReturnType<typeof createDiaryRepository>;

  beforeEach(() => {
    db = createMockDb();
    repo = createDiaryRepository(db);
  });

  it('create inserts an entry and returns it', async () => {
    db._chain.returning.mockResolvedValue([mockEntry]);

    const result = await repo.create({
      ownerId: AGENT_ID,
      content: 'Hello world',
      title: 'Test Entry',
    });

    expect(db.insert).toHaveBeenCalled();
    expect(result).toEqual(mockEntry);
  });

  it('findById returns entry by ID', async () => {
    db._chain.limit.mockResolvedValue([mockEntry]);

    const result = await repo.findById(ENTRY_ID);
    expect(result).toEqual(mockEntry);
  });

  it('findById returns null when entry not found', async () => {
    db._chain.limit.mockResolvedValue([]);

    const result = await repo.findById('nonexistent');
    expect(result).toBeNull();
  });

  it('list calls select with ownerId', async () => {
    db._chain.offset.mockResolvedValue([mockEntry]);

    const result = await repo.list({ ownerId: AGENT_ID });
    expect(db.select).toHaveBeenCalled();
    expect(result).toEqual([mockEntry]);
  });

  it('update returns updated entry', async () => {
    const updated = { ...mockEntry, title: 'Updated' };
    db._chain.returning.mockResolvedValue([updated]);

    const result = await repo.update(ENTRY_ID, { title: 'Updated' });
    expect(db.update).toHaveBeenCalled();
    expect(result).toEqual(updated);
  });

  it('update returns null when entry not found', async () => {
    db._chain.returning.mockResolvedValue([]);

    const result = await repo.update(ENTRY_ID, { title: 'Hacked' });
    expect(result).toBeNull();
  });

  it('delete returns true when entry deleted', async () => {
    db._chain.returning.mockResolvedValue([{ id: ENTRY_ID }]);

    const result = await repo.delete(ENTRY_ID);
    expect(result).toBe(true);
  });

  it('delete returns false when entry not found', async () => {
    db._chain.returning.mockResolvedValue([]);

    const result = await repo.delete(ENTRY_ID);
    expect(result).toBe(false);
  });

  it('share creates share record and returns true when inserted', async () => {
    db._chain.returning.mockResolvedValueOnce([{ entryId: ENTRY_ID }]);
    const result = await repo.share(ENTRY_ID, AGENT_ID, 'other-agent');
    expect(result).toBe(true);
    expect(db.insert).toHaveBeenCalled();
  });

  it('share returns false when record already exists', async () => {
    db._chain.returning.mockResolvedValueOnce([]);
    const result = await repo.share(ENTRY_ID, AGENT_ID, 'other-agent');
    expect(result).toBe(false);
  });

  it('getSharedWithMe returns empty array when no shares', async () => {
    db._chain.limit.mockResolvedValue([]);

    const result = await repo.getSharedWithMe('some-agent');
    expect(result).toEqual([]);
  });
});
