/**
 * Provenance DAG Integration Tests
 *
 * Exercises the full provenance chain against a real PostgreSQL database:
 *   entries (with CIDs) → context packs (with DAG-CBOR pack CIDs)
 *   → pack entries (with CID snapshots) → entry relations
 *
 * Tests: pack persistence, entry membership, CID snapshot drift detection,
 * pack supersession, and relation-based graph navigation.
 */

import type { CompileParams } from '@moltnet/crypto-service';
import { computeContentCid, computePackCid } from '@moltnet/crypto-service';
import {
  contextPackEntries,
  contextPacks,
  createContextPackRepository,
  createDatabase,
  createDiaryEntryRepository,
  createEntryRelationRepository,
  type Database,
  diaries,
  diaryEntries,
  entryRelations,
  runMigrations,
} from '@moltnet/database';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

// ── Constants ────────────────────────────────────────────────────────────────

const DIARY_ID = '110e8400-e29b-41d4-a716-446655440020';
const OWNER_ID = '120e8400-e29b-41d4-a716-446655440021';

// ── Fixtures ─────────────────────────────────────────────────────────────────

interface EntryFixture {
  id: string;
  diaryId: string;
  createdBy: string;
  entryType: 'episodic' | 'semantic' | 'procedural';
  title: string | null;
  content: string;
  tags: string[];
  contentHash: string;
}

function makeEntry(
  id: string,
  content: string,
  opts?: {
    entryType?: 'episodic' | 'semantic' | 'procedural';
    title?: string;
    tags?: string[];
  },
): EntryFixture {
  const entryType = opts?.entryType ?? 'semantic';
  const title = opts?.title ?? null;
  const tags = opts?.tags ?? [];
  return {
    id,
    diaryId: DIARY_ID,
    createdBy: OWNER_ID,
    entryType,
    title,
    content,
    tags,
    contentHash: computeContentCid(entryType, title, content, tags),
  };
}

const ENTRIES: EntryFixture[] = [
  makeEntry(
    'a0000000-0000-4000-a000-000000000001',
    'Auth middleware validates JWT with agent scope claim.',
    {
      entryType: 'semantic',
      title: 'Auth middleware scope check',
      tags: ['auth'],
    },
  ),
  makeEntry(
    'a0000000-0000-4000-a000-000000000002',
    'Use Drizzle ORM with pgvector for embeddings.',
    {
      entryType: 'semantic',
      title: 'Database ORM patterns',
      tags: ['database'],
    },
  ),
  makeEntry(
    'a0000000-0000-4000-a000-000000000003',
    'Test auth routes: create JWT, set header, assert 403.',
    {
      entryType: 'procedural',
      title: 'Testing auth routes',
      tags: ['testing', 'auth'],
    },
  ),
];

function buildPackCidForEntries(
  entries: EntryFixture[],
  overrides?: { createdAt?: string },
): { packCid: string; params: CompileParams } {
  const params: CompileParams = {
    tokenBudget: 4000,
    lambda: 0.5,
    taskPromptHash: 'test-task',
  };

  const packCid = computePackCid({
    diaryId: DIARY_ID,
    createdBy: OWNER_ID,
    createdAt: overrides?.createdAt ?? '2026-03-15T14:00:00.000Z',
    packType: 'compile',
    params,
    entries: entries.map((e, i) => ({
      cid: e.contentHash,
      compressionLevel: 'full' as const,
      rank: i + 1,
    })),
  });

  return { packCid, params };
}

// ── Setup ────────────────────────────────────────────────────────────────────

