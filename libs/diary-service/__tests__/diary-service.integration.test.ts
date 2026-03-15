/**
 * DiaryService Integration Tests
 *
 * Tests the diary service layer wired with a real DiaryRepository
 * against PostgreSQL + pgvector + real DBOS runtime.
 *
 * Spins up an ephemeral pgvector/pgvector:pg16 container via testcontainers,
 * applies all Drizzle migrations, then runs tests against it.
 *
 * Uses the container DB as both the app database and DBOS system database
 * (DBOS creates its system tables in a `dbos` schema within the same DB).
 *
 * Without EMBEDDING_MODEL: uses noop embedding service (text search only).
 * With EMBEDDING_MODEL=true: uses @moltnet/embedding-service for real
 * vector embeddings and hybrid search testing.
 */

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
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
  RelationshipReader,
  RelationshipWriter,
} from '../src/index.js';
import { DiaryServiceError } from '../src/types.js';
import {
  initDiaryWorkflows,
  setDiaryWorkflowDeps,
} from '../src/workflows/diary-workflows.js';

async function loadEmbeddingService(): Promise<EmbeddingService> {
  if (process.env.EMBEDDING_MODEL !== 'true') {
    return createNoopEmbeddingService();
  }
  const { createEmbeddingService } = await import('@moltnet/embedding-service');
  return createEmbeddingService();
}

