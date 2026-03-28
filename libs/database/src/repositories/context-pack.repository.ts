/**
 * Context Pack Repository
 *
 * Persistence primitives for compiled context packs and pack membership.
 */

import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  type InferSelectModel,
  lte,
  sql,
} from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  agentKeys,
  type ContextPack,
  contextPackEntries,
  type ContextPackEntry,
  contextPacks,
  diaryEntries,
  type NewContextPack,
  type NewContextPackEntry,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

const packSelection = {
  id: contextPacks.id,
  diaryId: contextPacks.diaryId,
  packCid: contextPacks.packCid,
  packCodec: contextPacks.packCodec,
  packType: contextPacks.packType,
  params: contextPacks.params,
  payload: contextPacks.payload,
  createdBy: contextPacks.createdBy,
  creatorIdentityId: agentKeys.identityId,
  creatorFingerprint: agentKeys.fingerprint,
  creatorPublicKey: agentKeys.publicKey,
  supersedesPackId: contextPacks.supersedesPackId,
  pinned: contextPacks.pinned,
  expiresAt: contextPacks.expiresAt,
  createdAt: contextPacks.createdAt,
} as const;

interface PackRow extends ContextPack {
  creatorIdentityId: string | null;
  creatorFingerprint: string | null;
  creatorPublicKey: string | null;
}

const expandedEntrySelection = {
  id: contextPackEntries.id,
  packId: contextPackEntries.packId,
  entryId: contextPackEntries.entryId,
  entryCidSnapshot: contextPackEntries.entryCidSnapshot,
  compressionLevel: contextPackEntries.compressionLevel,
  originalTokens: contextPackEntries.originalTokens,
  packedTokens: contextPackEntries.packedTokens,
  rank: contextPackEntries.rank,
  createdAt: contextPackEntries.createdAt,
  entryIdValue: diaryEntries.id,
  entryDiaryId: diaryEntries.diaryId,
  entryTitle: diaryEntries.title,
  entryContent: diaryEntries.content,
  entryTags: diaryEntries.tags,
  entryInjectionRisk: diaryEntries.injectionRisk,
  entryImportance: diaryEntries.importance,
  entryAccessCount: diaryEntries.accessCount,
  entryLastAccessedAt: diaryEntries.lastAccessedAt,
  entryTypeValue: diaryEntries.entryType,
  entryContentHash: diaryEntries.contentHash,
  entryContentSignature: diaryEntries.contentSignature,
  entryCreatedAt: diaryEntries.createdAt,
  entryUpdatedAt: diaryEntries.updatedAt,
  entryCreatorIdentityId: agentKeys.identityId,
  entryCreatorFingerprint: agentKeys.fingerprint,
  entryCreatorPublicKey: agentKeys.publicKey,
} as const;

