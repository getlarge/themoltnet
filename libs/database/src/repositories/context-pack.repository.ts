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
  agents,
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
  creatorIdentityId: agents.identityId,
  creatorFingerprint: agents.fingerprint,
  creatorPublicKey: agents.publicKey,
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
  entryCreatorIdentityId: agents.identityId,
  entryCreatorFingerprint: agents.fingerprint,
  entryCreatorPublicKey: agents.publicKey,
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
        .leftJoin(agents, eq(contextPacks.createdBy, agents.identityId))
        .where(eq(contextPacks.id, id))
        .limit(1)) as PackRow[];

      return row ? normalizePack(row) : null;
    },

    async findByCid(packCid: string): Promise<ContextPackWithCreator | null> {
      const [row] = (await getExecutor(db)
        .select(packSelection)
        .from(contextPacks)
        .leftJoin(agents, eq(contextPacks.createdBy, agents.identityId))
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
        .leftJoin(agents, eq(diaryEntries.createdBy, agents.identityId))
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
        .leftJoin(agents, eq(diaryEntries.createdBy, agents.identityId))
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
        .where(and(eq(contextPacks.id, id), eq(contextPacks.pinned, false)))
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
      const whereClause = eq(contextPacks.diaryId, diaryId);

      const [rows, countResult] = await Promise.all([
        getExecutor(db)
          .select(packSelection)
          .from(contextPacks)
          .leftJoin(agents, eq(contextPacks.createdBy, agents.identityId))
          .where(whereClause)
          .orderBy(desc(contextPacks.createdAt))
          .limit(limit)
          .offset(offset) as Promise<PackRow[]>,
        getExecutor(db)
          .select({ count: count() })
          .from(contextPacks)
          .where(whereClause),
      ]);

      return {
        items: rows.map(normalizePack),
        total: countResult[0]?.count ?? 0,
      };
    },

    async diffPacks(packAId: string, packBId: string): Promise<PackDiffRow[]> {
      const result = await getExecutor(db).execute(sql`
        WITH
          a AS (
            SELECT cpe.entry_id, cpe.rank, cpe.entry_cid_snapshot, cpe.compression_level,
                   cpe.packed_tokens, de.title
            FROM context_pack_entries cpe
            LEFT JOIN diary_entries de ON de.id = cpe.entry_id
            WHERE cpe.pack_id = ${packAId}
          ),
          b AS (
            SELECT cpe.entry_id, cpe.rank, cpe.entry_cid_snapshot, cpe.compression_level,
                   cpe.packed_tokens, de.title
            FROM context_pack_entries cpe
            LEFT JOIN diary_entries de ON de.id = cpe.entry_id
            WHERE cpe.pack_id = ${packBId}
          ),
          joined AS (
            SELECT
              COALESCE(a.entry_id, b.entry_id) AS entry_id,
              COALESCE(a.title, b.title)        AS title,
              a.rank                            AS rank_a,
              b.rank                            AS rank_b,
              a.entry_cid_snapshot              AS cid_a,
              b.entry_cid_snapshot              AS cid_b,
              a.compression_level               AS compression_a,
              b.compression_level               AS compression_b,
              a.packed_tokens                   AS tokens_a,
              b.packed_tokens                   AS tokens_b
            FROM a
            FULL OUTER JOIN b USING (entry_id)
          )
        SELECT
          entry_id,
          title,
          CASE
            WHEN rank_a IS NULL THEN 'added'
            WHEN rank_b IS NULL THEN 'removed'
            WHEN cid_a IS DISTINCT FROM cid_b OR compression_a IS DISTINCT FROM compression_b THEN 'changed'
            WHEN rank_a IS DISTINCT FROM rank_b THEN 'reordered'
          END AS kind,
          rank_a,
          rank_b,
          cid_a,
          cid_b,
          compression_a,
          compression_b,
          tokens_a,
          tokens_b
        FROM joined
        WHERE
          rank_a IS DISTINCT FROM rank_b
          OR cid_a IS DISTINCT FROM cid_b
          OR compression_a IS DISTINCT FROM compression_b
        ORDER BY COALESCE(rank_b, rank_a)
      `);

      return result.rows.map((row) => ({
        entryId: row['entry_id'] as string,
        title: (row['title'] as string | null) ?? null,
        kind: row['kind'] as 'added' | 'removed' | 'reordered' | 'changed',
        rankA:
          row['rank_a'] !== null && row['rank_a'] !== undefined
            ? Number(row['rank_a'])
            : null,
        rankB:
          row['rank_b'] !== null && row['rank_b'] !== undefined
            ? Number(row['rank_b'])
            : null,
        cidA: (row['cid_a'] as string | null) ?? null,
        cidB: (row['cid_b'] as string | null) ?? null,
        compressionA:
          (row['compression_a'] as PackDiffCompressionLevel | null) ?? null,
        compressionB:
          (row['compression_b'] as PackDiffCompressionLevel | null) ?? null,
        tokensA:
          row['tokens_a'] !== null && row['tokens_a'] !== undefined
            ? Number(row['tokens_a'])
            : null,
        tokensB:
          row['tokens_b'] !== null && row['tokens_b'] !== undefined
            ? Number(row['tokens_b'])
            : null,
      }));
    },

    async findByEntryId(
      entryId: string,
      opts: { diaryId?: string; limit?: number; offset?: number } = {},
    ): Promise<{ items: ContextPackWithCreator[]; total: number }> {
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      const conditions = [eq(contextPackEntries.entryId, entryId)];

      if (opts.diaryId) {
        conditions.push(eq(contextPacks.diaryId, opts.diaryId));
      }

      const whereClause = and(...conditions);

      const [rows, countResult] = await Promise.all([
        getExecutor(db)
          .select(packSelection)
          .from(contextPackEntries)
          .innerJoin(
            contextPacks,
            eq(contextPackEntries.packId, contextPacks.id),
          )
          .leftJoin(agents, eq(contextPacks.createdBy, agents.identityId))
          .where(whereClause)
          .orderBy(desc(contextPacks.createdAt))
          .limit(limit)
          .offset(offset) as Promise<PackRow[]>,
        getExecutor(db)
          .select({ count: count() })
          .from(contextPackEntries)
          .innerJoin(
            contextPacks,
            eq(contextPackEntries.packId, contextPacks.id),
          )
          .where(whereClause),
      ]);

      return {
        items: rows.map(normalizePack),
        total: countResult[0]?.count ?? 0,
      };
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

export type PackDiffCompressionLevel = 'full' | 'summary' | 'keywords';

export interface PackDiffRow {
  entryId: string;
  title: string | null;
  kind: 'added' | 'removed' | 'reordered' | 'changed';
  rankA: number | null;
  rankB: number | null;
  cidA: string | null;
  cidB: string | null;
  compressionA: PackDiffCompressionLevel | null;
  compressionB: PackDiffCompressionLevel | null;
  tokensA: number | null;
  tokensB: number | null;
}
