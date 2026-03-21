/**
 * DiaryService DBOS Integration Tests
 *
 * Tests DBOS transaction atomicity with real Postgres + real DBOS runtime.
 * Keto RelationshipWriter is mocked to isolate DB/DBOS behavior.
 *
 * Spins up an ephemeral pgvector/pgvector:pg16 container via testcontainers,
 * applies all Drizzle migrations, then runs tests against it.
 *
 * Uses the container DB as both the app database and DBOS system database
 * (DBOS creates its system tables in a `dbos` schema within the same DB).
 *
 * These tests verify:
 * - Transaction atomicity for DB operations
 * - Concurrent operations without race conditions
 * - RelationshipWriter calls happen after transaction commits
 */

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
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
  PermissionChecker,
  RelationshipReader,
  RelationshipWriter,
} from '../src/index.js';
import {
  initDiaryWorkflows,
  setDiaryWorkflowDeps,
} from '../src/workflows/diary-workflows.js';

describe('DiaryService (DBOS integration)', () => {
  let service: DiaryService;
  let db: Awaited<ReturnType<typeof setupDatabase>>['db']['db'];
  let transactionRunner: Awaited<
    ReturnType<typeof setupDBOS>
  >['transactionRunner'];
  let tables: {
    diaryEntries: Awaited<ReturnType<typeof setupDatabase>>['diaryEntries'];
    diaries: Awaited<ReturnType<typeof setupDatabase>>['diaries'];
  };
  let mockRelationshipReader: {
    listDiaryIdsByAgent: ReturnType<typeof vi.fn>;
  };
  let mockRelationshipWriter: {
    [K in keyof RelationshipWriter]: ReturnType<typeof vi.fn>;
  };
  let permissions: {
    [K in keyof PermissionChecker]: ReturnType<typeof vi.fn>;
  };
  let pool: Pool;
  let DIARY_ID: string;
  let stopContainer: () => Promise<void>;

  const OWNER_ID = '00000000-0000-4000-b000-000000000002';

  async function setupDatabase(url: string) {
    const {
      createDatabase,
      createDiaryEntryRepository,
      createDiaryRepository,
      createEntryRelationRepository,
      diaryEntries,
      diaries,
    } = await import('@moltnet/database');
    const database = createDatabase(url);
    const repo = createDiaryEntryRepository(database.db);
    const diaryRepo = createDiaryRepository(database.db);
    const entryRelationRepo = createEntryRelationRepository(database.db);
    return {
      db: database,
      repo,
      diaryRepo,
      entryRelationRepo,
      diaryEntries,
      diaries,
    };
  }

  async function setupDBOS(url: string) {
    const {
      configureDBOS,
      initDBOS,
      launchDBOS,
      getDataSource,
      createDBOSTransactionRunner,
    } = await import('@moltnet/database');

    // Use app database as DBOS system database — DBOS creates its tables
    // in a `dbos` schema within the same database.
    configureDBOS(url);
    await initDBOS({ databaseUrl: url, systemDatabaseUrl: url });
    await launchDBOS();

    const dataSource = getDataSource();
    return {
      dataSource,
      transactionRunner: createDBOSTransactionRunner(dataSource),
    };
  }

  beforeAll(async () => {
    const container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('moltnet')
      .withUsername('moltnet')
      .withPassword('moltnet_secret')
      .start();

    const databaseUrl = container.getConnectionUri();
    stopContainer = () => container.stop().then(() => undefined);

    const { runMigrations } = await import('@moltnet/database');
    await runMigrations(databaseUrl);

    // Register DBOS workflows BEFORE launchDBOS() — DBOS requirement.
    // Deps are accessed lazily at execution time, so registration before
    // setDiaryWorkflowDeps() is safe.
    initDiaryWorkflows();

    mockRelationshipReader = {
      listDiaryIdsByAgent: vi.fn().mockResolvedValue([]),
    };

    mockRelationshipWriter = {
      grantEntryParent: vi.fn().mockResolvedValue(undefined),
      registerAgent: vi.fn().mockResolvedValue(undefined),
      removeEntryRelations: vi.fn().mockResolvedValue(undefined),
      grantDiaryOwner: vi.fn().mockResolvedValue(undefined),
      grantDiaryWriter: vi.fn().mockResolvedValue(undefined),
      grantDiaryReader: vi.fn().mockResolvedValue(undefined),
      removeDiaryRelations: vi.fn().mockResolvedValue(undefined),
      removeDiaryRelationForAgent: vi.fn().mockResolvedValue(undefined),
    };

    permissions = {
      canViewEntry: vi.fn().mockResolvedValue(true),
      canEditEntry: vi.fn().mockResolvedValue(true),
      canDeleteEntry: vi.fn().mockResolvedValue(true),
      canReadDiary: vi.fn().mockResolvedValue(true),
      canWriteDiary: vi.fn().mockResolvedValue(true),
      canManageDiary: vi.fn().mockResolvedValue(true),
    };

    const dbSetup = await setupDatabase(databaseUrl);
    db = dbSetup.db.db;
    pool = dbSetup.db.pool;
    tables = {
      diaryEntries: dbSetup.diaryEntries,
      diaries: dbSetup.diaries,
    };

    // Create a test diary container so diary_entries FK constraint is satisfied
    const diary = await dbSetup.diaryRepo.create({
      ownerId: OWNER_ID,
      name: 'DBOS Test Diary',
      visibility: 'private',
    });
    DIARY_ID = diary.id;

    // Launch DBOS after workflow registration
    const dbosSetup = await setupDBOS(databaseUrl);
    transactionRunner = dbosSetup.transactionRunner;

    const embeddingService = createNoopEmbeddingService();

    // Wire diary workflow deps (dataSource available now; deps are lazy)
    setDiaryWorkflowDeps({
      diaryEntryRepository: dbSetup.repo,
      relationshipWriter:
        mockRelationshipWriter as unknown as RelationshipWriter,
      embeddingService,
      dataSource: dbosSetup.dataSource,
    });

    service = createDiaryService({
      diaryRepository: dbSetup.diaryRepo,
      diaryShareRepository: {
        create: vi.fn(),
        findById: vi.fn(),
        findByDiaryAndAgent: vi.fn(),
        listByDiary: vi.fn(),
        listPendingForAgent: vi.fn(),
        listAcceptedForAgent: vi.fn(),
        updateStatus: vi.fn(),
      } as unknown as DiaryShareRepository,
      agentRepository: {
        findByFingerprint: vi.fn(),
      } as unknown as AgentLookupRepository,
      diaryEntryRepository: dbSetup.repo,
      entryRelationRepository: dbSetup.entryRelationRepo,
      permissionChecker: permissions as unknown as PermissionChecker,
      relationshipReader:
        mockRelationshipReader as unknown as RelationshipReader,
      relationshipWriter:
        mockRelationshipWriter as unknown as RelationshipWriter,
      embeddingService,
      transactionRunner,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
      } as never,
    });
  }, 60_000);

  afterEach(async () => {
    // Clean up only entries for our test diary to avoid cross-test interference
    if (DIARY_ID) {
      await db
        .delete(tables.diaryEntries)
        .where(eq(tables.diaryEntries.diaryId, DIARY_ID));
    }
    vi.clearAllMocks();
  });

  afterAll(async () => {
    // Scope cleanup by diary ID to avoid deleting other tests' diaries
    if (DIARY_ID) {
      await db
        .delete(tables.diaryEntries)
        .where(eq(tables.diaryEntries.diaryId, DIARY_ID));
      await db.delete(tables.diaries).where(eq(tables.diaries.id, DIARY_ID));
    }

    // Shutdown DBOS and close pool before stopping container
    const { shutdownDBOS } = await import('@moltnet/database');
    await shutdownDBOS();
    await pool?.end();
    // HACK (LeGreffier, 2026-03-15): Same DBOS pool leak workaround as
    // diary-service.integration.test.ts — see comment there for full context.
    const ignoreTeardownError = (err: Error & { code?: string }) => {
      if (err.code !== '57P01') throw err;
    };
    process.on('uncaughtException', ignoreTeardownError);
    await stopContainer?.();
    process.nextTick(() => {
      process.removeListener('uncaughtException', ignoreTeardownError);
    });
  });

  // ── Atomicity Tests ────────────────────────────────────────────────────

  describe('atomicity', () => {
    it('creates entry and calls grantEntryParent', async () => {
      const entry = await service.createEntry(
        {
          diaryId: DIARY_ID,
          content: 'Test atomic create',
        },
        OWNER_ID,
      );

      expect(entry.id).toBeDefined();
      expect(entry.diaryId).toBe(DIARY_ID);

      expect(mockRelationshipWriter.grantEntryParent).toHaveBeenCalledWith(
        entry.id,
        DIARY_ID,
      );

      // Verify entry exists in database
      const entries = await db
        .select()
        .from(tables.diaryEntries)
        .where(eq(tables.diaryEntries.diaryId, DIARY_ID));
      const found = entries.find((e) => e.id === entry.id);
      expect(found).toBeDefined();
      expect(found!.content).toBe('Test atomic create');
    });

    it('retries grantEntryParent and creates entry on eventual success', async () => {
      mockRelationshipWriter.grantEntryParent.mockRejectedValueOnce(
        new Error('Keto temporarily unavailable'),
      );

      // DBOS retries the step — entry should be created after the retry
      const entry = await service.createEntry(
        {
          diaryId: DIARY_ID,
          content: 'Should persist after Keto retry',
        },
        OWNER_ID,
      );

      expect(entry.id).toBeDefined();
      const entries = await db
        .select()
        .from(tables.diaryEntries)
        .where(eq(tables.diaryEntries.diaryId, DIARY_ID));
      expect(entries.length).toBe(1);
      // Called twice: first attempt failed, second (retry) succeeded
      expect(mockRelationshipWriter.grantEntryParent).toHaveBeenCalledTimes(2);
    });

    it('still deletes entry when removeEntryRelations fails (DBOS retries)', async () => {
      const entry = await service.createEntry(
        {
          diaryId: DIARY_ID,
          content: 'Entry to delete',
        },
        OWNER_ID,
      );

      mockRelationshipWriter.removeEntryRelations.mockRejectedValueOnce(
        new Error('Keto temporarily unavailable'),
      );

      const deleted = await service.deleteEntry(entry.id, OWNER_ID);
      expect(deleted).toBe(true);

      // Verify entry is deleted from database (DB write committed before Keto step)
      const entries = await db
        .select()
        .from(tables.diaryEntries)
        .where(eq(tables.diaryEntries.diaryId, DIARY_ID));
      expect(entries.length).toBe(0);
    });
  });

  // ── Concurrency Tests ──────────────────────────────────────────────────

  describe('concurrency', () => {
    it('handles 10 concurrent creates without race conditions', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        service.createEntry(
          {
            diaryId: DIARY_ID,
            content: `Entry ${i}`,
          },
          OWNER_ID,
        ),
      );

      const results = await Promise.allSettled(promises);
      const fulfilled = results.filter(
        (
          r,
        ): r is PromiseFulfilledResult<
          Awaited<ReturnType<typeof service.createEntry>>
        > => r.status === 'fulfilled',
      );

      expect(fulfilled.length).toBe(10);
      expect(mockRelationshipWriter.grantEntryParent).toHaveBeenCalledTimes(10);

      // Verify all entries exist in database
      const entries = await db
        .select()
        .from(tables.diaryEntries)
        .where(eq(tables.diaryEntries.diaryId, DIARY_ID));
      expect(entries.length).toBe(10);
    });

    it('handles concurrent create/delete without leaving orphans', async () => {
      // Create 5 entries
      const entries = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          service.createEntry(
            {
              diaryId: DIARY_ID,
              content: `Entry ${i}`,
            },
            OWNER_ID,
          ),
        ),
      );

      // Concurrently delete them all
      const deletePromises = entries.map((e) =>
        service.deleteEntry(e.id, OWNER_ID),
      );
      await Promise.all(deletePromises);

      // Verify all entries are gone
      const remaining = await db
        .select()
        .from(tables.diaryEntries)
        .where(eq(tables.diaryEntries.diaryId, DIARY_ID));
      expect(remaining.length).toBe(0);

      // Verify Keto cleanup was called for each
      expect(mockRelationshipWriter.removeEntryRelations).toHaveBeenCalledTimes(
        5,
      );
    });
  });

  // ── RelationshipWriter Execution Tests ──────────────────────────────

  describe('relationship writer execution', () => {
    it('calls grantEntryParent on create', async () => {
      const entry = await service.createEntry(
        {
          diaryId: DIARY_ID,
          content: 'Test workflow execution',
        },
        OWNER_ID,
      );

      expect(mockRelationshipWriter.grantEntryParent).toHaveBeenCalledTimes(1);
      expect(mockRelationshipWriter.grantEntryParent).toHaveBeenCalledWith(
        entry.id,
        DIARY_ID,
      );
    });

    it('calls removeEntryRelations on delete', async () => {
      const entry = await service.createEntry(
        {
          diaryId: DIARY_ID,
          content: 'Entry to delete',
        },
        OWNER_ID,
      );

      await service.deleteEntry(entry.id, OWNER_ID);

      expect(mockRelationshipWriter.removeEntryRelations).toHaveBeenCalledTimes(
        1,
      );
      expect(mockRelationshipWriter.removeEntryRelations).toHaveBeenCalledWith(
        entry.id,
      );
    });
  });
});