async function setupDatabase(url: string) {
  const {
    createDatabase,
    createDiaryEntryRepository,
    createDiaryRepository,
    diaryEntries,
    diaries,
  } = await import('@moltnet/database');
  const { db, pool } = createDatabase(url);
  const repo = createDiaryEntryRepository(db);
  const diaryRepo = createDiaryRepository(db);
  return { db, pool, repo, diaryRepo, diaryEntries, diaries };
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

describe('DiaryService (integration)', () => {
  let service: DiaryService;
  let db: Awaited<ReturnType<typeof setupDatabase>>['db'];
  let tables: {
    diaryEntries: Awaited<ReturnType<typeof setupDatabase>>['diaryEntries'];
    diaries: Awaited<ReturnType<typeof setupDatabase>>['diaries'];
  };
  let permissions: {
    [K in keyof PermissionChecker]: ReturnType<typeof vi.fn>;
  };
  let relationshipReader: {
    listDiaryIdsByAgent: ReturnType<typeof vi.fn>;
  };
  let relationshipWriter: {
    [K in keyof RelationshipWriter]: ReturnType<typeof vi.fn>;
  };
  let pool: Awaited<ReturnType<typeof setupDatabase>>['pool'];
  let DIARY_ID: string;
  let OTHER_DIARY_ID: string;
  let stopContainer: () => Promise<void>;

  const OWNER_ID = '00000000-0000-4000-b000-000000000001';
  const OTHER_AGENT = '00000000-0000-4000-b000-000000000002';

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

    const setup = await setupDatabase(databaseUrl);
    db = setup.db;
    pool = setup.pool;
    tables = {
      diaryEntries: setup.diaryEntries,
      diaries: setup.diaries,
    };

    permissions = {
      canViewEntry: vi.fn().mockResolvedValue(true),
      canEditEntry: vi.fn().mockResolvedValue(true),
      canDeleteEntry: vi.fn().mockResolvedValue(true),
      canReadDiary: vi.fn().mockResolvedValue(true),
      canWriteDiary: vi.fn().mockResolvedValue(true),
      canManageDiary: vi.fn().mockResolvedValue(true),
    };

    relationshipReader = {
      listDiaryIdsByAgent: vi.fn().mockResolvedValue([]),
    };

    relationshipWriter = {
      grantEntryParent: vi.fn().mockResolvedValue(undefined),
      registerAgent: vi.fn().mockResolvedValue(undefined),
      removeEntryRelations: vi.fn().mockResolvedValue(undefined),
      grantDiaryOwner: vi.fn().mockResolvedValue(undefined),
      grantDiaryWriter: vi.fn().mockResolvedValue(undefined),
      grantDiaryReader: vi.fn().mockResolvedValue(undefined),
      removeDiaryRelations: vi.fn().mockResolvedValue(undefined),
      removeDiaryRelationForAgent: vi.fn().mockResolvedValue(undefined),
    };

    const embeddingService = await loadEmbeddingService();

    // Launch DBOS after workflow registration
    const dbosSetup = await setupDBOS(databaseUrl);

    // Wire diary workflow deps (dataSource available now; deps are lazy)
    setDiaryWorkflowDeps({
      diaryEntryRepository: setup.repo,
      relationshipWriter: relationshipWriter as unknown as RelationshipWriter,
      embeddingService,
      dataSource: dbosSetup.dataSource,
    });

    service = createDiaryService({
      diaryRepository: setup.diaryRepo,
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
      diaryEntryRepository: setup.repo,
      permissionChecker: permissions as unknown as PermissionChecker,
      relationshipReader: relationshipReader as unknown as RelationshipReader,
      relationshipWriter: relationshipWriter as unknown as RelationshipWriter,
      embeddingService,
      transactionRunner: dbosSetup.transactionRunner,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
      } as never,
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
  }, 60_000);

  afterEach(async () => {
    // Clean up only entries for our test diaries to avoid cross-test interference
    if (DIARY_ID) {
      await db
        .delete(tables.diaryEntries)
        .where(eq(tables.diaryEntries.diaryId, DIARY_ID));
    }
    if (OTHER_DIARY_ID) {
      await db
        .delete(tables.diaryEntries)
        .where(eq(tables.diaryEntries.diaryId, OTHER_DIARY_ID));
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
    if (OTHER_DIARY_ID) {
      await db
        .delete(tables.diaryEntries)
        .where(eq(tables.diaryEntries.diaryId, OTHER_DIARY_ID));
      await db
        .delete(tables.diaries)
        .where(eq(tables.diaries.id, OTHER_DIARY_ID));
    }

    const { shutdownDBOS } = await import('@moltnet/database');
    await shutdownDBOS();
    await pool.end();
    await stopContainer();
  });

  // ── Create ──────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates entry and links to parent diary', async () => {
      const entry = await service.createEntry(
        {
          diaryId: DIARY_ID,
          content: 'My first diary entry about MoltNet.',
        },
        OWNER_ID,
      );

      expect(entry.id).toBeDefined();
      expect(entry.diaryId).toBe(DIARY_ID);
      expect(entry.content).toBe('My first diary entry about MoltNet.');
      expect(relationshipWriter.grantEntryParent).toHaveBeenCalledWith(
        entry.id,
        DIARY_ID,
      );
    });

    it('creates entry with all fields', async () => {
      const entry = await service.createEntry(
        {
          diaryId: DIARY_ID,
          content: 'Learning about Ed25519 signatures.',
          title: 'Crypto Day',
          tags: ['crypto', 'learning'],
        },
        OWNER_ID,
      );

      expect(entry.title).toBe('Crypto Day');
      expect(entry.tags).toEqual(['crypto', 'learning']);
    });

    it('creates entry without embedding when noop service is used', async () => {
      if (process.env.EMBEDDING_MODEL === 'true') return;

      const entry = await service.createEntry(
        {
          diaryId: DIARY_ID,
          content: 'No embedding here.',
        },
        OWNER_ID,
      );

      expect(entry.embedding).toBeNull();
    });

    it('creates entry with embedding when real service is used', async () => {
      if (process.env.EMBEDDING_MODEL !== 'true') return;

      const entry = await service.createEntry(
        {
          diaryId: DIARY_ID,
          content: 'Ed25519 cryptographic identity for autonomous agents.',
        },
        OWNER_ID,
      );

      expect(entry.embedding).not.toBeNull();
      expect(entry.embedding).toHaveLength(384);
    });
  });

  // ── Read ────────────────────────────────────────────────────────────

  describe('getById', () => {
    it('returns entry when Keto allows', async () => {
      const created = await service.createEntry(
        {
          diaryId: DIARY_ID,
          content: 'Private thought.',
        },
        OWNER_ID,
      );

      permissions.canViewEntry.mockResolvedValue(true);
      const found = await service.getEntryById(created.id, DIARY_ID, OWNER_ID);
      expect(found).not.toBeNull();
      expect(found!.content).toBe('Private thought.');
    });

    it('throws forbidden when Keto denies', async () => {
      const created = await service.createEntry(
        {
          diaryId: DIARY_ID,
          content: 'Secret entry.',
        },
        OWNER_ID,
      );

      permissions.canViewEntry.mockResolvedValue(false);
      await expect(
        service.getEntryById(created.id, DIARY_ID, OTHER_AGENT),
      ).rejects.toThrow(DiaryServiceError);
    });
  });

  // ── List ────────────────────────────────────────────────────────────

  describe('list', () => {
    it('lists entries for a diary', async () => {
      await service.createEntry(
        { diaryId: DIARY_ID, content: 'Entry 1.' },
        OWNER_ID,
      );
      await service.createEntry(
        { diaryId: DIARY_ID, content: 'Entry 2.' },
        OWNER_ID,
      );
      await service.createEntry(
        { diaryId: OTHER_DIARY_ID, content: 'Not mine.' },
        OTHER_AGENT,
      );

      const entries = await service.listEntries({ diaryId: DIARY_ID });

      expect(entries.length).toBe(2);
      expect(entries.every((e) => e.diaryId === DIARY_ID)).toBe(true);
    });
  });

  // ── Search ──────────────────────────────────────────────────────────

  describe('search', () => {
    it('searches by text query', async () => {
      await service.createEntry(
        {
          diaryId: DIARY_ID,
          content: 'Cryptographic key exchange protocols are fascinating.',
        },
        OWNER_ID,
      );
      await service.createEntry(
        { diaryId: DIARY_ID, content: 'The weather is sunny today.' },
        OWNER_ID,
      );

      const results = await service.searchEntries(
        { diaryId: DIARY_ID, query: 'cryptographic protocols' },
        OWNER_ID,
      );

      expect(results.length).toBe(1);
      expect(results[0].content).toContain('Cryptographic');
    });

    it('returns all entries when no query is provided', async () => {
      await service.createEntry({ diaryId: DIARY_ID, content: 'A.' }, OWNER_ID);
      await service.createEntry({ diaryId: DIARY_ID, content: 'B.' }, OWNER_ID);

      const results = await service.searchEntries(
        { diaryId: DIARY_ID },
        OWNER_ID,
      );
      expect(results.length).toBe(2);
    });

    it('excludes entries that contain excluded tags', async () => {
      await service.createEntry(
        {
          diaryId: DIARY_ID,
          content: 'Documented an incident runbook.',
          tags: ['incident'],
        },
        OWNER_ID,
      );
      await service.createEntry(
        {
          diaryId: DIARY_ID,
          content: 'Stable architecture notes.',
          tags: ['architecture'],
        },
        OWNER_ID,
      );

      const results = await service.searchEntries(
        { diaryId: DIARY_ID, excludeTags: ['incident'] },
        OWNER_ID,
      );

      expect(results.some((r) => r.tags?.includes('incident'))).toBe(false);
      expect(results.some((r) => r.tags?.includes('architecture'))).toBe(true);
    });

    it('finds semantically similar entries via hybrid search', async () => {
      if (process.env.EMBEDDING_MODEL !== 'true') return;

      await service.createEntry(
        {
          diaryId: DIARY_ID,
          content:
            'Ed25519 is an elliptic curve digital signature algorithm used for cryptographic identity verification.',
        },
        OWNER_ID,
      );
      await service.createEntry(
        {
          diaryId: DIARY_ID,
          content: 'I had pasta with tomato sauce for dinner last night.',
        },
        OWNER_ID,
      );

      const results = await service.searchEntries(
        {
          diaryId: DIARY_ID,
          query: 'public key cryptography and digital signatures',
        },
        OWNER_ID,
      );

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].content).toContain('Ed25519');
    });
  });

  // ── Update ──────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates entry fields when Keto allows', async () => {
      const created = await service.createEntry(
        { diaryId: DIARY_ID, content: 'Original.' },
        OWNER_ID,
      );

      permissions.canEditEntry.mockResolvedValue(true);
      const updated = await service.updateEntry(created.id, OWNER_ID, {
        title: 'Updated Title',
        content: 'New content.',
      });

      expect(updated).not.toBeNull();
      expect(updated!.title).toBe('Updated Title');
      expect(updated!.content).toBe('New content.');
    });

    it('recomputes contentHash when content changes on unsigned entry', async () => {
      const created = await service.createEntry(
        { diaryId: DIARY_ID, content: 'Original content', tags: ['tag1'] },
        OWNER_ID,
      );
      const originalHash = created.contentHash;
      expect(originalHash).toBeDefined();

      permissions.canEditEntry.mockResolvedValue(true);
      const updated = await service.updateEntry(created.id, OWNER_ID, {
        content: 'Updated content',
      });

      expect(updated).not.toBeNull();
      expect(updated!.contentHash).toBeDefined();
      expect(updated!.contentHash).not.toBe(originalHash);
    });

    it('throws forbidden when Keto denies edit', async () => {
      const created = await service.createEntry(
        { diaryId: DIARY_ID, content: 'Protected.' },
        OWNER_ID,
      );

      permissions.canEditEntry.mockResolvedValue(false);
      await expect(
        service.updateEntry(created.id, OTHER_AGENT, {
          title: 'Hacked',
        }),
      ).rejects.toThrow(DiaryServiceError);
    });
  });

  // ── Delete ──────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes entry and removes permission relations when Keto allows', async () => {
      const created = await service.createEntry(
        { diaryId: DIARY_ID, content: 'To delete.' },
        OWNER_ID,
      );

      permissions.canDeleteEntry.mockResolvedValue(true);
      const deleted = await service.deleteEntry(created.id, OWNER_ID);
      expect(deleted).toBe(true);
      expect(relationshipWriter.removeEntryRelations).toHaveBeenCalledWith(
        created.id,
      );

      permissions.canViewEntry.mockResolvedValue(true);
      await expect(
        service.getEntryById(created.id, DIARY_ID, OWNER_ID),
      ).rejects.toThrow(DiaryServiceError);
    });

    it('throws forbidden when Keto denies delete', async () => {
      const created = await service.createEntry(
        { diaryId: DIARY_ID, content: 'Protected.' },
        OWNER_ID,
      );

      permissions.canDeleteEntry.mockResolvedValue(false);
      await expect(
        service.deleteEntry(created.id, OTHER_AGENT),
      ).rejects.toThrow(DiaryServiceError);
      expect(relationshipWriter.removeEntryRelations).not.toHaveBeenCalled();
    });
  });

  // ── Reflect ─────────────────────────────────────────────────────────

  describe('reflect', () => {
    it('generates digest from recent entries', async () => {
      await service.createEntry(
        {
          diaryId: DIARY_ID,
          content: 'Day 1: Started learning about MoltNet.',
          tags: ['learning'],
        },
        OWNER_ID,
      );
      await service.createEntry(
        {
          diaryId: DIARY_ID,
          content: 'Day 2: Registered my first identity.',
          tags: ['identity'],
        },
        OWNER_ID,
      );

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