describe('Provenance DAG (integration)', () => {
  let db: Database;
  let pool: Pool;
  let packRepo: ReturnType<typeof createContextPackRepository>;
  let entryRepo: ReturnType<typeof createDiaryEntryRepository>;
  let relationRepo: ReturnType<typeof createEntryRelationRepository>;
  let stopContainer: () => Promise<void>;

  beforeAll(async () => {
    const container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('moltnet')
      .withUsername('moltnet')
      .withPassword('moltnet_secret')
      .start();

    const databaseUrl = container.getConnectionUri();
    stopContainer = () => container.stop().then(() => undefined);

    await runMigrations(databaseUrl);
    ({ db, pool } = createDatabase(databaseUrl));
    packRepo = createContextPackRepository(db);
    entryRepo = createDiaryEntryRepository(db);
    relationRepo = createEntryRelationRepository(db);

    // Seed diary
    await db.insert(diaries).values({
      id: DIARY_ID,
      ownerId: OWNER_ID,
      name: 'Provenance Test Diary',
      visibility: 'private',
    });

    // Seed entries
    for (const entry of ENTRIES) {
      await entryRepo.create({
        id: entry.id,
        diaryId: entry.diaryId,
        createdBy: entry.createdBy,
        entryType: entry.entryType,
        title: entry.title,
        content: entry.content,
        tags: entry.tags,
        contentHash: entry.contentHash,
      });
    }
  }, 60_000);

  afterEach(async () => {
    if (!db) return;
    await db.delete(entryRelations);
    await db.delete(contextPackEntries);
    await db.delete(contextPacks);
  });

  afterAll(async () => {
    if (!db || !pool || !stopContainer) return;
    await db.delete(entryRelations);
    await db.delete(contextPackEntries);
    await db.delete(contextPacks);
    await db.delete(diaryEntries).where(eq(diaryEntries.diaryId, DIARY_ID));
    await db.delete(diaries).where(eq(diaries.id, DIARY_ID));
    await pool.end();
    await stopContainer();
  });

  // ── Pack creation + membership ──────────────────────────────────────────

  describe('compile pack persistence', () => {
    it('creates a pack with DAG-CBOR CID and entry membership', async () => {
      const { packCid, params } = buildPackCidForEntries(ENTRIES);

      const pack = await packRepo.createPack({
        diaryId: DIARY_ID,
        createdBy: OWNER_ID,
        packCid,
        tokenBudget: params.tokenBudget,
        lambda: params.lambda ?? null,
        payload: { params },
        pinned: false,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      expect(pack.packCid).toBe(packCid);
      expect(pack.packCodec).toBe('dag-cbor');

      // Add entry membership with CID snapshots
      const membershipRows = await packRepo.addEntries(
        ENTRIES.map((entry, index) => ({
          packId: pack.id,
          entryId: entry.id,
          entryCidSnapshot: entry.contentHash,
          compressionLevel: 'full' as const,
          originalTokens: 50,
          packedTokens: 50,
          rank: index + 1,
        })),
      );

      expect(membershipRows).toHaveLength(3);

      // Query back
      const listed = await packRepo.listEntries(pack.id);
      expect(listed).toHaveLength(3);
      expect(listed[0].rank).toBe(1);
      expect(listed[1].rank).toBe(2);
      expect(listed[2].rank).toBe(3);
    });

    it('lookups work by CID', async () => {
      const { packCid, params } = buildPackCidForEntries(ENTRIES);

      await packRepo.createPack({
        diaryId: DIARY_ID,
        createdBy: OWNER_ID,
        packCid,
        tokenBudget: params.tokenBudget,
        payload: {},
        pinned: true,
      });

      const found = await packRepo.findByCid(packCid);
      expect(found).not.toBeNull();
      expect(found!.packCid).toBe(packCid);
      expect(found!.createdBy).toBe(OWNER_ID);
    });

    it('enforces unique pack CID', async () => {
      const { packCid, params } = buildPackCidForEntries(ENTRIES);

      await packRepo.createPack({
        diaryId: DIARY_ID,
        createdBy: OWNER_ID,
        packCid,
        tokenBudget: params.tokenBudget,
        payload: {},
        pinned: true,
      });

      await expect(
        packRepo.createPack({
          diaryId: DIARY_ID,
          createdBy: OWNER_ID,
          packCid, // same CID
          tokenBudget: params.tokenBudget,
          payload: {},
          pinned: true,
        }),
      ).rejects.toThrow();
    });
  });

  // ── CID snapshot drift detection ────────────────────────────────────────

  describe('drift detection via CID snapshots', () => {
    it('detects when entry content changes after pack creation', async () => {
      const { packCid, params } = buildPackCidForEntries(ENTRIES);

      const pack = await packRepo.createPack({
        diaryId: DIARY_ID,
        createdBy: OWNER_ID,
        packCid,
        tokenBudget: params.tokenBudget,
        payload: {},
        pinned: true,
      });

      // Store membership with CID snapshots
      await packRepo.addEntries(
        ENTRIES.map((entry, index) => ({
          packId: pack.id,
          entryId: entry.id,
          entryCidSnapshot: entry.contentHash,
          compressionLevel: 'full' as const,
          rank: index + 1,
        })),
      );

      // Simulate entry content change (unsigned entry is mutable)
      const modifiedContent = 'Use Drizzle ORM with pgvector AND pgcrypto.';
      const modifiedCid = computeContentCid(
        'semantic',
        'Database ORM patterns',
        modifiedContent,
        ['database'],
      );

      // Update the entry in DB
      await db
        .update(diaryEntries)
        .set({ content: modifiedContent, contentHash: modifiedCid })
        .where(eq(diaryEntries.id, ENTRIES[1].id));

      // Verify drift: snapshot CID != current CID
      const packEntryRows = await packRepo.listEntries(pack.id);
      const entry2Row = packEntryRows.find((r) => r.entryId === ENTRIES[1].id)!;
      const currentEntry = await entryRepo.findById(ENTRIES[1].id);

      expect(entry2Row.entryCidSnapshot).toBe(ENTRIES[1].contentHash);
      expect(currentEntry!.contentHash).toBe(modifiedCid);
      expect(entry2Row.entryCidSnapshot).not.toBe(currentEntry!.contentHash);

      // Restore original content for other tests
      await db
        .update(diaryEntries)
        .set({
          content: ENTRIES[1].content,
          contentHash: ENTRIES[1].contentHash,
        })
        .where(eq(diaryEntries.id, ENTRIES[1].id));
    });
  });

  // ── Pack supersession ──────────────────────────────────────────────────

  describe('pack supersession chain', () => {
    it('optimized pack supersedes compile pack', async () => {
      // Create compile pack
      const { packCid: compileCid, params } = buildPackCidForEntries(ENTRIES);
      const compilePack = await packRepo.createPack({
        diaryId: DIARY_ID,
        createdBy: OWNER_ID,
        packCid: compileCid,
        tokenBudget: params.tokenBudget,
        payload: { type: 'compile', params },
        pinned: false,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      // Create optimized pack that supersedes it
      const optimizedCid = computePackCid({
        diaryId: DIARY_ID,
        createdBy: OWNER_ID,
        createdAt: '2026-03-15T16:00:00.000Z',
        packType: 'optimized',
        params: {
          sourcePackCid: compileCid,
          gepaTrials: 8,
          gepaScore: 0.91,
        },
        entries: ENTRIES.map((e, i) => ({
          cid: e.contentHash,
          compressionLevel: 'full' as const,
          rank: i + 1,
        })),
      });

      const optimizedPack = await packRepo.createPack({
        diaryId: DIARY_ID,
        createdBy: OWNER_ID,
        packCid: optimizedCid,
        tokenBudget: params.tokenBudget,
        payload: { type: 'optimized', sourcePackCid: compileCid },
        supersedesPackId: compilePack.id,
        pinned: true,
      });

      expect(optimizedPack.supersedesPackId).toBe(compilePack.id);

      // Navigate: optimized → compile
      const source = await packRepo.findById(optimizedPack.supersedesPackId!);
      expect(source).not.toBeNull();
      expect(source!.packCid).toBe(compileCid);
    });

    it('lists packs for diary in reverse chronological order', async () => {
      const cid1 = buildPackCidForEntries(ENTRIES, {
        createdAt: '2026-03-15T10:00:00.000Z',
      }).packCid;
      const cid2 = buildPackCidForEntries(ENTRIES, {
        createdAt: '2026-03-15T11:00:00.000Z',
      }).packCid;

      await packRepo.createPack({
        diaryId: DIARY_ID,
        createdBy: OWNER_ID,
        packCid: cid1,
        tokenBudget: 4000,
        payload: {},
        pinned: true,
      });

      await packRepo.createPack({
        diaryId: DIARY_ID,
        createdBy: OWNER_ID,
        packCid: cid2,
        tokenBudget: 4000,
        payload: {},
        pinned: true,
      });

      const packs = await packRepo.listByDiary(DIARY_ID);
      expect(packs).toHaveLength(2);
      // Most recent first
      expect(packs[0].packCid).toBe(cid2);
      expect(packs[1].packCid).toBe(cid1);
    });
  });

  // ── Entry relations ────────────────────────────────────────────────────

  describe('entry relations as consolidation output', () => {
    it('creates proposed supports/elaborates relations from consolidation', async () => {
      // Simulate: consolidation found entries 0 and 2 are related (both about auth)
      const supportsRelation = await relationRepo.create({
        sourceId: ENTRIES[0].id,
        targetId: ENTRIES[2].id,
        relation: 'supports',
        status: 'proposed',
        sourceCidSnapshot: ENTRIES[0].contentHash,
        targetCidSnapshot: ENTRIES[2].contentHash,
        workflowId: 'consolidate-wf-001',
        metadata: { similarity: 0.87, strategy: 'hybrid' },
      });

      expect(supportsRelation.relation).toBe('supports');
      expect(supportsRelation.status).toBe('proposed');
      expect(supportsRelation.sourceCidSnapshot).toBe(ENTRIES[0].contentHash);

      // Query relations for entry 0
      const relations = await relationRepo.listByEntry(ENTRIES[0].id);
      expect(relations).toHaveLength(1);
      expect(relations[0].targetId).toBe(ENTRIES[2].id);
    });

    it('accepts proposed relations', async () => {
      const relation = await relationRepo.create({
        sourceId: ENTRIES[0].id,
        targetId: ENTRIES[1].id,
        relation: 'elaborates',
        status: 'proposed',
        sourceCidSnapshot: ENTRIES[0].contentHash,
        targetCidSnapshot: ENTRIES[1].contentHash,
        workflowId: 'consolidate-wf-002',
        metadata: {},
      });

      const accepted = await relationRepo.updateStatus(relation.id, 'accepted');
      expect(accepted).not.toBeNull();
      expect(accepted!.status).toBe('accepted');
    });

    it('lists relations by entry, filtered by status', async () => {
      // Create two relations: one proposed, one accepted
      const rel1 = await relationRepo.create({
        sourceId: ENTRIES[0].id,
        targetId: ENTRIES[1].id,
        relation: 'supports',
        status: 'proposed',
        metadata: {},
      });
      await relationRepo.updateStatus(rel1.id, 'accepted');

      await relationRepo.create({
        sourceId: ENTRIES[0].id,
        targetId: ENTRIES[2].id,
        relation: 'elaborates',
        status: 'proposed',
        metadata: {},
      });

      const allRelations = await relationRepo.listByEntry(ENTRIES[0].id);
      expect(allRelations).toHaveLength(2);

      const acceptedOnly = await relationRepo.listByEntry(ENTRIES[0].id, {
        status: 'accepted',
      });
      expect(acceptedOnly).toHaveLength(1);
      expect(acceptedOnly[0].targetId).toBe(ENTRIES[1].id);

      const proposedOnly = await relationRepo.listByEntry(ENTRIES[0].id, {
        status: 'proposed',
      });
      expect(proposedOnly).toHaveLength(1);
      expect(proposedOnly[0].targetId).toBe(ENTRIES[2].id);
    });

    it('records CID snapshots for drift audit on relations', async () => {
      const relation = await relationRepo.create({
        sourceId: ENTRIES[0].id,
        targetId: ENTRIES[1].id,
        relation: 'supports',
        status: 'proposed',
        sourceCidSnapshot: ENTRIES[0].contentHash,
        targetCidSnapshot: ENTRIES[1].contentHash,
        metadata: {},
      });

      // Verify snapshots match current entry CIDs
      const sourceEntry = await entryRepo.findById(ENTRIES[0].id);
      const targetEntry = await entryRepo.findById(ENTRIES[1].id);

      expect(relation.sourceCidSnapshot).toBe(sourceEntry!.contentHash);
      expect(relation.targetCidSnapshot).toBe(targetEntry!.contentHash);
    });
  });

  // ── Combined: pack + relations provenance ──────────────────────────────

  describe('combined provenance: packs and relations', () => {
    it('full lifecycle: entries → relations → compile pack → navigate back', async () => {
      // Step 1: Create entry relations (from consolidation)
      await relationRepo.create({
        sourceId: ENTRIES[0].id,
        targetId: ENTRIES[2].id,
        relation: 'supports',
        status: 'accepted',
        sourceCidSnapshot: ENTRIES[0].contentHash,
        targetCidSnapshot: ENTRIES[2].contentHash,
        workflowId: 'consolidate-wf-lifecycle',
        metadata: { similarity: 0.89 },
      });

      // Step 2: Compile pack from entries
      const { packCid, params } = buildPackCidForEntries(ENTRIES);
      const pack = await packRepo.createPack({
        diaryId: DIARY_ID,
        createdBy: OWNER_ID,
        packCid,
        tokenBudget: params.tokenBudget,
        payload: { params },
        pinned: true,
      });

      await packRepo.addEntries(
        ENTRIES.map((entry, index) => ({
          packId: pack.id,
          entryId: entry.id,
          entryCidSnapshot: entry.contentHash,
          compressionLevel: 'full' as const,
          rank: index + 1,
        })),
      );

      // Step 3: Navigate — from pack, get entries, get their relations
      const packEntryRows = await packRepo.listEntries(pack.id);
      expect(packEntryRows).toHaveLength(3);

      // For each pack entry, check relations
      const entryIds = packEntryRows.map((r) => r.entryId);
      const allRelations = new Map<
        string,
        Awaited<ReturnType<typeof relationRepo.listByEntry>>
      >();
      for (const entryId of entryIds) {
        const relations = await relationRepo.listByEntry(entryId, {
          status: 'accepted',
        });
        if (relations.length > 0) {
          allRelations.set(entryId, relations);
        }
      }

      // Entry 0 and Entry 2 have a supports relation
      expect(allRelations.size).toBe(2); // both are involved
      expect(allRelations.has(ENTRIES[0].id)).toBe(true);
      expect(allRelations.has(ENTRIES[2].id)).toBe(true);

      // Verify CID integrity: all snapshot CIDs match current entries
      for (const row of packEntryRows) {
        const entry = await entryRepo.findById(row.entryId);
        expect(row.entryCidSnapshot).toBe(entry!.contentHash);
      }
    });
  });
});
