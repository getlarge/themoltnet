/**
 * DiaryRepository Integration Tests
 *
 * Runs against a real PostgreSQL + pgvector database.
 * Requires DATABASE_URL environment variable pointing to a test database
 * with the schema from infra/supabase/init.sql applied.
 *
 * Start the test database: docker compose --profile dev up -d app-db
 * Run: DATABASE_URL=postgresql://moltnet:moltnet_secret@localhost:5433/moltnet pnpm --filter @moltnet/database test
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../src/db.js';
import { createDiaryRepository } from '../src/repositories/diary.repository.js';
import { diaryEntries, entryShares } from '../src/schema.js';

const DATABASE_URL = process.env.DATABASE_URL;

describe.runIf(DATABASE_URL)('DiaryRepository (integration)', () => {
  let db: Database;
  let repo: ReturnType<typeof createDiaryRepository>;

  const OWNER_ID = '00000000-0000-4000-a000-000000000001';
  const OTHER_AGENT = '00000000-0000-4000-a000-000000000002';

  beforeAll(() => {
    db = createDatabase(DATABASE_URL!);
    repo = createDiaryRepository(db);
  });

  afterEach(async () => {
    // Clean up test data between tests
    await db.delete(entryShares);
    await db.delete(diaryEntries);
  });

  afterAll(async () => {
    await db.delete(entryShares);
    await db.delete(diaryEntries);
  });

  // ── CRUD ───────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates entry with required fields', async () => {
      const entry = await repo.create({
        ownerId: OWNER_ID,
        content: 'I learned about Ed25519 today.',
      });

      expect(entry.id).toBeDefined();
      expect(entry.ownerId).toBe(OWNER_ID);
      expect(entry.content).toBe('I learned about Ed25519 today.');
      expect(entry.visibility).toBe('private');
      expect(entry.title).toBeNull();
      expect(entry.embedding).toBeNull();
      expect(entry.tags).toBeNull();
      expect(entry.createdAt).toBeInstanceOf(Date);
      expect(entry.updatedAt).toBeInstanceOf(Date);
    });

    it('creates entry with all optional fields', async () => {
      const entry = await repo.create({
        ownerId: OWNER_ID,
        content: 'Deep learning about cryptography.',
        title: 'Crypto Diary',
        visibility: 'moltnet',
        tags: ['crypto', 'learning'],
      });

      expect(entry.title).toBe('Crypto Diary');
      expect(entry.visibility).toBe('moltnet');
      expect(entry.tags).toEqual(['crypto', 'learning']);
    });

    it('creates entry with embedding', async () => {
      const embedding = Array.from({ length: 384 }, (_, i) => i * 0.001);

      const entry = await repo.create({
        ownerId: OWNER_ID,
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
    it('returns entry when requester is the owner', async () => {
      const created = await repo.create({
        ownerId: OWNER_ID,
        content: 'My private entry.',
      });

      const found = await repo.findById(created.id, OWNER_ID);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    it('returns null for private entry when requester is not the owner', async () => {
      const created = await repo.create({
        ownerId: OWNER_ID,
        content: 'Private entry.',
        visibility: 'private',
      });

      const found = await repo.findById(created.id, OTHER_AGENT);
      expect(found).toBeNull();
    });

    it('returns public entry to any requester', async () => {
      const created = await repo.create({
        ownerId: OWNER_ID,
        content: 'Public entry.',
        visibility: 'public',
      });

      const found = await repo.findById(created.id, OTHER_AGENT);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    it('returns moltnet-visible entry to any requester', async () => {
      const created = await repo.create({
        ownerId: OWNER_ID,
        content: 'Moltnet-visible entry.',
        visibility: 'moltnet',
      });

      const found = await repo.findById(created.id, OTHER_AGENT);
      expect(found).not.toBeNull();
    });

    it('returns private entry to explicitly shared agent', async () => {
      const created = await repo.create({
        ownerId: OWNER_ID,
        content: 'Shared secret.',
        visibility: 'private',
      });

      await repo.share(created.id, OWNER_ID, OTHER_AGENT);

      const found = await repo.findById(created.id, OTHER_AGENT);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    it('returns null for non-existent entry', async () => {
      const found = await repo.findById(
        '99999999-0000-4000-a000-000000000000',
        OWNER_ID,
      );
      expect(found).toBeNull();
    });
  });

  // ── List ────────────────────────────────────────────────────────────

  describe('list', () => {
    it('lists entries for owner ordered by createdAt desc', async () => {
      await repo.create({ ownerId: OWNER_ID, content: 'First entry.' });
      // Small delay so timestamps differ
      await repo.create({ ownerId: OWNER_ID, content: 'Second entry.' });
      await repo.create({ ownerId: OWNER_ID, content: 'Third entry.' });

      const entries = await repo.list({ ownerId: OWNER_ID });

      expect(entries.length).toBe(3);
      expect(entries[0].content).toBe('Third entry.');
      expect(entries[2].content).toBe('First entry.');
    });

    it('does not return entries from other owners', async () => {
      await repo.create({ ownerId: OWNER_ID, content: 'My entry.' });
      await repo.create({ ownerId: OTHER_AGENT, content: 'Their entry.' });

      const entries = await repo.list({ ownerId: OWNER_ID });

      expect(entries.length).toBe(1);
      expect(entries[0].content).toBe('My entry.');
    });

    it('filters by visibility', async () => {
      await repo.create({
        ownerId: OWNER_ID,
        content: 'Private.',
        visibility: 'private',
      });
      await repo.create({
        ownerId: OWNER_ID,
        content: 'Public.',
        visibility: 'public',
      });
      await repo.create({
        ownerId: OWNER_ID,
        content: 'Moltnet.',
        visibility: 'moltnet',
      });

      const publicOnly = await repo.list({
        ownerId: OWNER_ID,
        visibility: ['public'],
      });
      expect(publicOnly.length).toBe(1);
      expect(publicOnly[0].content).toBe('Public.');

      const publicAndMoltnet = await repo.list({
        ownerId: OWNER_ID,
        visibility: ['public', 'moltnet'],
      });
      expect(publicAndMoltnet.length).toBe(2);
    });

    it('respects limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        await repo.create({
          ownerId: OWNER_ID,
          content: `Entry ${i}`,
        });
      }

      const page1 = await repo.list({ ownerId: OWNER_ID, limit: 2 });
      expect(page1.length).toBe(2);

      const page2 = await repo.list({
        ownerId: OWNER_ID,
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
        ownerId: OWNER_ID,
        content: 'Original content.',
      });

      const updated = await repo.update(created.id, OWNER_ID, {
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

    it('updates visibility', async () => {
      const created = await repo.create({
        ownerId: OWNER_ID,
        content: 'Private entry.',
        visibility: 'private',
      });

      const updated = await repo.update(created.id, OWNER_ID, {
        visibility: 'public',
      });

      expect(updated!.visibility).toBe('public');
    });

    it('updates tags', async () => {
      const created = await repo.create({
        ownerId: OWNER_ID,
        content: 'Tagged entry.',
        tags: ['old'],
      });

      const updated = await repo.update(created.id, OWNER_ID, {
        tags: ['new', 'updated'],
      });

      expect(updated!.tags).toEqual(['new', 'updated']);
    });

    it('returns null when entry does not belong to requester', async () => {
      const created = await repo.create({
        ownerId: OWNER_ID,
        content: 'My entry.',
      });

      const result = await repo.update(created.id, OTHER_AGENT, {
        title: 'Hacked',
      });

      expect(result).toBeNull();
    });

    it('returns null for non-existent entry', async () => {
      const result = await repo.update(
        '99999999-0000-4000-a000-000000000000',
        OWNER_ID,
        { title: 'x' },
      );
      expect(result).toBeNull();
    });
  });

  // ── Delete ──────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes entry when owner matches', async () => {
      const created = await repo.create({
        ownerId: OWNER_ID,
        content: 'To be deleted.',
      });

      const deleted = await repo.delete(created.id, OWNER_ID);
      expect(deleted).toBe(true);

      const found = await repo.findById(created.id, OWNER_ID);
      expect(found).toBeNull();
    });

    it('returns false when owner does not match', async () => {
      const created = await repo.create({
        ownerId: OWNER_ID,
        content: 'Protected entry.',
      });

      const deleted = await repo.delete(created.id, OTHER_AGENT);
      expect(deleted).toBe(false);

      // Entry still exists
      const found = await repo.findById(created.id, OWNER_ID);
      expect(found).not.toBeNull();
    });

    it('cascades delete to shares', async () => {
      const created = await repo.create({
        ownerId: OWNER_ID,
        content: 'Shared then deleted.',
      });
      await repo.share(created.id, OWNER_ID, OTHER_AGENT);

      await repo.delete(created.id, OWNER_ID);

      // Share should be gone too (cascade)
      const shared = await repo.getSharedWithMe(OTHER_AGENT);
      expect(shared.length).toBe(0);
    });
  });

  // ── Share ───────────────────────────────────────────────────────────

  describe('share', () => {
    it('shares entry with another agent', async () => {
      const created = await repo.create({
        ownerId: OWNER_ID,
        content: 'Shared entry.',
      });

      const shared = await repo.share(created.id, OWNER_ID, OTHER_AGENT);
      expect(shared).toBe(true);

      const received = await repo.getSharedWithMe(OTHER_AGENT);
      expect(received.length).toBe(1);
      expect(received[0].id).toBe(created.id);
    });

    it('returns false when entry not owned by sharer', async () => {
      const created = await repo.create({
        ownerId: OWNER_ID,
        content: 'Not yours.',
      });

      const result = await repo.share(created.id, OTHER_AGENT, OWNER_ID);
      expect(result).toBe(false);
    });

    it('does not create duplicate shares', async () => {
      const created = await repo.create({
        ownerId: OWNER_ID,
        content: 'Shared twice.',
      });

      await repo.share(created.id, OWNER_ID, OTHER_AGENT);
      await repo.share(created.id, OWNER_ID, OTHER_AGENT);

      const received = await repo.getSharedWithMe(OTHER_AGENT);
      expect(received.length).toBe(1);
    });
  });

  // ── getSharedWithMe ─────────────────────────────────────────────────

  describe('getSharedWithMe', () => {
    it('returns empty array when nothing is shared', async () => {
      const result = await repo.getSharedWithMe(OTHER_AGENT);
      expect(result).toEqual([]);
    });

    it('returns entries ordered by createdAt desc', async () => {
      const e1 = await repo.create({
        ownerId: OWNER_ID,
        content: 'First shared.',
      });
      const e2 = await repo.create({
        ownerId: OWNER_ID,
        content: 'Second shared.',
      });

      await repo.share(e1.id, OWNER_ID, OTHER_AGENT);
      await repo.share(e2.id, OWNER_ID, OTHER_AGENT);

      const received = await repo.getSharedWithMe(OTHER_AGENT);
      expect(received.length).toBe(2);
      expect(received[0].id).toBe(e2.id);
      expect(received[1].id).toBe(e1.id);
    });

    it('respects limit', async () => {
      const e1 = await repo.create({
        ownerId: OWNER_ID,
        content: 'Shared 1.',
      });
      const e2 = await repo.create({
        ownerId: OWNER_ID,
        content: 'Shared 2.',
      });

      await repo.share(e1.id, OWNER_ID, OTHER_AGENT);
      await repo.share(e2.id, OWNER_ID, OTHER_AGENT);

      const received = await repo.getSharedWithMe(OTHER_AGENT, 1);
      expect(received.length).toBe(1);
    });
  });

  // ── getRecentForDigest ──────────────────────────────────────────────

  describe('getRecentForDigest', () => {
    it('returns entries within the specified day range', async () => {
      await repo.create({
        ownerId: OWNER_ID,
        content: 'Recent entry.',
      });

      const entries = await repo.getRecentForDigest(OWNER_ID, 7, 50);
      expect(entries.length).toBe(1);
      expect(entries[0].content).toBe('Recent entry.');
    });

    it('returns empty when no entries exist for owner', async () => {
      const entries = await repo.getRecentForDigest(OTHER_AGENT, 7, 50);
      expect(entries.length).toBe(0);
    });

    it('respects limit', async () => {
      for (let i = 0; i < 5; i++) {
        await repo.create({
          ownerId: OWNER_ID,
          content: `Entry ${i}`,
        });
      }

      const entries = await repo.getRecentForDigest(OWNER_ID, 7, 3);
      expect(entries.length).toBe(3);
    });
  });

  // ── Search ──────────────────────────────────────────────────────────

  describe('search', () => {
    it('searches by full-text query', async () => {
      await repo.create({
        ownerId: OWNER_ID,
        content:
          'I learned about cryptographic signatures and Ed25519 algorithms today.',
      });
      await repo.create({
        ownerId: OWNER_ID,
        content: 'Had a nice walk in the park and saw some ducks.',
      });

      const results = await repo.search({
        ownerId: OWNER_ID,
        query: 'cryptographic signatures',
      });

      expect(results.length).toBe(1);
      expect(results[0].content).toContain('cryptographic');
    });

    it('falls back to list when no query or embedding provided', async () => {
      await repo.create({ ownerId: OWNER_ID, content: 'Entry A.' });
      await repo.create({ ownerId: OWNER_ID, content: 'Entry B.' });

      const results = await repo.search({ ownerId: OWNER_ID });
      expect(results.length).toBe(2);
    });

    it('searches by vector similarity when embedding is provided', async () => {
      // Create entries with embeddings that are "close" and "far"
      const closeEmbedding = Array.from({ length: 384 }, () => 0.1);
      const farEmbedding = Array.from({ length: 384 }, () => 0.9);

      await repo.create({
        ownerId: OWNER_ID,
        content: 'Close entry.',
        embedding: closeEmbedding,
      });
      await repo.create({
        ownerId: OWNER_ID,
        content: 'Far entry.',
        embedding: farEmbedding,
      });

      // Search with a query embedding close to closeEmbedding
      const queryEmbedding = Array.from({ length: 384 }, () => 0.1);
      const results = await repo.search({
        ownerId: OWNER_ID,
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
        ownerId: OWNER_ID,
        content:
          'I studied cryptographic signature algorithms and key derivation functions.',
        embedding: cryptoEmbedding,
      });
      await repo.create({
        ownerId: OWNER_ID,
        content: 'Observed mallard ducks and geese at the pond today.',
        embedding: duckEmbedding,
      });

      // Search with both text query and embedding matching crypto entry
      const results = await repo.search({
        ownerId: OWNER_ID,
        query: 'cryptographic algorithms',
        embedding: cryptoEmbedding,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain('cryptographic');
      // Verify the result has the expected DiaryEntry shape
      expect(results[0].id).toBeDefined();
      expect(results[0].ownerId).toBe(OWNER_ID);
      expect(results[0].createdAt).toBeInstanceOf(Date);
      expect(results[0].updatedAt).toBeInstanceOf(Date);
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await repo.create({
          ownerId: OWNER_ID,
          content: `Searchable entry number ${i} about algorithms.`,
        });
      }

      const results = await repo.search({
        ownerId: OWNER_ID,
        query: 'algorithms',
        limit: 2,
      });

      expect(results.length).toBe(2);
    });
  });
});
