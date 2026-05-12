/**
 * Rendered Pack Repository
 *
 * Persistence primitives for rendered packs. Append-only: re-rendering
 * creates a new row with a new CID. Uses the same pinned + expiresAt
 * GC pattern as context packs.
 */

import type { SQL } from 'drizzle-orm';
import { and, asc, count, desc, eq, inArray, lte } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type PrincipalIdentity,
  resolvePrincipal,
} from '../principal-resolver.js';
import {
  agents,
  humans,
  type NewRenderedPack,
  type RenderedPack,
  renderedPacks,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

const renderedPackSelection = {
  id: renderedPacks.id,
  packCid: renderedPacks.packCid,
  sourcePackId: renderedPacks.sourcePackId,
  diaryId: renderedPacks.diaryId,
  content: renderedPacks.content,
  contentHash: renderedPacks.contentHash,
  renderMethod: renderedPacks.renderMethod,
  totalTokens: renderedPacks.totalTokens,
  creatorAgentId: renderedPacks.creatorAgentId,
  creatorAgentFingerprint: agents.fingerprint,
  creatorAgentPublicKey: agents.publicKey,
  creatorHumanId: renderedPacks.creatorHumanId,
  creatorHumanIdentityId: humans.identityId,
  pinned: renderedPacks.pinned,
  expiresAt: renderedPacks.expiresAt,
  createdAt: renderedPacks.createdAt,
  verifiedTaskId: renderedPacks.verifiedTaskId,
  description: renderedPacks.description,
} as const;

interface RenderedPackRow extends RenderedPack {
  creatorAgentFingerprint: string | null;
  creatorAgentPublicKey: string | null;
  creatorHumanIdentityId: string | null;
}

function normalizeRenderedPack(row: RenderedPackRow): RenderedPackWithCreator {
  return {
    id: row.id,
    packCid: row.packCid,
    sourcePackId: row.sourcePackId,
    diaryId: row.diaryId,
    content: row.content,
    contentHash: row.contentHash,
    renderMethod: row.renderMethod,
    totalTokens: row.totalTokens,
    creator: resolvePrincipal({
      creatorAgentId: row.creatorAgentId,
      creatorAgentFingerprint: row.creatorAgentFingerprint,
      creatorAgentPublicKey: row.creatorAgentPublicKey,
      creatorHumanId: row.creatorHumanId,
      creatorHumanIdentityId: row.creatorHumanIdentityId,
    }),
    pinned: row.pinned,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    verifiedTaskId: row.verifiedTaskId,
    description: row.description,
  };
}

export function createRenderedPackRepository(db: Database) {
  return {
    async create(input: NewRenderedPack): Promise<RenderedPack> {
      const [row] = await getExecutor(db)
        .insert(renderedPacks)
        .values(input)
        .returning();

      return row;
    },

    async findById(id: string): Promise<RenderedPackWithCreator | null> {
      const [row] = (await getExecutor(db)
        .select(renderedPackSelection)
        .from(renderedPacks)
        .leftJoin(agents, eq(renderedPacks.creatorAgentId, agents.identityId))
        .leftJoin(humans, eq(renderedPacks.creatorHumanId, humans.id))
        .where(eq(renderedPacks.id, id))
        .limit(1)) as RenderedPackRow[];

      return row ? normalizeRenderedPack(row) : null;
    },

    async findByCid(packCid: string): Promise<RenderedPackWithCreator | null> {
      const [row] = (await getExecutor(db)
        .select(renderedPackSelection)
        .from(renderedPacks)
        .leftJoin(agents, eq(renderedPacks.creatorAgentId, agents.identityId))
        .leftJoin(humans, eq(renderedPacks.creatorHumanId, humans.id))
        .where(eq(renderedPacks.packCid, packCid))
        .limit(1)) as RenderedPackRow[];

      return row ? normalizeRenderedPack(row) : null;
    },

    async findLatestBySourcePackId(
      sourcePackId: string,
    ): Promise<RenderedPackWithCreator | null> {
      const [row] = (await getExecutor(db)
        .select(renderedPackSelection)
        .from(renderedPacks)
        .leftJoin(agents, eq(renderedPacks.creatorAgentId, agents.identityId))
        .leftJoin(humans, eq(renderedPacks.creatorHumanId, humans.id))
        .where(eq(renderedPacks.sourcePackId, sourcePackId))
        .orderBy(desc(renderedPacks.createdAt))
        .limit(1)) as RenderedPackRow[];

      return row ? normalizeRenderedPack(row) : null;
    },

    async listBySourcePackId(
      sourcePackId: string,
      limit = 50,
    ): Promise<RenderedPack[]> {
      return getExecutor(db)
        .select()
        .from(renderedPacks)
        .where(eq(renderedPacks.sourcePackId, sourcePackId))
        .orderBy(desc(renderedPacks.createdAt))
        .limit(limit);
    },

    async listBySourcePackIds(
      sourcePackIds: string[],
      limit = 500,
    ): Promise<RenderedPack[]> {
      if (sourcePackIds.length === 0) return [];

      return getExecutor(db)
        .select()
        .from(renderedPacks)
        .where(inArray(renderedPacks.sourcePackId, sourcePackIds))
        .orderBy(desc(renderedPacks.createdAt))
        .limit(limit);
    },

    async listByDiary(
      diaryId: string,
      limit = 50,
      offset = 0,
      filters: { sourcePackId?: string; renderMethod?: string } = {},
    ): Promise<{ items: RenderedPackWithCreator[]; total: number }> {
      const conditions: SQL[] = [eq(renderedPacks.diaryId, diaryId)];
      if (filters.sourcePackId) {
        conditions.push(eq(renderedPacks.sourcePackId, filters.sourcePackId));
      }
      if (filters.renderMethod) {
        conditions.push(eq(renderedPacks.renderMethod, filters.renderMethod));
      }
      const where = and(...conditions);

      const [items, [{ value: total }]] = await Promise.all([
        getExecutor(db)
          .select(renderedPackSelection)
          .from(renderedPacks)
          .leftJoin(agents, eq(renderedPacks.creatorAgentId, agents.identityId))
          .leftJoin(humans, eq(renderedPacks.creatorHumanId, humans.id))
          .where(where)
          .orderBy(desc(renderedPacks.createdAt))
          .limit(limit)
          .offset(offset) as Promise<RenderedPackRow[]>,
        getExecutor(db)
          .select({ value: count() })
          .from(renderedPacks)
          .where(where),
      ]);

      return { items: items.map(normalizeRenderedPack), total };
    },

    async listExpiredUnpinned(
      now = new Date(),
      limit = 100,
    ): Promise<RenderedPack[]> {
      return getExecutor(db)
        .select()
        .from(renderedPacks)
        .where(
          and(
            eq(renderedPacks.pinned, false),
            lte(renderedPacks.expiresAt, now),
          ),
        )
        .orderBy(asc(renderedPacks.expiresAt))
        .limit(limit);
    },

    async pin(id: string): Promise<RenderedPack | null> {
      const [row] = await getExecutor(db)
        .update(renderedPacks)
        .set({ pinned: true, expiresAt: null })
        .where(eq(renderedPacks.id, id))
        .returning();

      return row ?? null;
    },

    async unpin(id: string, expiresAt: Date): Promise<RenderedPack | null> {
      const [row] = await getExecutor(db)
        .update(renderedPacks)
        .set({ pinned: false, expiresAt })
        .where(eq(renderedPacks.id, id))
        .returning();

      return row ?? null;
    },

    async updateExpiry(
      id: string,
      expiresAt: Date,
    ): Promise<RenderedPack | null> {
      const [row] = await getExecutor(db)
        .update(renderedPacks)
        .set({ expiresAt })
        .where(and(eq(renderedPacks.id, id), eq(renderedPacks.pinned, false)))
        .returning();

      return row ?? null;
    },

    async deleteById(id: string): Promise<boolean> {
      const rows = await getExecutor(db)
        .delete(renderedPacks)
        .where(eq(renderedPacks.id, id))
        .returning({ id: renderedPacks.id });

      return rows.length > 0;
    },

    async deleteMany(ids: string[]): Promise<number> {
      if (ids.length === 0) return 0;

      const rows = await getExecutor(db)
        .delete(renderedPacks)
        .where(inArray(renderedPacks.id, ids))
        .returning({ id: renderedPacks.id });

      return rows.length;
    },

    async setVerifiedTask(
      id: string,
      verifiedTaskId: string,
    ): Promise<RenderedPack | null> {
      const [row] = await getExecutor(db)
        .update(renderedPacks)
        .set({ verifiedTaskId })
        .where(eq(renderedPacks.id, id))
        .returning();

      return row ?? null;
    },

    async setDescription(
      id: string,
      description: string | null,
    ): Promise<RenderedPack | null> {
      const [row] = await getExecutor(db)
        .update(renderedPacks)
        .set({ description })
        .where(eq(renderedPacks.id, id))
        .returning();

      return row ?? null;
    },
  };
}

export type RenderedPackRepository = ReturnType<
  typeof createRenderedPackRepository
>;

export interface RenderedPackWithCreator extends Omit<
  RenderedPack,
  'creatorAgentId' | 'creatorHumanId'
> {
  creator: PrincipalIdentity;
}
