/**
 * Entry Relations Integration Tests
 *
 * Exercises entry relations as consolidation output against a real PostgreSQL
 * database. Uses actual consolidate() to produce clusters, then maps cluster
 * structure to proposed relation edges.
 *
 * Consolidation is a graph operation — it produces entry_relations edges,
 * not context packs (decision 2026-03-15).
 */

import { computeContentCid } from '@moltnet/crypto-service';
import {
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

import { compile } from '../src/compile.js';
import { estimateTokens } from '../src/compress.js';
import { consolidate } from '../src/consolidate.js';
import { clusterToRelationProposals } from '../src/relation-proposals.js';
import type { DistillEntry } from '../src/types.js';

// ── Constants ────────────────────────────────────────────────────────────────

const DIARY_ID = '220e8400-e29b-41d4-a716-446655440030';
const OWNER_ID = '230e8400-e29b-41d4-a716-446655440031';

// ── Entry fixtures with embeddings for consolidate() ─────────────────────────

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

// Two pairs of semantically similar entries (close embeddings) + one outlier.
// consolidate() should cluster the similar pairs together.
const ENTRIES: DBEntry[] = [
  // Auth cluster: entries 0 and 1 have very similar embeddings
  makeDBEntry(
    'b0000000-0000-4000-a000-000000000001',
    'The auth middleware validates JWT tokens and checks the agent scope claim before allowing access to diary endpoints.',
    [1, 0.1, 0],
    {
      title: 'Auth middleware JWT validation',
      tags: ['auth'],
      importance: 8,
    },
  ),
  makeDBEntry(
    'b0000000-0000-4000-a000-000000000002',
    'JWT tokens must include the agent scope. Without it the server returns 403 Forbidden on all protected routes.',
    [0.95, 0.15, 0.05],
    {
      title: 'Agent scope requirement',
      tags: ['auth'],
      importance: 7,
    },
  ),
  // Database cluster: entries 2 and 3 have very similar embeddings
  makeDBEntry(
    'b0000000-0000-4000-a000-000000000003',
    'Schema uses Drizzle ORM with pgvector for 384-dim embeddings. Tables use UUID primary keys and cascade deletes.',
    [0, 1, 0.1],
    {
      title: 'Database schema patterns',
      tags: ['database'],
      importance: 7,
    },
  ),
  makeDBEntry(
    'b0000000-0000-4000-a000-000000000004',
    'All database tables use UUID primary keys via defaultRandom. Foreign keys cascade on delete. Drizzle ORM manages migrations.',
    [0.05, 0.95, 0.15],
    {
      title: 'Database table conventions',
      tags: ['database'],
      importance: 6,
    },
  ),
  // Outlier: unrelated to either cluster
  makeDBEntry(
    'b0000000-0000-4000-a000-000000000005',
    'Deploy to Fly.io using the Dockerfile. Set DATABASE_URL and ORY_PROJECT_URL as secrets.',
    [0, 0, 1],
    {
      entryType: 'procedural',
      title: 'Deployment steps',
      tags: ['deployment'],
      importance: 4,
    },
  ),
];

function toDistillEntry(entry: DBEntry): DistillEntry {
  return {
    id: entry.id,
    embedding: entry.embedding,
    content: entry.content,
    tokens: entry.tokens,
    importance: entry.importance,
    createdAt: '2026-03-16T12:00:00.000Z',
  };
}

/** Build a CID lookup map from entry fixtures. */
function buildCidLookup(entries: DBEntry[]): Map<string, string> {
  return new Map(entries.map((e) => [e.id, e.contentHash]));
}

// ── Setup ────────────────────────────────────────────────────────────────────

describe('entry relations from consolidation (integration)', () => {
  let db: Database;
  let pool: Pool;
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
    pool.on('error', (error: { code?: string }) => {
      if (error.code === '57P01') return;
      throw error;
    });
    entryRepo = createDiaryEntryRepository(db);
    relationRepo = createEntryRelationRepository(db);

    // Seed diary
    await db.insert(diaries).values({
      id: DIARY_ID,
      ownerId: OWNER_ID,
      name: 'Relations Test Diary',
      visibility: 'private',
    });

    // Seed entries
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
    await db.delete(entryRelations);
  });

  afterAll(async () => {
    if (!db || !pool || !stopContainer) return;
    await db.delete(entryRelations);
    await db.delete(diaryEntries).where(eq(diaryEntries.diaryId, DIARY_ID));
    await db.delete(diaries).where(eq(diaries.id, DIARY_ID));
    await pool.end();
    await stopContainer();
  });

  // ── consolidate() → relation proposals ─────────────────────────────────

  describe('consolidate() clusters → relation proposals', () => {
    it('consolidate groups similar entries into clusters', () => {
      const distillEntries = ENTRIES.map(toDistillEntry);
      const result = consolidate(distillEntries, { threshold: 0.15 });

      // Should produce fewer clusters than entries (similar ones grouped)
      expect(result.stats.clusterCount).toBeLessThan(result.stats.inputCount);
      expect(result.stats.inputCount).toBe(5);

      // At least one cluster should have >1 member (the auth or database pair)
      const multiMemberClusters = result.clusters.filter(
        (c) => c.members.length > 1,
      );
      expect(multiMemberClusters.length).toBeGreaterThan(0);
    });

    it('maps clusters to proposed relation edges with CID snapshots', () => {
      const distillEntries = ENTRIES.map(toDistillEntry);
      const result = consolidate(distillEntries, { threshold: 0.15 });

      const proposals = clusterToRelationProposals(
        result.clusters,
        buildCidLookup(ENTRIES),
        'consolidate-wf-test-001',
      );

      // Should have proposals from multi-member clusters
      expect(proposals.length).toBeGreaterThan(0);

      // Each proposal has valid CID snapshots
      const entryMap = new Map(ENTRIES.map((e) => [e.id, e]));
      for (const proposal of proposals) {
        expect(entryMap.has(proposal.sourceId)).toBe(true);
        expect(entryMap.has(proposal.targetId)).toBe(true);
        expect(proposal.sourceCidSnapshot).toBe(
          entryMap.get(proposal.sourceId)!.contentHash,
        );
        expect(proposal.targetCidSnapshot).toBe(
          entryMap.get(proposal.targetId)!.contentHash,
        );
      }
    });
    it('tight threshold (low distance tolerance) → all singletons → no proposals', () => {
      const distillEntries = ENTRIES.map(toDistillEntry);
      // threshold is cosine distance: 0.001 = entries must be nearly identical
      const result = consolidate(distillEntries, { threshold: 0.001 });

      // All clusters should be singletons
      expect(result.stats.singletonRate).toBe(1);
      expect(result.stats.clusterCount).toBe(result.stats.inputCount);

      const proposals = clusterToRelationProposals(
        result.clusters,
        buildCidLookup(ENTRIES),
        'consolidate-wf-no-clusters',
      );

      // No multi-member clusters → no proposals
      expect(proposals).toHaveLength(0);
    });

    it('loose threshold (high distance tolerance) → one cluster → proposals span all entries', () => {
      const distillEntries = ENTRIES.map(toDistillEntry);
      // threshold is cosine distance: 1.0 = any pair is close enough → one cluster
      const result = consolidate(distillEntries, { threshold: 1.0 });

      expect(result.stats.clusterCount).toBe(1);
      expect(result.clusters[0].members).toHaveLength(ENTRIES.length);

      const proposals = clusterToRelationProposals(
        result.clusters,
        buildCidLookup(ENTRIES),
        'consolidate-wf-collapsed',
      );

      // One cluster with 5 members → 4 proposals (rep supports each non-rep)
      expect(proposals).toHaveLength(ENTRIES.length - 1);
    });
  });

  // ── Persist and manage relation proposals ──────────────────────────────

  describe('relation proposal lifecycle', () => {
    it('persists proposal batches atomically with createMany', async () => {
      const distillEntries = ENTRIES.map(toDistillEntry);
      const result = consolidate(distillEntries, { threshold: 0.15 });
      const proposals = clusterToRelationProposals(
        result.clusters,
        buildCidLookup(ENTRIES),
        'consolidate-wf-batch-001',
      );

      const created = await relationRepo.createMany(
        proposals.map((proposal) => ({
          ...proposal,
          status: 'proposed',
          workflowId: 'consolidate-wf-batch-001',
          metadata: proposal.metadata,
        })),
      );

      expect(created).toHaveLength(proposals.length);

      const persisted = await relationRepo.listByEntry(ENTRIES[0].id, {
        status: 'proposed',
      });
      expect(persisted.length).toBeGreaterThan(0);
    });

    it('persists proposed relations from consolidation clusters', async () => {
      const distillEntries = ENTRIES.map(toDistillEntry);
      const result = consolidate(distillEntries, { threshold: 0.15 });
      const proposals = clusterToRelationProposals(
        result.clusters,
        buildCidLookup(ENTRIES),
        'consolidate-wf-persist-001',
      );

      // Persist all proposals
      for (const proposal of proposals) {
        await relationRepo.create({
          ...proposal,
          status: 'proposed',
          workflowId: 'consolidate-wf-persist-001',
          metadata: proposal.metadata,
        });
      }

      // Query back: all proposals exist
      for (const proposal of proposals) {
        const relations = await relationRepo.listByEntry(proposal.sourceId, {
          status: 'proposed',
        });
        expect(relations.length).toBeGreaterThan(0);
      }
    });

    it('proposed → accepted lifecycle', async () => {
      const relation = await relationRepo.create({
        sourceId: ENTRIES[0].id,
        targetId: ENTRIES[1].id,
        relation: 'supports',
        status: 'proposed',
        sourceCidSnapshot: ENTRIES[0].contentHash,
        targetCidSnapshot: ENTRIES[1].contentHash,
        workflowId: 'consolidate-wf-accept-001',
        metadata: { similarity: 0.92 },
      });

      expect(relation.status).toBe('proposed');

      const accepted = await relationRepo.updateStatus(relation.id, 'accepted');
      expect(accepted).not.toBeNull();
      expect(accepted!.status).toBe('accepted');
    });

    it('proposed → rejected lifecycle', async () => {
      const relation = await relationRepo.create({
        sourceId: ENTRIES[2].id,
        targetId: ENTRIES[4].id,
        relation: 'supports',
        status: 'proposed',
        metadata: {},
      });

      const rejected = await relationRepo.updateStatus(relation.id, 'rejected');
      expect(rejected).not.toBeNull();
      expect(rejected!.status).toBe('rejected');
    });

    it('filters by status when querying', async () => {
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

      const accepted = await relationRepo.listByEntry(ENTRIES[0].id, {
        status: 'accepted',
      });
      expect(accepted).toHaveLength(1);

      const proposed = await relationRepo.listByEntry(ENTRIES[0].id, {
        status: 'proposed',
      });
      expect(proposed).toHaveLength(1);

      const all = await relationRepo.listByEntry(ENTRIES[0].id);
      expect(all).toHaveLength(2);
    });
  });

  // ── Combined: consolidate → relations → compile → navigate ─────────────

  describe('full lifecycle: consolidate → relations → compile → navigate', () => {
    it('consolidation informs relations, compile uses same entries, both navigable', async () => {
      const distillEntries = ENTRIES.map(toDistillEntry);

      // Step 1: Consolidate → cluster → propose relations
      const consolidateResult = consolidate(distillEntries, {
        threshold: 0.15,
      });
      const proposals = clusterToRelationProposals(
        consolidateResult.clusters,
        buildCidLookup(ENTRIES),
        'consolidate-wf-lifecycle',
      );

      // Persist and accept all proposals
      for (const proposal of proposals) {
        const rel = await relationRepo.create({
          ...proposal,
          status: 'proposed',
          workflowId: 'consolidate-wf-lifecycle',
          metadata: proposal.metadata,
        });
        await relationRepo.updateStatus(rel.id, 'accepted');
      }

      // Step 2: Compile same entries
      const compileResult = compile(distillEntries, { tokenBudget: 10000 });
      expect(compileResult.entries.length).toBeGreaterThan(0);

      // Step 3: For each compiled entry, check its relations
      const compiledIds = new Set(compileResult.entries.map((e) => e.id));
      let relatedPairsFound = 0;

      for (const entryId of compiledIds) {
        const relations = await relationRepo.listByEntry(entryId, {
          status: 'accepted',
        });
        if (relations.length > 0) {
          relatedPairsFound++;
          // Verify CID snapshots are still valid
          for (const rel of relations) {
            if (rel.sourceCidSnapshot) {
              const sourceEntry = await entryRepo.findById(rel.sourceId);
              expect(rel.sourceCidSnapshot).toBe(sourceEntry!.contentHash);
            }
          }
        }
      }

      // At least some compiled entries should have relations
      expect(relatedPairsFound).toBeGreaterThan(0);
    });
  });
});
