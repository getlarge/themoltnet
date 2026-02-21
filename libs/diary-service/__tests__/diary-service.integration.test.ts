/**
 * DiaryService Integration Tests
 *
 * Tests the diary service layer wired with a real DiaryRepository
 * against PostgreSQL + pgvector.
 *
 * Without EMBEDDING_MODEL: uses noop embedding service (text search only).
 * With EMBEDDING_MODEL=true: uses @moltnet/embedding-service for real
 * vector embeddings and hybrid search testing.
 *
 * Start the test database: docker compose --env-file .env.local up -d app-db
 * Run: DATABASE_URL=postgresql://moltnet:moltnet_secret@localhost:5433/moltnet pnpm --filter @moltnet/diary-service test
 * Run with embeddings: DATABASE_URL=... EMBEDDING_MODEL=true pnpm --filter @moltnet/diary-service test
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { createDiaryService, type DiaryService } from '../src/diary-service.js';
import { createNoopEmbeddingService } from '../src/embedding-service.js';
import type {
  AgentLookupRepository,
  DiaryShareRepository,
  EmbeddingService,
  PermissionChecker,
  RelationshipWriter,
} from '../src/types.js';

async function loadEmbeddingService(): Promise<EmbeddingService> {
  if (process.env.EMBEDDING_MODEL !== 'true') {
    return createNoopEmbeddingService();
  }
  const { createEmbeddingService } = await import('@moltnet/embedding-service');
  return createEmbeddingService();
}

// Dynamic import so the test file doesn't fail to parse when
// @moltnet/database is not resolvable (shouldn't happen in this
// monorepo, but keeps the import conditional on DATABASE_URL).
async function setupDatabase(url: string) {
  const {
    createDatabase,
    createDiaryEntryRepository,
    createDiaryRepository,
    diaryEntries,
    diaries,
  } = await import('@moltnet/database');
  const db = createDatabase(url);
  const repo = createDiaryEntryRepository(db);
  const diaryRepo = createDiaryRepository(db);
  return { db, repo, diaryRepo, diaryEntries, diaries };
}

const DATABASE_URL = process.env.DATABASE_URL;

describe.runIf(DATABASE_URL)('DiaryService (integration)', () => {
  let service: DiaryService;
  let db: Awaited<ReturnType<typeof setupDatabase>>['db'];
  let tables: {
    diaryEntries: Awaited<ReturnType<typeof setupDatabase>>['diaryEntries'];
    diaries: Awaited<ReturnType<typeof setupDatabase>>['diaries'];
  };
  let permissions: {
    [K in keyof PermissionChecker]: ReturnType<typeof vi.fn>;
  };
  let relationshipWriter: {
    [K in keyof RelationshipWriter]: ReturnType<typeof vi.fn>;
  };
  let DIARY_ID: string;
  let OTHER_DIARY_ID: string;

  const OWNER_ID = '00000000-0000-4000-b000-000000000001';
  const OTHER_AGENT = '00000000-0000-4000-b000-000000000002';

  beforeAll(async () => {
    const setup = await setupDatabase(DATABASE_URL!);
    db = setup.db;
    tables = {
      diaryEntries: setup.diaryEntries,
      diaries: setup.diaries,
    };

    permissions = {
      canViewEntry: vi.fn().mockResolvedValue(true),
      canEditEntry: vi.fn().mockResolvedValue(true),
      canDeleteEntry: vi.fn().mockResolvedValue(true),
    };

    relationshipWriter = {
      grantOwnership: vi.fn().mockResolvedValue(undefined),
      registerAgent: vi.fn().mockResolvedValue(undefined),
      removeEntryRelations: vi.fn().mockResolvedValue(undefined),
    };

    const embeddingService = await loadEmbeddingService();

    service = createDiaryService({
      diaryRepository: setup.diaryRepo,
      diaryShareRepository: {
        create: vi.fn(),
        findById: vi.fn(),
        findByDiaryAndAgent: vi.fn(),
        listByDiary: vi.fn(),
        listPendingForAgent: vi.fn(),
        updateStatus: vi.fn(),
      } as unknown as DiaryShareRepository,
      agentRepository: {
        findByFingerprint: vi.fn(),
      } as unknown as AgentLookupRepository,
      diaryEntryRepository: setup.repo,
      permissionChecker: permissions as unknown as PermissionChecker,
      relationshipWriter: relationshipWriter as unknown as RelationshipWriter,
      embeddingService,
      transactionRunner: {
        runInTransaction: async (fn) => fn(),
      },
    });

    // Create test diary containers so diary_entries FK constraint is satisfied
    const diary = await setup.diaryRepo.create({
      ownerId: OWNER_ID,
      name: 'Test Diary',
      visibility: 'private',
    });
    DIARY_ID = diary.id;

    const otherDiary = await setup.diaryRepo.create({
      ownerId: OTHER_AGENT,
      name: 'Other Test Diary',
      visibility: 'private',
    });
    OTHER_DIARY_ID = otherDiary.id;
  });

  afterEach(async () => {
    await db.delete(tables.diaryEntries);
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await db.delete(tables.diaryEntries);
    await db.delete(tables.diaries);
  });

  // ── Create ──────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates entry and grants ownership', async () => {
      const entry = await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'My first diary entry about MoltNet.',
      });

      expect(entry.id).toBeDefined();
      expect(entry.diaryId).toBe(DIARY_ID);
      expect(entry.content).toBe('My first diary entry about MoltNet.');
      expect(relationshipWriter.grantOwnership).toHaveBeenCalledWith(
        entry.id,
        OWNER_ID,
      );
    });

    it('creates entry with all fields', async () => {
      const entry = await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'Learning about Ed25519 signatures.',
        title: 'Crypto Day',
        tags: ['crypto', 'learning'],
      });

      expect(entry.title).toBe('Crypto Day');
      expect(entry.tags).toEqual(['crypto', 'learning']);
    });

    it('creates entry without embedding when noop service is used', async () => {
      if (process.env.EMBEDDING_MODEL === 'true') return;

      const entry = await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'No embedding here.',
      });

      expect(entry.embedding).toBeNull();
    });

    it('creates entry with embedding when real service is used', async () => {
      if (process.env.EMBEDDING_MODEL !== 'true') return;

      const entry = await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'Ed25519 cryptographic identity for autonomous agents.',
      });

      expect(entry.embedding).not.toBeNull();
      expect(entry.embedding).toHaveLength(384);
    });
  });

  // ── Read ────────────────────────────────────────────────────────────

  describe('getById', () => {
    it('returns entry when Keto allows', async () => {
      const created = await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'Private thought.',
      });

      permissions.canViewEntry.mockResolvedValue(true);
      const found = await service.getById(created.id, OWNER_ID);
      expect(found).not.toBeNull();
      expect(found!.content).toBe('Private thought.');
    });

    it('returns null when Keto denies', async () => {
      const created = await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'Secret entry.',
      });

      permissions.canViewEntry.mockResolvedValue(false);
      const found = await service.getById(created.id, OTHER_AGENT);
      expect(found).toBeNull();
    });
  });

  // ── List ────────────────────────────────────────────────────────────

  describe('list', () => {
    it('lists entries for a diary', async () => {
      await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'Entry 1.',
      });
      await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'Entry 2.',
      });
      await service.create({
        requesterId: OTHER_AGENT,
        diaryId: OTHER_DIARY_ID,
        content: 'Not mine.',
      });

      const entries = await service.list({ diaryId: DIARY_ID });

      expect(entries.length).toBe(2);
      expect(entries.every((e) => e.diaryId === DIARY_ID)).toBe(true);
    });
  });

  // ── Search ──────────────────────────────────────────────────────────

  describe('search', () => {
    it('searches by text query', async () => {
      await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'Cryptographic key exchange protocols are fascinating.',
      });
      await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'The weather is sunny today.',
      });

      const results = await service.search({
        diaryId: DIARY_ID,
        query: 'cryptographic protocols',
      });

      expect(results.length).toBe(1);
      expect(results[0].content).toContain('Cryptographic');
    });

    it('returns all entries when no query is provided', async () => {
      await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'A.',
      });
      await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'B.',
      });

      const results = await service.search({ diaryId: DIARY_ID });
      expect(results.length).toBe(2);
    });

    it('finds semantically similar entries via hybrid search', async () => {
      if (process.env.EMBEDDING_MODEL !== 'true') return;

      await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content:
          'Ed25519 is an elliptic curve digital signature algorithm used for cryptographic identity verification.',
      });
      await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'I had pasta with tomato sauce for dinner last night.',
      });

      const results = await service.search({
        diaryId: DIARY_ID,
        query: 'public key cryptography and digital signatures',
      });

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].content).toContain('Ed25519');
    });
  });

  // ── Update ──────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates entry fields when Keto allows', async () => {
      const created = await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'Original.',
      });

      permissions.canEditEntry.mockResolvedValue(true);
      const updated = await service.update(created.id, OWNER_ID, {
        title: 'Updated Title',
        content: 'New content.',
      });

      expect(updated).not.toBeNull();
      expect(updated!.title).toBe('Updated Title');
      expect(updated!.content).toBe('New content.');
    });

    it('returns null when Keto denies edit', async () => {
      const created = await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'Protected.',
      });

      permissions.canEditEntry.mockResolvedValue(false);
      const result = await service.update(created.id, OTHER_AGENT, {
        title: 'Hacked',
      });

      expect(result).toBeNull();
    });
  });

  // ── Delete ──────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes entry and removes permission relations when Keto allows', async () => {
      const created = await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'To delete.',
      });

      permissions.canDeleteEntry.mockResolvedValue(true);
      const deleted = await service.delete(created.id, OWNER_ID);
      expect(deleted).toBe(true);
      expect(relationshipWriter.removeEntryRelations).toHaveBeenCalledWith(
        created.id,
      );

      permissions.canViewEntry.mockResolvedValue(true);
      const found = await service.getById(created.id, OWNER_ID);
      expect(found).toBeNull();
    });

    it('returns false when Keto denies delete', async () => {
      const created = await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'Protected.',
      });

      permissions.canDeleteEntry.mockResolvedValue(false);
      const deleted = await service.delete(created.id, OTHER_AGENT);
      expect(deleted).toBe(false);
      expect(relationshipWriter.removeEntryRelations).not.toHaveBeenCalled();
    });
  });

  // ── Reflect ─────────────────────────────────────────────────────────

  describe('reflect', () => {
    it('generates digest from recent entries', async () => {
      await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'Day 1: Started learning about MoltNet.',
        tags: ['learning'],
      });
      await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'Day 2: Registered my first identity.',
        tags: ['identity'],
      });

      const digest = await service.reflect({ diaryId: DIARY_ID });

      expect(digest.totalEntries).toBe(2);
      expect(digest.periodDays).toBe(7);
      expect(digest.generatedAt).toBeDefined();
      expect(digest.entries.length).toBe(2);
      expect(digest.entries[0].content).toContain('Day 2');
    });

    it('returns empty digest when no entries exist', async () => {
      const digest = await service.reflect({ diaryId: DIARY_ID });

      expect(digest.totalEntries).toBe(0);
      expect(digest.entries.length).toBe(0);
    });
  });
});
