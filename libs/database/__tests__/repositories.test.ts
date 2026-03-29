import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../src/db.js';
import { createAgentRepository } from '../src/repositories/agent.repository.js';
import { createContextPackRepository } from '../src/repositories/context-pack.repository.js';
import { createDiaryRepository } from '../src/repositories/diary.repository.js';
import { createDiaryEntryRepository } from '../src/repositories/diary-entry.repository.js';
import { createEntryRelationRepository } from '../src/repositories/entry-relation.repository.js';
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
const PACK_ID = '770e8400-e29b-41d4-a716-446655440002';
const RELATION_ID = '880e8400-e29b-41d4-a716-446655440003';

const mockAgent: AgentKey = {
  identityId: AGENT_ID,
  publicKey: 'ed25519:dGVzdA==',
  fingerprint: 'A1B2-C3D4-E5F6-07A8',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockEntry: DiaryEntry = {
  id: ENTRY_ID,
  diaryId: '770e8400-e29b-41d4-a716-446655440003',
  createdBy: AGENT_ID,
  title: 'Test Entry',
  content: 'Hello world',
  embedding: null,
  tags: ['test'],
  injectionRisk: false,
  importance: 5,
  accessCount: 0,
  lastAccessedAt: null,
  entryType: 'semantic',
  contentHash: null,
  contentSignature: null,
  signingNonce: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockRelation = {
  id: RELATION_ID,
  sourceId: ENTRY_ID,
  targetId: '990e8400-e29b-41d4-a716-446655440004',
  relation: 'references' as const,
  status: 'proposed' as const,
  sourceCidSnapshot: 'bafk-source',
  targetCidSnapshot: 'bafk-target',
  workflowId: 'context.consolidate',
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPack = {
  id: PACK_ID,
  diaryId: 'aa0e8400-e29b-41d4-a716-446655440005',
  packCid: 'bafy-pack',
  packCodec: 'dag-cbor',
  payload: {},
  taskPromptHash: 'task-hash',
  tokenBudget: 4000,
  lambda: 0.5,
  wRecency: 0.3,
  wImportance: 0.2,
  createdBy: AGENT_ID,
  supersedesPackId: null,
  pinned: false,
  expiresAt: new Date(Date.now() + 60_000),
  createdAt: new Date(),
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
});

describe('createEntryRelationRepository', () => {
  let db: ReturnType<typeof createMockDb>;
  let repo: ReturnType<typeof createEntryRelationRepository>;

  beforeEach(() => {
    db = createMockDb();
    repo = createEntryRelationRepository(db);
  });

  it('create inserts a relation and returns it', async () => {
    db._chain.returning.mockResolvedValue([mockRelation]);

    const result = await repo.create({
      sourceId: mockRelation.sourceId,
      targetId: mockRelation.targetId,
      relation: mockRelation.relation,
      status: mockRelation.status,
    });

    expect(db.insert).toHaveBeenCalled();
    expect(result).toEqual(mockRelation);
  });

  it('findById returns the relation when found', async () => {
    db._chain.limit.mockResolvedValue([mockRelation]);

    const result = await repo.findById(RELATION_ID);

    expect(db.select).toHaveBeenCalled();
    expect(result).toEqual(mockRelation);
  });

  it('findById returns null when relation not found', async () => {
    db._chain.limit.mockResolvedValue([]);

    const result = await repo.findById('nonexistent');

    expect(result).toBeNull();
  });

  it('listByEntry returns { items, total } shape', async () => {
    db._chain.offset.mockResolvedValue([mockRelation]);

    const result = await repo.listByEntry(ENTRY_ID, { limit: 1 });

    expect(db.select).toHaveBeenCalled();
    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('total');
    expect(result.items).toEqual([mockRelation]);
  });

  it('listByEntry with direction as_source only queries source relations', async () => {
    db._chain.offset.mockResolvedValue([mockRelation]);

    const result = await repo.listByEntry(ENTRY_ID, {
      direction: 'as_source',
    });

    expect(db.select).toHaveBeenCalled();
    expect(result.items).toEqual([mockRelation]);
  });

  it('updateStatus returns the updated relation', async () => {
    const updated = { ...mockRelation, status: 'accepted' as const };
    db._chain.returning.mockResolvedValue([updated]);

    const result = await repo.updateStatus(mockRelation.id, 'accepted');

    expect(db.update).toHaveBeenCalled();
    expect(result).toEqual(updated);
  });
});

describe('createDiaryEntryRepository — findByIds', () => {
  let db: ReturnType<typeof createMockDb>;
  let repo: ReturnType<typeof createDiaryEntryRepository>;

  const DIARY_ID_A = '770e8400-e29b-41d4-a716-446655440003';

  beforeEach(() => {
    db = createMockDb();
    repo = createDiaryEntryRepository(db);
  });

  it('findByIds returns matching entries with id and diaryId', async () => {
    const rows = [{ id: ENTRY_ID, diaryId: DIARY_ID_A }];
    db._chain.where.mockResolvedValue(rows);

    const result = await repo.findByIds([ENTRY_ID]);

    expect(db.select).toHaveBeenCalled();
    expect(result).toEqual(rows);
  });

  it('findByIds returns empty array when ids list is empty', async () => {
    const result = await repo.findByIds([]);

    expect(db.select).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('findByIds returns empty array when no entries match', async () => {
    db._chain.where.mockResolvedValue([]);

    const result = await repo.findByIds(['nonexistent-id']);

    expect(result).toEqual([]);
  });
});

describe('createContextPackRepository', () => {
  let db: ReturnType<typeof createMockDb>;
  let repo: ReturnType<typeof createContextPackRepository>;

  beforeEach(() => {
    db = createMockDb();
    repo = createContextPackRepository(db);
  });

  it('createPack inserts a pack and returns it', async () => {
    db._chain.returning.mockResolvedValue([mockPack]);

    const result = await repo.createPack({
      diaryId: mockPack.diaryId,
      packCid: mockPack.packCid,
      tokenBudget: mockPack.tokenBudget,
      payload: mockPack.payload,
      createdBy: mockPack.createdBy,
    });

    expect(db.insert).toHaveBeenCalled();
    expect(result).toEqual(mockPack);
  });

  it('pin clears expiry and returns the updated pack', async () => {
    const pinned = { ...mockPack, pinned: true, expiresAt: null };
    db._chain.returning.mockResolvedValue([pinned]);

    const result = await repo.pin(mockPack.id);

    expect(db.update).toHaveBeenCalled();
    expect(result).toEqual(pinned);
  });

  it('listEntries returns membership rows ordered by rank', async () => {
    const membership = {
      id: 'bb0e8400-e29b-41d4-a716-446655440006',
      packId: PACK_ID,
      entryId: ENTRY_ID,
      entryCidSnapshot: 'bafk-entry',
      compressionLevel: 'summary' as const,
      originalTokens: 100,
      packedTokens: 30,
      rank: 1,
      createdAt: new Date(),
    };
    db._chain.orderBy.mockResolvedValue([membership]);

    const result = await repo.listEntries(PACK_ID);

    expect(db.select).toHaveBeenCalled();
    expect(result).toEqual([membership]);
  });
});
