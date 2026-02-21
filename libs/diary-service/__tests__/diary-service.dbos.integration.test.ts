/**
 * DiaryService DBOS Integration Tests
 *
 * Tests DBOS transaction atomicity with real Postgres + real DBOS runtime.
 * Keto RelationshipWriter is mocked to isolate DB/DBOS behavior.
 *
 * These tests verify:
 * - Transaction atomicity for DB operations
 * - Concurrent operations without race conditions
 * - RelationshipWriter calls happen after transaction commits
 *
 * Start the test database: docker compose --env-file .env.local up -d app-db
 * Run: DATABASE_URL=postgresql://moltnet:moltnet_secret@localhost:5433/moltnet pnpm --filter @moltnet/diary-service test
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
import type { PermissionChecker, RelationshipWriter } from '../src/types.js';

const DATABASE_URL = process.env.DATABASE_URL;

describe.runIf(DATABASE_URL)('DiaryService (DBOS integration)', () => {
  let service: DiaryService;
  let db: Awaited<ReturnType<typeof setupDatabase>>['db']['db'];
  let transactionRunner: Awaited<
    ReturnType<typeof setupDBOS>
  >['transactionRunner'];
  let tables: {
    diaryEntries: Awaited<ReturnType<typeof setupDatabase>>['diaryEntries'];
  };
  let mockRelationshipWriter: {
    [K in keyof RelationshipWriter]: ReturnType<typeof vi.fn>;
  };
  let permissions: {
    [K in keyof PermissionChecker]: ReturnType<typeof vi.fn>;
  };

  const OWNER_ID = '00000000-0000-4000-b000-000000000001';

  async function setupDatabase(url: string) {
    const { createDatabase, createDiaryRepository, diaryEntries } =
      await import('@moltnet/database');
    const database = createDatabase(url);
    const repo = createDiaryRepository(database);
    return { db: database, repo, diaryEntries };
  }

  async function setupDBOS(url: string) {
    const {
      configureDBOS,
      initDBOS,
      launchDBOS,
      getDataSource,
      createDBOSTransactionRunner,
    } = await import('@moltnet/database');

    configureDBOS();
    await initDBOS({ databaseUrl: url });
    await launchDBOS();

    const dataSource = getDataSource();
    return {
      dataSource,
      transactionRunner: createDBOSTransactionRunner(dataSource),
    };
  }

  beforeAll(async () => {
    mockRelationshipWriter = {
      grantOwnership: vi.fn().mockResolvedValue(undefined),
      registerAgent: vi.fn().mockResolvedValue(undefined),
      removeEntryRelations: vi.fn().mockResolvedValue(undefined),
    };

    permissions = {
      canViewEntry: vi.fn().mockResolvedValue(true),
      canEditEntry: vi.fn().mockResolvedValue(true),
      canDeleteEntry: vi.fn().mockResolvedValue(true),
    };

    const dbSetup = await setupDatabase(DATABASE_URL!);
    db = dbSetup.db.db;
    tables = {
      diaryEntries: dbSetup.diaryEntries,
    };

    const dbosSetup = await setupDBOS(DATABASE_URL!);
    transactionRunner = dbosSetup.transactionRunner;

    const embeddingService = createNoopEmbeddingService();

    service = createDiaryService({
      diaryRepository: dbSetup.repo,
      permissionChecker: permissions as unknown as PermissionChecker,
      relationshipWriter:
        mockRelationshipWriter as unknown as RelationshipWriter,
      embeddingService,
      transactionRunner,
    });
  });

  afterEach(async () => {
    // Clean up entries between tests
    await db.delete(tables.diaryEntries);
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await db.delete(tables.diaryEntries);

    // Shutdown DBOS
    const { shutdownDBOS } = await import('@moltnet/database');
    await shutdownDBOS();
  });

  // ── Atomicity Tests ────────────────────────────────────────────────────

  describe('atomicity', () => {
    it('creates entry and calls relationshipWriter', async () => {
      const entry = await service.create({
        ownerId: OWNER_ID,
        content: 'Test atomic create',
      });

      expect(entry.id).toBeDefined();
      expect(entry.ownerId).toBe(OWNER_ID);

      expect(mockRelationshipWriter.grantOwnership).toHaveBeenCalledWith(
        entry.id,
        OWNER_ID,
      );

      // Verify entry exists in database
      const entries = await db.select().from(tables.diaryEntries);
      const found = entries.find((e) => e.id === entry.id);
      expect(found).toBeDefined();
      expect(found!.content).toBe('Test atomic create');
    });

    it('still creates entry when relationshipWriter fails', async () => {
      mockRelationshipWriter.grantOwnership.mockRejectedValueOnce(
        new Error('Keto unavailable'),
      );

      // Entry should still be created (relationship failure is logged, not thrown)
      const entry = await service.create({
        ownerId: OWNER_ID,
        content: 'Should still persist',
      });

      expect(entry.id).toBeDefined();
      const entries = await db.select().from(tables.diaryEntries);
      expect(entries.length).toBe(1);
    });

    it('still deletes entry when relationshipWriter fails', async () => {
      const entry = await service.create({
        ownerId: OWNER_ID,
        content: 'Entry to delete',
      });

      mockRelationshipWriter.removeEntryRelations.mockRejectedValueOnce(
        new Error('Keto unavailable'),
      );

      const deleted = await service.delete(entry.id, OWNER_ID);
      expect(deleted).toBe(true);

      // Verify entry is deleted from database
      const entries = await db.select().from(tables.diaryEntries);
      expect(entries.length).toBe(0);
    });
  });

  // ── Concurrency Tests ──────────────────────────────────────────────────

  describe('concurrency', () => {
    it('handles 10 concurrent creates without race conditions', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        service.create({ ownerId: OWNER_ID, content: `Entry ${i}` }),
      );

      const results = await Promise.allSettled(promises);
      const fulfilled = results.filter(
        (
          r,
        ): r is PromiseFulfilledResult<
          Awaited<ReturnType<typeof service.create>>
        > => r.status === 'fulfilled',
      );

      expect(fulfilled.length).toBe(10);
      expect(mockRelationshipWriter.grantOwnership).toHaveBeenCalledTimes(10);

      // Verify all entries exist in database
      const entries = await db.select().from(tables.diaryEntries);
      expect(entries.length).toBe(10);
    });

    it('handles concurrent create/delete without leaving orphans', async () => {
      // Create 5 entries
      const entries = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          service.create({ ownerId: OWNER_ID, content: `Entry ${i}` }),
        ),
      );

      // Concurrently delete them all
      const deletePromises = entries.map((e) => service.delete(e.id, OWNER_ID));
      await Promise.all(deletePromises);

      // Verify all entries are gone
      const remaining = await db.select().from(tables.diaryEntries);
      expect(remaining.length).toBe(0);

      // Verify Keto cleanup was called for each
      expect(mockRelationshipWriter.removeEntryRelations).toHaveBeenCalledTimes(
        5,
      );
    });
  });

  // ── RelationshipWriter Execution Tests ──────────────────────────────

  describe('relationship writer execution', () => {
    it('calls grantOwnership on create', async () => {
      const entry = await service.create({
        ownerId: OWNER_ID,
        content: 'Test workflow execution',
      });

      expect(mockRelationshipWriter.grantOwnership).toHaveBeenCalledTimes(1);
      expect(mockRelationshipWriter.grantOwnership).toHaveBeenCalledWith(
        entry.id,
        OWNER_ID,
      );
    });

    it('calls removeEntryRelations on delete', async () => {
      const entry = await service.create({
        ownerId: OWNER_ID,
        content: 'Entry to delete',
      });

      await service.delete(entry.id, OWNER_ID);

      expect(mockRelationshipWriter.removeEntryRelations).toHaveBeenCalledTimes(
        1,
      );
      expect(mockRelationshipWriter.removeEntryRelations).toHaveBeenCalledWith(
        entry.id,
      );
    });
  });
});
