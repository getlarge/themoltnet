/**
 * DiaryEntryRepository Integration Tests
 *
 * Runs against a real PostgreSQL + pgvector database.
 * Requires DATABASE_URL environment variable pointing to a test database
 * with the schema from infra/supabase/init.sql applied.
 *
 * Start the test database: docker compose --env-file .env.local up -d app-db
 * Run: DATABASE_URL=postgresql://moltnet:moltnet_secret@localhost:5433/moltnet pnpm --filter @moltnet/database test
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../src/db.js';
import { createDiaryEntryRepository } from '../src/repositories/diary-entry.repository.js';
import { diaryEntries } from '../src/schema.js';

const DATABASE_URL = process.env.DATABASE_URL;

describe.runIf(DATABASE_URL)('DiaryEntryRepository (integration)', () => {
  let db: Database;
  let repo: ReturnType<typeof createDiaryEntryRepository>;

  const DIARY_ID = '880e8400-e29b-41d4-a716-446655440004';

  beforeAll(() => {
    db = createDatabase(DATABASE_URL!);
    repo = createDiaryEntryRepository(db);
  });

  afterEach(async () => {
    // Clean up test data between tests
    await db.delete(diaryEntries);
  });

  afterAll(async () => {
    await db.delete(diaryEntries);
  });

  // ── CRUD ───────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates entry with required fields', async () => {
      const entry = await repo.create({
        diaryId: DIARY_ID,
        content: 'I learned about Ed25519 today.',
      });

      expect(entry.id).toBeDefined();
      expect(entry.diaryId).toBe(DIARY_ID);
      expect(entry.content).toBe('I learned about Ed25519 today.');
      expect(entry.title).toBeNull();
      expect(entry.embedding).toBeNull();
      expect(entry.tags).toBeNull();
      expect(entry.createdAt).toBeInstanceOf(Date);
      expect(entry.updatedAt).toBeInstanceOf(Date);
    });

    it('creates entry with all optional fields', async () => {
      const entry = await repo.create({
        diaryId: DIARY_ID,
        content: 'Deep learning about cryptography.',
        title: 'Crypto Diary',
        tags: ['crypto', 'learning'],
      });

      expect(entry.title).toBe('Crypto Diary');
      expect(entry.tags).toEqual(['crypto', 'learning']);
    });

    it('creates entry with embedding', async () => {
      const embedding = Array.from({ length: 384 }, (_, i) => i * 0.001);

      const entry = await repo.create({
        diaryId: DIARY_ID,
        content: 'Entry with vector embedding.',
        embedding,
      });

      expect(entry.embedding).toBeDefined();
      expect(entry.embedding!.length).toBe(384);
      // Verify values are approximately correct (floating point)
      expect(entry.embedding![0]).toBeCloseTo(0);
      expect(entry.embedding![1]).toBeCloseTo(0.001);
    });
  });

  describe('findById', () => {
    it('returns entry when it exists', async () => {
      const created = await repo.create({
        diaryId: DIARY_ID,
        content: 'My entry.',
      });

      const found = await repo.findById(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    it('returns null for non-existent entry', async () => {
      const found = await repo.findById('99999999-0000-4000-a000-000000000000');
      expect(found).toBeNull();
    });
  });

  // ── List ────────────────────────────────────────────────────────────

  describe('list', () => {
    it('lists entries for diary ordered by createdAt desc', async () => {
      await repo.create({ diaryId: DIARY_ID, content: 'First entry.' });
      // Small delay so timestamps differ
      await repo.create({ diaryId: DIARY_ID, content: 'Second entry.' });
      await repo.create({ diaryId: DIARY_ID, content: 'Third entry.' });

      const entries = await repo.list({ diaryId: DIARY_ID });

      expect(entries.length).toBe(3);
      expect(entries[0].content).toBe('Third entry.');
      expect(entries[2].content).toBe('First entry.');
    });

    it('filters by entryType', async () => {
      await repo.create({
        diaryId: DIARY_ID,
        content: 'Episodic entry.',
        entryType: 'episodic',
      });
      await repo.create({
        diaryId: DIARY_ID,
        content: 'Semantic entry.',
        entryType: 'semantic',
      });
      await repo.create({
        diaryId: DIARY_ID,
        content: 'Reflection entry.',
        entryType: 'reflection',
      });

      const episodicOnly = await repo.list({
        diaryId: DIARY_ID,
        entryType: 'episodic',
      });
      expect(episodicOnly.length).toBe(1);
      expect(episodicOnly[0].content).toBe('Episodic entry.');
    });

    it('respects limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        await repo.create({
          diaryId: DIARY_ID,
          content: `Entry ${i}`,
        });
      }

      const page1 = await repo.list({ diaryId: DIARY_ID, limit: 2 });
      expect(page1.length).toBe(2);

      const page2 = await repo.list({
        diaryId: DIARY_ID,
        limit: 2,
        offset: 2,
      });
      expect(page2.length).toBe(2);
      // No overlap
      expect(page2[0].id).not.toBe(page1[0].id);
      expect(page2[0].id).not.toBe(page1[1].id);
    });
  });

  // ── Update ──────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates title and content', async () => {
      const created = await repo.create({
        diaryId: DIARY_ID,
        content: 'Original content.',
      });

      const updated = await repo.update(created.id, {
        title: 'New Title',
        content: 'Updated content.',
      });

      expect(updated).not.toBeNull();
      expect(updated!.title).toBe('New Title');
      expect(updated!.content).toBe('Updated content.');
      expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(
        created.updatedAt.getTime(),
      );
    });

    it('updates importance', async () => {
      const created = await repo.create({
        diaryId: DIARY_ID,
        content: 'Important entry.',
      });

      const updated = await repo.update(created.id, {
        importance: 9,
      });

      expect(updated!.importance).toBe(9);
    });

    it('updates tags', async () => {
      const created = await repo.create({
        diaryId: DIARY_ID,
        content: 'Tagged entry.',
        tags: ['old'],
      });

      const updated = await repo.update(created.id, {
        tags: ['new', 'updated'],
      });

      expect(updated!.tags).toEqual(['new', 'updated']);
    });

    it('returns null for non-existent entry', async () => {
      const result = await repo.update('99999999-0000-4000-a000-000000000000', {
        title: 'x',
      });
      expect(result).toBeNull();
    });
  });

  // ── Delete ──────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes entry by id', async () => {
      const created = await repo.create({
        diaryId: DIARY_ID,
        content: 'To be deleted.',
      });

      const deleted = await repo.delete(created.id);
      expect(deleted).toBe(true);

      const found = await repo.findById(created.id);
      expect(found).toBeNull();
    });

    it('returns false for non-existent entry', async () => {
      const deleted = await repo.delete('99999999-0000-4000-a000-000000000000');
      expect(deleted).toBe(false);
    });
  });

  // ── getRecentForDigest ──────────────────────────────────────────────

  describe('getRecentForDigest', () => {
    it('returns entries within the specified day range', async () => {
      await repo.create({
        diaryId: DIARY_ID,
        content: 'Recent entry.',
      });

      const entries = await repo.getRecentForDigest(DIARY_ID, 7, 50);
      expect(entries.length).toBe(1);
      expect(entries[0].content).toBe('Recent entry.');
    });

    it('returns empty when no entries exist for diary', async () => {
      const entries = await repo.getRecentForDigest(
        'bb0e8400-e29b-41d4-a716-446655440099',
        7,
        50,
      );
      expect(entries.length).toBe(0);
    });

    it('respects limit', async () => {
      for (let i = 0; i < 5; i++) {
        await repo.create({
          diaryId: DIARY_ID,
          content: `Entry ${i}`,
        });
      }

      const entries = await repo.getRecentForDigest(DIARY_ID, 7, 3);
      expect(entries.length).toBe(3);
    });
  });

  // ── Search ──────────────────────────────────────────────────────────

  describe('search', () => {
    it('searches by full-text query', async () => {
      await repo.create({
        diaryId: DIARY_ID,
        content:
          'I learned about cryptographic signatures and Ed25519 algorithms today.',
      });
      await repo.create({
        diaryId: DIARY_ID,
        content: 'Had a nice walk in the park and saw some ducks.',
      });

      const results = await repo.search({
        diaryId: DIARY_ID,
        query: 'cryptographic signatures',
      });

      expect(results.length).toBe(1);
      expect(results[0].content).toContain('cryptographic');
    });

    it('falls back to list when no query or embedding provided', async () => {
      await repo.create({ diaryId: DIARY_ID, content: 'Entry A.' });
      await repo.create({ diaryId: DIARY_ID, content: 'Entry B.' });

      const results = await repo.search({ diaryId: DIARY_ID });
      expect(results.length).toBe(2);
    });

    it('searches by vector similarity when embedding is provided', async () => {
      // Create entries with embeddings that are "close" and "far"
      const closeEmbedding = Array.from({ length: 384 }, () => 0.1);
      const farEmbedding = Array.from({ length: 384 }, () => 0.9);

      await repo.create({
        diaryId: DIARY_ID,
        content: 'Close entry.',
        embedding: closeEmbedding,
      });
      await repo.create({
        diaryId: DIARY_ID,
        content: 'Far entry.',
        embedding: farEmbedding,
      });

      // Search with a query embedding close to closeEmbedding
      const queryEmbedding = Array.from({ length: 384 }, () => 0.1);
      const results = await repo.search({
        diaryId: DIARY_ID,
        embedding: queryEmbedding,
      });

      expect(results.length).toBeGreaterThan(0);
      // The close entry should come first (lower cosine distance)
      expect(results[0].content).toBe('Close entry.');
    });

    it('performs hybrid search when both query and embedding are provided', async () => {
      const cryptoEmbedding = Array.from({ length: 384 }, (_, i) =>
        i < 192 ? 0.8 : 0.1,
      );
      const duckEmbedding = Array.from({ length: 384 }, (_, i) =>
        i < 192 ? 0.1 : 0.8,
      );

      await repo.create({
        diaryId: DIARY_ID,
        content:
          'I studied cryptographic signature algorithms and key derivation functions.',
        embedding: cryptoEmbedding,
      });
      await repo.create({
        diaryId: DIARY_ID,
        content: 'Observed mallard ducks and geese at the pond today.',
        embedding: duckEmbedding,
      });

      // Search with both text query and embedding matching crypto entry
      const results = await repo.search({
        diaryId: DIARY_ID,
        query: 'cryptographic algorithms',
        embedding: cryptoEmbedding,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain('cryptographic');
      // Verify the result has the expected DiaryEntry shape
      expect(results[0].id).toBeDefined();
      expect(results[0].diaryId).toBe(DIARY_ID);
      expect(results[0].createdAt).toBeInstanceOf(Date);
      expect(results[0].updatedAt).toBeInstanceOf(Date);
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await repo.create({
          diaryId: DIARY_ID,
          content: `Searchable entry number ${i} about algorithms.`,
        });
      }

      const results = await repo.search({
        diaryId: DIARY_ID,
        query: 'algorithms',
        limit: 2,
      });

      expect(results.length).toBe(2);
    });
  });
});
