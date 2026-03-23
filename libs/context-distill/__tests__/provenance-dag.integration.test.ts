/**
 * Compile Provenance Integration Tests
 *
 * Exercises the compile → pack CID → persistence chain against a real
 * PostgreSQL database using the actual compile() function from context-distill.
 *
 * The pack CID is computed server-side from the compile output — the server
 * is the authority. Clients can verify by recomputing from the envelope.
 */

import type { CompileParams, PackEntryRef } from '@moltnet/crypto-service';
import { computeContentCid, computePackCid } from '@moltnet/crypto-service';
import {
  contextPackEntries,
  contextPacks,
  createContextPackRepository,
  createDatabase,
  createDiaryEntryRepository,
  type Database,
  diaries,
  diaryEntries,
  runMigrations,
} from '@moltnet/database';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { compile } from '../src/compile.js';
import { estimateTokens } from '../src/compress.js';
import type { DistillEntry } from '../src/types.js';

// ── Constants ────────────────────────────────────────────────────────────────

const DIARY_ID = '110e8400-e29b-41d4-a716-446655440020';
const OWNER_ID = '120e8400-e29b-41d4-a716-446655440021';

// ── Entry fixtures with embeddings for compile() ─────────────────────────────

function normalizedEmbedding(seed: number[]): number[] {
  const norm = Math.sqrt(seed.reduce((s, x) => s + x * x, 0));
  return seed.map((x) => x / norm);
}

interface DBEntry {
  id: string;
  entryType: 'semantic' | 'procedural' | 'episodic';
  title: string | null;
  content: string;
  tags: string[];
  contentHash: string;
  embedding: number[];
  tokens: number;
  importance: number;
}

function makeDBEntry(
  id: string,
  content: string,
  embedding: number[],
  opts?: {
    entryType?: 'semantic' | 'procedural' | 'episodic';
    title?: string;
    tags?: string[];
    importance?: number;
  },
): DBEntry {
  const entryType = opts?.entryType ?? 'semantic';
  const title = opts?.title ?? null;
  const tags = opts?.tags ?? [];
  return {
    id,
    entryType,
    title,
    content,
    tags,
    contentHash: computeContentCid(entryType, title, content, tags),
    embedding: normalizedEmbedding(embedding),
    tokens: estimateTokens(content),
    importance: opts?.importance ?? 5,
  };
}

// Entries with distinct embeddings so compile() MMR ranking produces
// deterministic, meaningful selection and ordering.
const ENTRIES: DBEntry[] = [
  makeDBEntry(
    'a0000000-0000-4000-a000-000000000001',
    'The Fastify auth hook validates JWT tokens and requires the agent scope claim. Tokens without this scope receive a 403 Forbidden response. This applies to all diary and entry endpoints.',
    [1, 0, 0],
    {
      entryType: 'semantic',
      title: 'Auth middleware scope check',
      tags: ['auth'],
      importance: 8,
    },
  ),
  makeDBEntry(
    'a0000000-0000-4000-a000-000000000002',
    'Database schema uses Drizzle ORM with pgvector for embeddings. All tables use UUID primary keys with defaultRandom. Relations are defined with references and onDelete cascade.',
    [0, 1, 0],
    {
      entryType: 'semantic',
      title: 'Database ORM patterns',
      tags: ['database'],
      importance: 7,
    },
  ),
  makeDBEntry(
    'a0000000-0000-4000-a000-000000000003',
    'When writing tests for auth-protected routes use the test helper to create a valid JWT with agent scope. Set the Authorization header and assert 403 for requests without the scope.',
    [0.9, 0.1, 0.4],
    {
      entryType: 'procedural',
      title: 'Testing auth routes',
      tags: ['testing', 'auth'],
      importance: 6,
    },
  ),
  makeDBEntry(
    'a0000000-0000-4000-a000-000000000004',
    'Consolidation uses agglomerative clustering with average linkage on L2-normalized e5-small-v2 embeddings. Threshold 0.15 works for general entries. Use 0.85 for scan entries.',
    [0, 0, 1],
    {
      entryType: 'semantic',
      title: 'Consolidation threshold tuning',
      tags: ['consolidation'],
      importance: 5,
    },
  ),
];

