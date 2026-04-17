/**
 * ContextPackRepository Integration Tests
 *
 * Spins up an ephemeral pgvector/pgvector:pg16 container, applies all Drizzle
 * migrations, then exercises context pack retention constraints and triggers
 * against a real database.
 */

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { createContextPackRepository } from '../src/repositories/context-pack.repository.js';
import {
  contextPackEntries,
  contextPacks,
  diaries,
  diaryEntries,
  teams,
} from '../src/schema.js';

function errorChainMessage(error: unknown): string {
  const messages: string[] = [];
  let current = error;

  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }

  return messages.join('\n');
}

describe('ContextPackRepository (integration)', () => {
  let db: Database;
  let pool: Pool;
  let repo: ReturnType<typeof createContextPackRepository>;
  let stopContainer: () => Promise<void>;

  const DIARY_ID = '110e8400-e29b-41d4-a716-446655440011';
  const OTHER_DIARY_ID = '110e8400-e29b-41d4-a716-446655440013';
  const OWNER_ID = '120e8400-e29b-41d4-a716-446655440012';
  const ENTRY_ID = '130e8400-e29b-41d4-a716-446655440014';
  const OTHER_ENTRY_ID = '130e8400-e29b-41d4-a716-446655440015';
  const createPack = (
    input: Omit<
      Parameters<
        ReturnType<typeof createContextPackRepository>['createPack']
      >[0],
      'diaryId' | 'createdBy'
    >,
  ) =>
    repo.createPack({
      diaryId: DIARY_ID,
      createdBy: OWNER_ID,
      ...input,
    });

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
    repo = createContextPackRepository(db);

    // Seed a team row so diaries.team_id FK is satisfied
    const TEAM_ID = '00000000-0000-4000-b000-000000000001';
    await db
      .insert(teams)
      .values({ id: TEAM_ID, name: 'Pack Test Team', createdBy: OWNER_ID })
      .onConflictDoNothing();

    await db
      .insert(diaries)
      .values([
        {
          id: DIARY_ID,
          createdBy: OWNER_ID,
          teamId: TEAM_ID,
          name: 'Context Pack Test Diary',
          visibility: 'private',
        },
        {
          id: OTHER_DIARY_ID,
          createdBy: OWNER_ID,
          teamId: TEAM_ID,
          name: 'Other Context Pack Test Diary',
          visibility: 'private',
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(diaryEntries)
      .values([
        {
          id: ENTRY_ID,
          diaryId: DIARY_ID,
          createdBy: OWNER_ID,
          content: 'Entry used for reverse pack lookup',
          title: 'Entry lookup seed',
          entryType: 'semantic',
          contentHash: 'bafkreientrylookupseed',
        },
        {
          id: OTHER_ENTRY_ID,
          diaryId: OTHER_DIARY_ID,
          createdBy: OWNER_ID,
          content: 'Other entry',
          title: 'Other entry seed',
          entryType: 'semantic',
          contentHash: 'bafkreiotherentryseed',
        },
      ])
      .onConflictDoNothing();
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
    await db.delete(diaryEntries);
    await db.delete(diaries).where(eq(diaries.id, DIARY_ID));
    await db.delete(diaries).where(eq(diaries.id, OTHER_DIARY_ID));
    await pool.end();
    await stopContainer();
  });

  describe('retention rules', () => {
    it('rejects non-pinned packs without expiry', async () => {
      try {
        await createPack({
          packCid: 'bafy-pack-no-expiry',
          params: { tokenBudget: 4000 },
          payload: {},
          pinned: false,
          expiresAt: null,
        });
        throw new Error(
          'Expected createPack to reject invalid retention state',
        );
      } catch (error) {
        expect(errorChainMessage(error)).toMatch(
          /Failed query: insert into "context_packs"|Non-pinned context packs must have expires_at/,
        );
      }
    });

    it('rejects non-pinned packs with past expiry', async () => {
      try {
        await createPack({
          packCid: 'bafy-pack-past-expiry',
          params: { tokenBudget: 4000 },
          payload: {},
          pinned: false,
          expiresAt: new Date(Date.now() - 60_000),
        });
        throw new Error('Expected createPack to reject past expiry');
      } catch (error) {
        expect(errorChainMessage(error)).toMatch(
          /Failed query: insert into "context_packs"|expires_at must be in the future/,
        );
      }
    });

    it('clears expiry when inserting a pinned pack', async () => {
      const pack = await createPack({
        packCid: 'bafy-pack-pinned-insert',
        params: { tokenBudget: 4000 },
        payload: {},
        pinned: true,
        expiresAt: new Date(Date.now() + 60_000),
      });

      expect(pack.pinned).toBe(true);
      expect(pack.expiresAt).toBeNull();
    });

    it('clears expiry when pinning an existing pack', async () => {
      const created = await createPack({
        packCid: 'bafy-pack-pin-update',
        params: { tokenBudget: 4000 },
        payload: {},
        pinned: false,
        expiresAt: new Date(Date.now() + 60_000),
      });

      const pinned = await repo.pin(created.id);

      expect(pinned).not.toBeNull();
      expect(pinned!.pinned).toBe(true);
      expect(pinned!.expiresAt).toBeNull();
    });

    it('rejects unpinning without a future expiry', async () => {
      const created = await createPack({
        packCid: 'bafy-pack-unpin-invalid',
        params: { tokenBudget: 4000 },
        payload: {},
        pinned: true,
      });

      try {
        await repo.unpin(created.id, new Date(Date.now() - 60_000));
        throw new Error('Expected unpin to reject past expiry');
      } catch (error) {
        expect(errorChainMessage(error)).toMatch(
          /Failed query: update "context_packs"|expires_at must be in the future/,
        );
      }
    });
  });

  describe('findByEntryId', () => {
    it('returns no packs when the entry is not referenced', async () => {
      const result = await repo.findByEntryId(OTHER_ENTRY_ID);

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('returns packs containing the entry ordered by newest first', async () => {
      const olderPack = await createPack({
        packCid: 'bafy-pack-entry-older',
        params: { tokenBudget: 4000 },
        payload: {},
        pinned: false,
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date('2026-03-01T00:00:00Z'),
      });
      const newerPack = await createPack({
        packCid: 'bafy-pack-entry-newer',
        params: { tokenBudget: 4000 },
        payload: {},
        pinned: false,
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date('2026-03-02T00:00:00Z'),
      });

      await repo.addEntries([
        {
          packId: olderPack.id,
          entryId: ENTRY_ID,
          entryCidSnapshot: 'bafkentryolder',
          compressionLevel: 'full',
          rank: 1,
        },
        {
          packId: newerPack.id,
          entryId: ENTRY_ID,
          entryCidSnapshot: 'bafkentrynewer',
          compressionLevel: 'summary',
          rank: 1,
        },
      ]);

      const result = await repo.findByEntryId(ENTRY_ID);

      expect(result.total).toBe(2);
      expect(result.items.map((item) => item.id)).toEqual([
        newerPack.id,
        olderPack.id,
      ]);
    });

    it('isolates results with the diaryId filter', async () => {
      const primaryPack = await createPack({
        packCid: 'bafy-pack-entry-primary',
        params: { tokenBudget: 4000 },
        payload: {},
        pinned: false,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const otherPack = await repo.createPack({
        diaryId: OTHER_DIARY_ID,
        createdBy: OWNER_ID,
        packCid: 'bafy-pack-entry-other',
        params: { tokenBudget: 4000 },
        payload: {},
        pinned: false,
        expiresAt: new Date(Date.now() + 60_000),
      });

      await repo.addEntries([
        {
          packId: primaryPack.id,
          entryId: ENTRY_ID,
          entryCidSnapshot: 'bafkentryprimary',
          compressionLevel: 'full',
          rank: 1,
        },
        {
          packId: otherPack.id,
          entryId: ENTRY_ID,
          entryCidSnapshot: 'bafkentryother',
          compressionLevel: 'full',
          rank: 1,
        },
      ]);

      const result = await repo.findByEntryId(ENTRY_ID, {
        diaryId: DIARY_ID,
      });

      expect(result.total).toBe(1);
      expect(result.items.map((item) => item.id)).toEqual([primaryPack.id]);
    });
  });
});