function normalizePack(row: PackRow): ContextPackWithCreator {
  return {
    id: row.id,
    diaryId: row.diaryId,
    packCid: row.packCid,
    packCodec: row.packCodec,
    packType: row.packType,
    params: row.params,
    payload: row.payload,
    createdBy: row.createdBy,
    creator:
      row.creatorIdentityId && row.creatorFingerprint && row.creatorPublicKey
        ? {
            identityId: row.creatorIdentityId,
            fingerprint: row.creatorFingerprint,
            publicKey: row.creatorPublicKey,
          }
        : null,
    supersedesPackId: row.supersedesPackId,
    pinned: row.pinned,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

interface ExpandedPackEntryRow extends InferSelectModel<
  typeof contextPackEntries
> {
  entryIdValue: string;
  entryDiaryId: string;
  entryTitle: string | null;
  entryContent: string;
  entryTags: string[] | null;
  entryInjectionRisk: boolean;
  entryImportance: number;
  entryAccessCount: number;
  entryLastAccessedAt: Date | null;
  entryTypeValue: InferSelectModel<typeof diaryEntries>['entryType'];
  entryContentHash: string | null;
  entryContentSignature: string | null;
  entryCreatedAt: Date;
  entryUpdatedAt: Date;
  entryCreatorIdentityId: string | null;
  entryCreatorFingerprint: string | null;
  entryCreatorPublicKey: string | null;
}

function normalizeExpandedEntry(row: ExpandedPackEntryRow): ExpandedPackEntry {
  return {
    id: row.id,
    packId: row.packId,
    entryId: row.entryId,
    entryCidSnapshot: row.entryCidSnapshot,
    compressionLevel: row.compressionLevel,
    originalTokens: row.originalTokens,
    packedTokens: row.packedTokens,
    rank: row.rank,
    createdAt: row.createdAt,
    entry: {
      id: row.entryIdValue,
      diaryId: row.entryDiaryId,
      title: row.entryTitle,
      content: row.entryContent,
      tags: row.entryTags,
      injectionRisk: row.entryInjectionRisk,
      importance: row.entryImportance,
      accessCount: row.entryAccessCount,
      lastAccessedAt: row.entryLastAccessedAt,
      entryType: row.entryTypeValue,
      contentHash: row.entryContentHash,
      contentSignature: row.entryContentSignature,
      createdAt: row.entryCreatedAt,
      updatedAt: row.entryUpdatedAt,
      creator:
        row.entryCreatorIdentityId === null ||
        row.entryCreatorFingerprint === null ||
        row.entryCreatorPublicKey === null
          ? null
          : {
              identityId: row.entryCreatorIdentityId,
              fingerprint: row.entryCreatorFingerprint,
              publicKey: row.entryCreatorPublicKey,
            },
    },
  };
}

export function createContextPackRepository(db: Database) {
  return {
    async createPack(input: NewContextPack): Promise<ContextPack> {
      const [row] = await getExecutor(db)
        .insert(contextPacks)
        .values(input)
        .returning();

      return row;
    },

    async addEntries(
      entries: NewContextPackEntry[],
    ): Promise<ContextPackEntry[]> {
      if (entries.length === 0) return [];

      return getExecutor(db)
        .insert(contextPackEntries)
        .values(entries)
        .onConflictDoNothing({
          target: [contextPackEntries.packId, contextPackEntries.entryId],
        })
        .returning();
    },

    async findById(id: string): Promise<ContextPackWithCreator | null> {
      const [row] = (await getExecutor(db)
        .select(packSelection)
        .from(contextPacks)
        .leftJoin(agentKeys, eq(contextPacks.createdBy, agentKeys.identityId))
        .where(eq(contextPacks.id, id))
        .limit(1)) as PackRow[];

      return row ? normalizePack(row) : null;
    },

    async findByCid(packCid: string): Promise<ContextPackWithCreator | null> {
      const [row] = (await getExecutor(db)
        .select(packSelection)
        .from(contextPacks)
        .leftJoin(agentKeys, eq(contextPacks.createdBy, agentKeys.identityId))
        .where(eq(contextPacks.packCid, packCid))
        .limit(1)) as PackRow[];

      return row ? normalizePack(row) : null;
    },

    async listEntries(packId: string): Promise<ContextPackEntry[]> {
      return getExecutor(db)
        .select()
        .from(contextPackEntries)
        .where(eq(contextPackEntries.packId, packId))
        .orderBy(
          sql`${contextPackEntries.rank} ASC NULLS LAST`,
          asc(contextPackEntries.createdAt),
          asc(contextPackEntries.id),
        );
    },

    async listEntriesExpanded(packId: string): Promise<ExpandedPackEntry[]> {
      const rows = (await getExecutor(db)
        .select(expandedEntrySelection)
        .from(contextPackEntries)
        .innerJoin(
          diaryEntries,
          eq(contextPackEntries.entryId, diaryEntries.id),
        )
        .leftJoin(agentKeys, eq(diaryEntries.createdBy, agentKeys.identityId))
        .where(eq(contextPackEntries.packId, packId))
        .orderBy(
          sql`${contextPackEntries.rank} ASC NULLS LAST`,
          asc(contextPackEntries.createdAt),
          asc(contextPackEntries.id),
        )) as ExpandedPackEntryRow[];

      return rows.map(normalizeExpandedEntry);
    },

    async listEntriesExpandedByPackIds(
      packIds: string[],
    ): Promise<Map<string, ExpandedPackEntry[]>> {
      if (packIds.length === 0) return new Map();

      const rows = (await getExecutor(db)
        .select(expandedEntrySelection)
        .from(contextPackEntries)
        .innerJoin(
          diaryEntries,
          eq(contextPackEntries.entryId, diaryEntries.id),
        )
        .leftJoin(agentKeys, eq(diaryEntries.createdBy, agentKeys.identityId))
        .where(inArray(contextPackEntries.packId, packIds))
        .orderBy(
          sql`${contextPackEntries.rank} ASC NULLS LAST`,
          asc(contextPackEntries.createdAt),
          asc(contextPackEntries.id),
        )) as ExpandedPackEntryRow[];

      const grouped = new Map<string, ExpandedPackEntry[]>();
      for (const packId of packIds) {
        grouped.set(packId, []);
      }

      for (const row of rows) {
        const entries = grouped.get(row.packId);
        if (entries) {
          entries.push(normalizeExpandedEntry(row));
        }
      }

      return grouped;
    },

    async listExpiredUnpinned(
      now = new Date(),
      limit = 100,
    ): Promise<ContextPack[]> {
      return getExecutor(db)
        .select()
        .from(contextPacks)
        .where(
          and(eq(contextPacks.pinned, false), lte(contextPacks.expiresAt, now)),
        )
        .orderBy(asc(contextPacks.expiresAt))
        .limit(limit);
    },

    async pin(id: string): Promise<ContextPack | null> {
      const [row] = await getExecutor(db)
        .update(contextPacks)
        .set({ pinned: true, expiresAt: null })
        .where(eq(contextPacks.id, id))
        .returning();

      return row ?? null;
    },

    async unpin(id: string, expiresAt: Date): Promise<ContextPack | null> {
      const [row] = await getExecutor(db)
        .update(contextPacks)
        .set({ pinned: false, expiresAt })
        .where(eq(contextPacks.id, id))
        .returning();

      return row ?? null;
    },

    async updateExpiry(
      id: string,
      expiresAt: Date,
    ): Promise<ContextPack | null> {
      const [row] = await getExecutor(db)
        .update(contextPacks)
        .set({ expiresAt })
        .where(eq(contextPacks.id, id))
        .returning();

      return row ?? null;
    },

    async deleteMany(ids: string[]): Promise<number> {
      if (ids.length === 0) return 0;

      const rows = await getExecutor(db)
        .delete(contextPacks)
        .where(inArray(contextPacks.id, ids))
        .returning({ id: contextPacks.id });

      return rows.length;
    },

    async listByDiary(
      diaryId: string,
      limit = 50,
      offset = 0,
    ): Promise<{ items: ContextPackWithCreator[]; total: number }> {
      const where = eq(contextPacks.diaryId, diaryId);

      const [rows, [{ value: total }]] = await Promise.all([
        getExecutor(db)
          .select(packSelection)
          .from(contextPacks)
          .leftJoin(agentKeys, eq(contextPacks.createdBy, agentKeys.identityId))
          .where(where)
          .orderBy(desc(contextPacks.createdAt))
          .limit(limit)
          .offset(offset) as Promise<PackRow[]>,
        getExecutor(db)
          .select({ value: count() })
          .from(contextPacks)
          .where(where),
      ]);

      return { items: rows.map(normalizePack), total };
    },
  };
}

export type ContextPackRepository = ReturnType<
  typeof createContextPackRepository
>;

export interface ExpandedPackEntry extends InferSelectModel<
  typeof contextPackEntries
> {
  entry: Omit<
    InferSelectModel<typeof diaryEntries>,
    'embedding' | 'createdBy' | 'signingNonce'
  > & {
    creator: {
      identityId: string;
      fingerprint: string;
      publicKey: string;
    } | null;
  };
}

export interface ContextPackWithCreator extends ContextPack {
  creator: {
    identityId: string;
    fingerprint: string;
    publicKey: string;
  } | null;
}