/** Convert DBEntry to DistillEntry for compile()/consolidate() */
function toDistillEntry(entry: DBEntry): DistillEntry {
  return {
    id: entry.id,
    embedding: entry.embedding,
    content: entry.content,
    tokens: entry.tokens,
    importance: entry.importance,
    createdAt: '2026-03-15T12:00:00.000Z',
  };
}

/**
 * Simulate the server-side pack CID computation after compile().
 * This is what the REST API / DBOS workflow would do.
 */
function serverComputePackCid(
  compileResult: { entries: { id: string; compressionLevel: string }[] },
  sourceEntries: DBEntry[],
  opts: {
    diaryId: string;
    tokenBudget: number;
    lambda: number;
    taskPromptHash?: string;
  },
): { packCid: string; params: CompileParams; packEntries: PackEntryRef[] } {
  const entryMap = new Map(sourceEntries.map((e) => [e.id, e]));

  const packEntries: PackEntryRef[] = compileResult.entries.map(
    (compiled, index) => {
      const source = entryMap.get(compiled.id);
      if (!source)
        throw new Error(`Entry ${compiled.id} not found in source entries`);
      return {
        cid: source.contentHash,
        compressionLevel:
          compiled.compressionLevel as PackEntryRef['compressionLevel'],
        rank: index + 1,
      };
    },
  );

  const params: CompileParams = {
    tokenBudget: opts.tokenBudget,
    lambda: opts.lambda,
    taskPromptHash: opts.taskPromptHash,
  };

  const packCid = computePackCid({
    diaryId: opts.diaryId,
    packType: 'compile',
    params,
    entries: packEntries,
  });

  return { packCid, params, packEntries };
}

// ── Setup ────────────────────────────────────────────────────────────────────

