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
import { contextPackEntries, contextPacks, diaries } from '../src/schema.js';

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
  const OWNER_ID = '120e8400-e29b-41d4-a716-446655440012';
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

    await db
      .insert(diaries)
      .values({
        id: DIARY_ID,
        ownerId: OWNER_ID,
        name: 'Context Pack Test Diary',
        visibility: 'private',
      })
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
    await db.delete(diaries).where(eq(diaries.id, DIARY_ID));
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
});
