/**
 * DiaryService DBOS Integration Tests
 *
 * Tests DBOS transaction atomicity with real Postgres + real DBOS runtime.
 * Keto is mocked to isolate DB/DBOS behavior.
 *
 * These tests verify:
 * - Workflow scheduling happens atomically with DB operations
 * - Transaction rollback when workflow step fails
 * - Concurrent operations without race conditions
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
import type { PermissionChecker } from '../src/types.js';

const DATABASE_URL = process.env.DATABASE_URL;

describe.runIf(DATABASE_URL)('DiaryService (DBOS integration)', () => {
  let service: DiaryService;
  let db: Awaited<ReturnType<typeof setupDatabase>>['db']['db'];
  let transactionRunner: Awaited<
    ReturnType<typeof setupDBOS>
  >['transactionRunner'];
  let tables: {
    diaryEntries: Awaited<ReturnType<typeof setupDatabase>>['diaryEntries'];
    entryShares: Awaited<ReturnType<typeof setupDatabase>>['entryShares'];
  };
  let mockKetoWriter: {
    grantOwnership: ReturnType<typeof vi.fn>;
    grantViewer: ReturnType<typeof vi.fn>;
    revokeViewer: ReturnType<typeof vi.fn>;
    registerAgent: ReturnType<typeof vi.fn>;
    removeEntryRelations: ReturnType<typeof vi.fn>;
  };
  let permissions: {
    [K in keyof PermissionChecker]: ReturnType<typeof vi.fn>;
  };

  const OWNER_ID = '00000000-0000-4000-b000-000000000001';
  const OTHER_AGENT = '00000000-0000-4000-b000-000000000002';

  async function setupDatabase(url: string) {
    const { createDatabase, createDiaryRepository, diaryEntries, entryShares } =
      await import('@moltnet/database');
    const database = createDatabase(url);
    const repo = createDiaryRepository(database);
    return { db: database, repo, diaryEntries, entryShares };
  }

  async function setupDBOS(url: string) {
    const {
      configureDBOS,
      initDBOS,
      initKetoWorkflows,
      launchDBOS,
      setKetoRelationshipWriter,
      getDataSource,
      createDBOSTransactionRunner,
    } = await import('@moltnet/database');

    // Initialize DBOS in correct order
    configureDBOS();
    initKetoWorkflows();
    setKetoRelationshipWriter(mockKetoWriter);
    await initDBOS({ databaseUrl: url });
    await launchDBOS();

    const dataSource = getDataSource();
    return {
      dataSource,
      transactionRunner: createDBOSTransactionRunner(dataSource),
    };
  }

  beforeAll(async () => {
    // Set up mock Keto writer before DBOS initialization
    mockKetoWriter = {
      grantOwnership: vi.fn().mockResolvedValue(undefined),
      grantViewer: vi.fn().mockResolvedValue(undefined),
      revokeViewer: vi.fn().mockResolvedValue(undefined),
      registerAgent: vi.fn().mockResolvedValue(undefined),
      removeEntryRelations: vi.fn().mockResolvedValue(undefined),
    };

    // Permission checker for pre-operation checks
    permissions = {
      canViewEntry: vi.fn().mockResolvedValue(true),
      canEditEntry: vi.fn().mockResolvedValue(true),
      canDeleteEntry: vi.fn().mockResolvedValue(true),
      canShareEntry: vi.fn().mockResolvedValue(true),
      grantOwnership: vi.fn().mockResolvedValue(undefined),
      grantViewer: vi.fn().mockResolvedValue(undefined),
      revokeViewer: vi.fn().mockResolvedValue(undefined),
      removeEntryRelations: vi.fn().mockResolvedValue(undefined),
    };

    const dbSetup = await setupDatabase(DATABASE_URL!);
    db = dbSetup.db.db;
    tables = {
      diaryEntries: dbSetup.diaryEntries,
      entryShares: dbSetup.entryShares,
    };

    const dbosSetup = await setupDBOS(DATABASE_URL!);
    transactionRunner = dbosSetup.transactionRunner;

    const embeddingService = createNoopEmbeddingService();

    service = createDiaryService({
      diaryRepository: dbSetup.repo,
      permissionChecker: permissions as unknown as PermissionChecker,
      embeddingService,
      transactionRunner,
    });
  });

  afterEach(async () => {
    // Clean up entries between tests
    await db.delete(tables.entryShares);
    await db.delete(tables.diaryEntries);
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await db.delete(tables.entryShares);
    await db.delete(tables.diaryEntries);

    // Shutdown DBOS
    const { shutdownDBOS } = await import('@moltnet/database');
    await shutdownDBOS();
  });

  // ── Atomicity Tests ────────────────────────────────────────────────────

  describe('atomicity', () => {
    it('creates entry and schedules Keto workflow atomically', async () => {
      const entry = await service.create({
        ownerId: OWNER_ID,
        content: 'Test atomic create',
      });

      expect(entry.id).toBeDefined();
      expect(entry.ownerId).toBe(OWNER_ID);

      // Verify Keto workflow was called
      expect(mockKetoWriter.grantOwnership).toHaveBeenCalledWith(
        entry.id,
        OWNER_ID,
      );

      // Verify entry exists in database
      const entries = await db.select().from(tables.diaryEntries);
      const found = entries.find((e) => e.id === entry.id);
      expect(found).toBeDefined();
      expect(found!.content).toBe('Test atomic create');
    });

    it('rolls back DB when workflow step fails during create', async () => {
      mockKetoWriter.grantOwnership.mockRejectedValueOnce(
        new Error('Keto unavailable'),
      );

      await expect(
        service.create({ ownerId: OWNER_ID, content: 'Should rollback' }),
      ).rejects.toThrow('Keto unavailable');

      // Verify no entry was persisted (rollback worked)
      const entries = await db.select().from(tables.diaryEntries);
      expect(entries.length).toBe(0);
    });

    it('rolls back DB when workflow step fails during delete', async () => {
      // First create an entry successfully
      const entry = await service.create({
        ownerId: OWNER_ID,
        content: 'Entry to delete',
      });

      // Now make the delete workflow fail
      mockKetoWriter.removeEntryRelations.mockRejectedValueOnce(
        new Error('Keto unavailable'),
      );

      await expect(service.delete(entry.id, OWNER_ID)).rejects.toThrow(
        'Keto unavailable',
      );

      // Verify entry still exists (delete was rolled back)
      const entries = await db.select().from(tables.diaryEntries);
      const found = entries.find((e) => e.id === entry.id);
      expect(found).toBeDefined();
    });

    it('rolls back DB when workflow step fails during share', async () => {
      // First create an entry successfully
      const entry = await service.create({
        ownerId: OWNER_ID,
        content: 'Entry to share',
      });

      // Now make the share workflow fail
      mockKetoWriter.grantViewer.mockRejectedValueOnce(
        new Error('Keto unavailable'),
      );

      await expect(
        service.share(entry.id, OWNER_ID, OTHER_AGENT),
      ).rejects.toThrow('Keto unavailable');

      // Verify no share record was persisted
      const shares = await db.select().from(tables.entryShares);
      expect(shares.length).toBe(0);
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
      expect(mockKetoWriter.grantOwnership).toHaveBeenCalledTimes(10);

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
      expect(mockKetoWriter.removeEntryRelations).toHaveBeenCalledTimes(5);
    });

    it('handles concurrent shares without duplicates', async () => {
      const entry = await service.create({
        ownerId: OWNER_ID,
        content: 'Shared entry',
      });

      // Try to share with the same agent 5 times concurrently
      const sharePromises = Array.from({ length: 5 }, () =>
        service.share(entry.id, OWNER_ID, OTHER_AGENT),
      );

      const results = await Promise.allSettled(sharePromises);

      // At least one should succeed, others may fail due to uniqueness constraint
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);

      // Only one share record should exist
      const shares = await db.select().from(tables.entryShares);
      expect(shares.length).toBe(1);
    });
  });

  // ── Workflow Execution Tests ───────────────────────────────────────────

  describe('workflow execution', () => {
    it('executes Keto grantOwnership workflow on create', async () => {
      const entry = await service.create({
        ownerId: OWNER_ID,
        content: 'Test workflow execution',
      });

      expect(mockKetoWriter.grantOwnership).toHaveBeenCalledTimes(1);
      expect(mockKetoWriter.grantOwnership).toHaveBeenCalledWith(
        entry.id,
        OWNER_ID,
      );
    });

    it('executes Keto removeEntryRelations workflow on delete', async () => {
      const entry = await service.create({
        ownerId: OWNER_ID,
        content: 'Entry to delete',
      });

      await service.delete(entry.id, OWNER_ID);

      expect(mockKetoWriter.removeEntryRelations).toHaveBeenCalledTimes(1);
      expect(mockKetoWriter.removeEntryRelations).toHaveBeenCalledWith(
        entry.id,
      );
    });

    it('executes Keto grantViewer workflow on share', async () => {
      const entry = await service.create({
        ownerId: OWNER_ID,
        content: 'Entry to share',
      });

      await service.share(entry.id, OWNER_ID, OTHER_AGENT);

      expect(mockKetoWriter.grantViewer).toHaveBeenCalledTimes(1);
      expect(mockKetoWriter.grantViewer).toHaveBeenCalledWith(
        entry.id,
        OTHER_AGENT,
      );
    });
  });
});