describe('compile provenance (integration)', () => {
  let db: Database;
  let pool: Pool;
  let packRepo: ReturnType<typeof createContextPackRepository>;
  let entryRepo: ReturnType<typeof createDiaryEntryRepository>;
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
    pool.on('error', (error: { code?: string }) => {
      if (error.code === '57P01') return;
      throw error;
    });
    packRepo = createContextPackRepository(db);
    entryRepo = createDiaryEntryRepository(db);

    // Seed diary
    await db.insert(diaries).values({
      id: DIARY_ID,
      ownerId: OWNER_ID,
      name: 'Compile Provenance Test',
      visibility: 'private',
    });

    // Seed entries with content hashes
    for (const entry of ENTRIES) {
      await entryRepo.create({
        id: entry.id,
        diaryId: DIARY_ID,
        createdBy: OWNER_ID,
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
    await db.delete(contextPackEntries);
    await db.delete(contextPacks);
  });

  afterAll(async () => {
    if (!db || !pool || !stopContainer) return;
    await db.delete(contextPackEntries);
    await db.delete(contextPacks);
    await db.delete(diaryEntries).where(eq(diaryEntries.diaryId, DIARY_ID));
    await db.delete(diaries).where(eq(diaries.id, DIARY_ID));
    await pool.end();
    await stopContainer();
  });

  // ── compile() → pack CID → persist ──────────────────────────────────────

  describe('compile() output → server-side pack CID → persistence', () => {
    it('compile selects and ranks entries, server computes pack CID', () => {
      const distillEntries = ENTRIES.map(toDistillEntry);
      const result = compile(distillEntries, {
        tokenBudget: 10000,
        taskPromptEmbedding: [1, 0, 0], // anchor: auth topic
        lambda: 0.7,
      });

      // compile() selected entries and ranked them
      expect(result.entries.length).toBeGreaterThan(0);
      expect(result.entries.length).toBeLessThanOrEqual(ENTRIES.length);

      // First entry should be auth-related (closest to task embedding)
      expect(result.entries[0].id).toBe(ENTRIES[0].id);

      // Server computes pack CID from compile output
      const { packCid } = serverComputePackCid(result, ENTRIES, {
        diaryId: DIARY_ID,
        tokenBudget: 10000,
        lambda: 0.7,
      });

      expect(packCid).toMatch(/^bafy/);
    });

    it('persists compile pack with entry membership and CID snapshots', async () => {
      const distillEntries = ENTRIES.map(toDistillEntry);
      const result = compile(distillEntries, {
        tokenBudget: 10000,
        lambda: 0.5,
      });

      const { packCid, params } = serverComputePackCid(result, ENTRIES, {
        diaryId: DIARY_ID,
        tokenBudget: 10000,
        lambda: 0.5,
      });

      // Persist pack
      const pack = await packRepo.createPack({
        diaryId: DIARY_ID,
        createdBy: OWNER_ID,
        packCid,
        packType: 'compile',
        params,
        payload: { params },
        pinned: false,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      expect(pack.packCid).toBe(packCid);
      expect(pack.packCodec).toBe('dag-cbor');

      // Persist entry membership with CID snapshots from compile output
      const entryMap = new Map(ENTRIES.map((e) => [e.id, e]));
      const membershipRows = await packRepo.addEntries(
        result.entries.map((compiled, index) => ({
          packId: pack.id,
          entryId: compiled.id,
          entryCidSnapshot: entryMap.get(compiled.id)!.contentHash,
          compressionLevel: compiled.compressionLevel,
          originalTokens: compiled.originalTokens,
          packedTokens: compiled.compressedTokens,
          rank: index + 1,
        })),
      );

      expect(membershipRows).toHaveLength(result.entries.length);

      // Query back and verify ordering
      const listed = await packRepo.listEntries(pack.id);
      expect(listed).toHaveLength(result.entries.length);
      for (let i = 0; i < listed.length; i++) {
        expect(listed[i].rank).toBe(i + 1);
        expect(listed[i].entryId).toBe(result.entries[i].id);
      }
    });

    it('pack CID is deterministic for same compile output', () => {
      const distillEntries = ENTRIES.map(toDistillEntry);

      // Same inputs → same compile output → same pack CID
      const result1 = compile(distillEntries, {
        tokenBudget: 10000,
        lambda: 0.5,
      });
      const result2 = compile(distillEntries, {
        tokenBudget: 10000,
        lambda: 0.5,
      });

      const { packCid: cid1 } = serverComputePackCid(result1, ENTRIES, {
        diaryId: DIARY_ID,
        tokenBudget: 10000,
        lambda: 0.5,
      });

      const { packCid: cid2 } = serverComputePackCid(result2, ENTRIES, {
        diaryId: DIARY_ID,
        tokenBudget: 10000,
        lambda: 0.5,
      });

      expect(cid1).toBe(cid2);
    });

    it('different token budget → different selection → different pack CID', () => {
      const distillEntries = ENTRIES.map(toDistillEntry);

      const smallResult = compile(distillEntries, { tokenBudget: 50 });
      const largeResult = compile(distillEntries, { tokenBudget: 10000 });

      // Different budgets may select different entries or compression levels
      const base = { diaryId: DIARY_ID };

      const { packCid: smallCid } = serverComputePackCid(smallResult, ENTRIES, {
        ...base,
        tokenBudget: 50,
        lambda: 0.5,
      });
      const { packCid: largeCid } = serverComputePackCid(largeResult, ENTRIES, {
        ...base,
        tokenBudget: 10000,
        lambda: 0.5,
      });

      expect(smallCid).not.toBe(largeCid);
    });

    it('lookup by CID returns the persisted pack', async () => {
      const distillEntries = ENTRIES.map(toDistillEntry);
      const result = compile(distillEntries, { tokenBudget: 10000 });

      const { packCid, params } = serverComputePackCid(result, ENTRIES, {
        diaryId: DIARY_ID,
        tokenBudget: 10000,
        lambda: 0.5,
      });

      await packRepo.createPack({
        diaryId: DIARY_ID,
        createdBy: OWNER_ID,
        packCid,
        packType: 'compile',
        params,
        payload: {},
        pinned: true,
      });

      const found = await packRepo.findByCid(packCid);
      expect(found).not.toBeNull();
      expect(found!.packCid).toBe(packCid);
      expect(found!.createdBy).toBe(OWNER_ID);
    });
  });

  // ── Drift detection ──────────────────────────────────────────────────────

  describe('CID drift detection after compile', () => {
    it('detects entry mutation after pack was compiled', async () => {
      const distillEntries = ENTRIES.map(toDistillEntry);
      const result = compile(distillEntries, { tokenBudget: 10000 });

      const { packCid, params } = serverComputePackCid(result, ENTRIES, {
        diaryId: DIARY_ID,
        tokenBudget: 10000,
        lambda: 0.5,
      });

      const pack = await packRepo.createPack({
        diaryId: DIARY_ID,
        createdBy: OWNER_ID,
        packCid,
        packType: 'compile',
        params,
        payload: {},
        pinned: true,
      });

      const entryMap = new Map(ENTRIES.map((e) => [e.id, e]));
      await packRepo.addEntries(
        result.entries.map((compiled, index) => ({
          packId: pack.id,
          entryId: compiled.id,
          entryCidSnapshot: entryMap.get(compiled.id)!.contentHash,
          compressionLevel: compiled.compressionLevel,
          rank: index + 1,
        })),
      );

      // Mutate an entry (unsigned → mutable)
      const targetEntry = ENTRIES[1];
      const modifiedContent = targetEntry.content + ' Added pgcrypto support.';
      const modifiedCid = computeContentCid(
        targetEntry.entryType,
        targetEntry.title,
        modifiedContent,
        targetEntry.tags,
      );

      await db
        .update(diaryEntries)
        .set({ content: modifiedContent, contentHash: modifiedCid })
        .where(eq(diaryEntries.id, targetEntry.id));

      // Detect drift: snapshot CID ≠ current CID
      const packEntryRows = await packRepo.listEntries(pack.id);
      const driftedRow = packEntryRows.find(
        (r) => r.entryId === targetEntry.id,
      );

      if (driftedRow) {
        const currentEntry = await entryRepo.findById(targetEntry.id);
        expect(driftedRow.entryCidSnapshot).toBe(targetEntry.contentHash);
        expect(currentEntry!.contentHash).toBe(modifiedCid);
        expect(driftedRow.entryCidSnapshot).not.toBe(currentEntry!.contentHash);
      }

      // Restore for other tests
      await db
        .update(diaryEntries)
        .set({
          content: targetEntry.content,
          contentHash: targetEntry.contentHash,
        })
        .where(eq(diaryEntries.id, targetEntry.id));
    });
  });

  // ── Pack supersession ──────────────────────────────────────────────────

  describe('pack supersession (compile → optimized)', () => {
    it('optimized pack supersedes compile pack', async () => {
      const distillEntries = ENTRIES.map(toDistillEntry);
      const result = compile(distillEntries, { tokenBudget: 10000 });

      const { packCid: compileCid, params } = serverComputePackCid(
        result,
        ENTRIES,
        {
          diaryId: DIARY_ID,
          tokenBudget: 10000,
          lambda: 0.5,
        },
      );

      const compilePack = await packRepo.createPack({
        diaryId: DIARY_ID,
        createdBy: OWNER_ID,
        packCid: compileCid,
        packType: 'compile',
        params,
        payload: { type: 'compile' },
        pinned: false,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      // GEPA optimization produces a new pack referencing the source
      const entryMap = new Map(ENTRIES.map((e) => [e.id, e]));
      const optimizedCid = computePackCid({
        diaryId: DIARY_ID,
        packType: 'optimized',
        params: {
          sourcePackCid: compileCid,
          gepaTrials: 8,
          gepaScore: 0.91,
        },
        entries: result.entries.map((compiled, index) => ({
          cid: entryMap.get(compiled.id)!.contentHash,
          compressionLevel:
            compiled.compressionLevel as PackEntryRef['compressionLevel'],
          rank: index + 1,
        })),
      });

      const optimizedPack = await packRepo.createPack({
        diaryId: DIARY_ID,
        createdBy: OWNER_ID,
        packCid: optimizedCid,
        packType: 'optimized',
        params: { sourcePackCid: compileCid, gepaTrials: 8, gepaScore: 0.91 },
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
  });
});
