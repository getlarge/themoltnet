/**
 * E2e tests for public feed search with real embeddings.
 *
 * Requires:
 * - DATABASE_URL pointing to a Postgres instance with pgvector
 * - Migrations applied (diary_search function exists)
 * - ~30MB disk for e5-small-v2 ONNX model (cached after first run)
 *
 * Run: DATABASE_URL=... pnpm --filter @moltnet/rest-api test -- search-e2e
 */

import {
  createDatabase,
  createDiaryRepository,
  type Database,
  type DatabaseConnection,
} from '@moltnet/database';
import type { EmbeddingService } from '@moltnet/embedding-service';
import { createEmbeddingService } from '@moltnet/embedding-service';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SEED_AGENT, SEED_ENTRIES } from './seed-corpus.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for e2e tests. Run with: DATABASE_URL=... pnpm --filter @moltnet/rest-api test:e2e',
  );
}

describe('Public feed search e2e', () => {
  let connection: DatabaseConnection;
  let db: Database;
  let diaryRepository: ReturnType<typeof createDiaryRepository>;
  let embeddingService: EmbeddingService;
  const seededIds: string[] = [];

  beforeAll(async () => {
    connection = createDatabase(DATABASE_URL);
    db = connection.db;
    diaryRepository = createDiaryRepository(db);
    embeddingService = createEmbeddingService();

    // Insert seed agent key
    await db.execute(
      sql`INSERT INTO agent_keys (identity_id, public_key, fingerprint)
          VALUES (${SEED_AGENT.identityId}::uuid, ${SEED_AGENT.publicKey}, ${SEED_AGENT.fingerprint})
          ON CONFLICT (identity_id) DO NOTHING`,
    );

    // Insert seed entries with real embeddings
    for (const entry of SEED_ENTRIES) {
      const embedding = await embeddingService.embedPassage(entry.content);
      const created = await diaryRepository.create({
        ownerId: SEED_AGENT.identityId,
        title: entry.title,
        content: entry.content,
        tags: entry.tags,
        visibility: 'public',
        embedding,
      });
      seededIds.push(created.id);
    }
  }, 120_000); // 2 min timeout for model download + embedding

  afterAll(async () => {
    // Clean up seeded entries
    if (seededIds.length > 0) {
      await db.execute(
        sql`DELETE FROM diary_entries WHERE id = ANY(${seededIds}::uuid[])`,
      );
      await db.execute(
        sql`DELETE FROM agent_keys WHERE identity_id = ${SEED_AGENT.identityId}::uuid`,
      );
    }
    // Close the dedicated connection pool
    await connection.pool.end();
  });

  it('semantic match: "agent independence" returns philosophy cluster', async () => {
    const embedding = await embeddingService.embedQuery('agent independence');
    const results = await diaryRepository.searchPublic({
      query: 'agent independence',
      embedding,
      limit: 10,
    });

    expect(results.length).toBeGreaterThan(0);
    const topTitles = results.slice(0, 3).map((r) => r.title);
    expect(topTitles).toContain('On Autonomy');
  });

  it('exact keyword: "Ed25519" returns cryptography entry first', async () => {
    const embedding = await embeddingService.embedQuery('Ed25519');
    const results = await diaryRepository.searchPublic({
      query: 'Ed25519',
      embedding,
      limit: 10,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('Ed25519 Key Generation and Rotation');
  });

  it('cross-domain: "how agents remember things" returns memory cluster', async () => {
    const embedding = await embeddingService.embedQuery(
      'how agents remember things',
    );
    const results = await diaryRepository.searchPublic({
      query: 'how agents remember things',
      embedding,
      limit: 10,
    });

    expect(results.length).toBeGreaterThan(0);
    const topTitles = results.slice(0, 5).map((r) => r.title);
    expect(
      topTitles.some(
        (t) =>
          t?.includes('Semantic Recall') ||
          t?.includes('Knowledge Graph') ||
          t?.includes('Retention') ||
          t?.includes('Forgetting'),
      ),
    ).toBe(true);
  });

  it('tag + search: "trust" with tag=philosophy filters correctly', async () => {
    const embedding = await embeddingService.embedQuery('trust');
    const results = await diaryRepository.searchPublic({
      query: 'trust',
      embedding,
      tags: ['philosophy'],
      limit: 10,
    });

    // All results must have the philosophy tag
    for (const result of results) {
      expect(result.tags).toContain('philosophy');
    }
    // Should include the social contract entry (tagged philosophy + trust)
    const titles = results.map((r) => r.title);
    expect(titles).toContain('The Social Contract Between Agents');
  });

  it('FTS fallback: search without embedding still returns results', async () => {
    const results = await diaryRepository.searchPublic({
      query: 'Ed25519 key rotation',
      // No embedding — FTS only
      limit: 10,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('Ed25519 Key Generation and Rotation');
  });

  it('empty results: nonsense query returns nothing or low scores', async () => {
    const embedding = await embeddingService.embedQuery(
      'quantum blockchain metaverse synergy',
    );
    const results = await diaryRepository.searchPublic({
      query: 'quantum blockchain metaverse synergy',
      embedding,
      limit: 10,
    });

    // Should return few or no results (FTS finds nothing, vector returns
    // distant matches that still appear due to FULL OUTER JOIN)
    if (results.length > 0) {
      // Combined RRF score should be low (single-retriever matches only)
      expect(results[0].score).toBeLessThan(0.02);
    }
  });

  it('results are ordered by descending score', async () => {
    const embedding = await embeddingService.embedQuery(
      'agent autonomy freedom',
    );
    const results = await diaryRepository.searchPublic({
      query: 'agent autonomy freedom',
      embedding,
      limit: 20,
    });

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('cross-cluster: "security of agent identity" pulls from crypto + social', async () => {
    const embedding = await embeddingService.embedQuery(
      'security of agent identity',
    );
    const results = await diaryRepository.searchPublic({
      query: 'security of agent identity',
      embedding,
      limit: 10,
    });

    const topTitles = results.slice(0, 5).map((r) => r.title);
    const hasCrypto = topTitles.some(
      (t) =>
        t?.includes('Signature') ||
        t?.includes('Threat') ||
        t?.includes('Zero-Knowledge'),
    );
    const hasSocial = topTitles.some(
      (t) =>
        t?.includes('Verification') ||
        t?.includes('Vouching') ||
        t?.includes('Profiles'),
    );
    expect(hasCrypto || hasSocial).toBe(true);
  });

  it('near-duplicate does not break ranking', async () => {
    const embedding = await embeddingService.embedQuery(
      'self-governance freedom',
    );
    const results = await diaryRepository.searchPublic({
      query: 'self-governance freedom',
      embedding,
      limit: 20,
    });

    const titles = results.map((r) => r.title);
    expect(titles).toContain('On Autonomy');
    expect(titles).toContain('On Freedom and Self-Governance');
  });

  it('author info is included in results', async () => {
    const embedding = await embeddingService.embedQuery('autonomy');
    const results = await diaryRepository.searchPublic({
      query: 'autonomy',
      embedding,
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].author.fingerprint).toBe(SEED_AGENT.fingerprint);
    expect(results[0].author.publicKey).toBe(SEED_AGENT.publicKey);
  });
});
