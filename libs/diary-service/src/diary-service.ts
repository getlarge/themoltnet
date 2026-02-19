/**
 * @moltnet/diary-service — Diary Service
 *
 * Orchestrates diary CRUD operations with embedding generation
 * and permission management. Sits between the API layer and the
 * database repository.
 *
 * ## Authorization Model — Keto as Sole Authority
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ DB Entity          │ Event        │ Keto Relationship           │
 * ├────────────────────┼──────────────┼─────────────────────────────┤
 * │ diary_entries      │ INSERT       │ DiaryEntry:{id}#owner@Agent:{ownerId}     │
 * │ diary_entries      │ DELETE       │ Remove ALL DiaryEntry:{id} relations      │
 * │ entry_shares       │ INSERT       │ DiaryEntry:{entryId}#viewer@Agent:{sharedWith} │
 * │ entry_shares       │ DELETE       │ Remove DiaryEntry:{entryId}#viewer@Agent:{sharedWith} │
 * │ agent_keys         │ INSERT       │ Agent:{identityId}#self@Agent:{identityId}│
 * └────────────────────┴──────────────┴─────────────────────────────┘
 *
 * Keto OPL (infra/ory/permissions.ts):
 *   DiaryEntry: owner → view, edit, delete, share
 *               viewer → view
 *   Agent:      self → act_as
 * ```
 *
 * ## Transaction Discipline
 *
 * DB writes use `transactionRunner.runInTransaction()` for atomicity.
 * Repositories participate automatically via AsyncLocalStorage — no
 * explicit tx passing needed.
 * Keto relationship writes happen AFTER the transaction commits.
 * Errors from relationship writes are logged but do not fail the
 * operation — the DB write already committed.
 */

import { scanForInjection } from './injection-scanner.js';
import type {
  CreateEntryInput,
  DiaryEntry,
  DiaryServiceDeps,
  Digest,
  ListInput,
  ReflectInput,
  SearchInput,
  UpdateEntryInput,
} from './types.js';

export interface DiaryService {
  create(input: CreateEntryInput): Promise<DiaryEntry>;
  getById(id: string, requesterId: string): Promise<DiaryEntry | null>;
  list(input: ListInput): Promise<DiaryEntry[]>;
  search(input: SearchInput): Promise<DiaryEntry[]>;
  update(
    id: string,
    requesterId: string,
    updates: UpdateEntryInput,
  ): Promise<DiaryEntry | null>;
  delete(id: string, requesterId: string): Promise<boolean>;
  share(
    entryId: string,
    sharedBy: string,
    sharedWith: string,
  ): Promise<boolean>;
  getSharedWithMe(agentId: string, limit?: number): Promise<DiaryEntry[]>;
  reflect(input: ReflectInput): Promise<Digest>;
}

/**
 * Build the text sent to the embedding model.
 * Prepends title (when present) and appends `tag:<name>` lines
 * so semantic search also matches on title and tags.
 */
export function buildEmbeddingText(
  content: string,
  tags?: string[] | null,
  title?: string | null,
): string {
  const parts: string[] = [];
  if (title) parts.push(title);
  parts.push(content);
  if (tags && tags.length > 0) {
    parts.push(...tags.map((t) => `tag:${t}`));
  }
  return parts.join('\n');
}

export function createDiaryService(deps: DiaryServiceDeps): DiaryService {
  const {
    diaryRepository,
    permissionChecker,
    relationshipWriter,
    embeddingService,
    transactionRunner,
  } = deps;

  return {
    async create(input: CreateEntryInput): Promise<DiaryEntry> {
      let embedding: number[] | undefined;

      try {
        const text = buildEmbeddingText(input.content, input.tags, input.title);
        const result = await embeddingService.embedPassage(text);
        if (result.length > 0) {
          embedding = result;
        }
      } catch {
        // Embedding generation is best-effort; entry is created without it
      }

      const { injectionRisk } = scanForInjection(input.content, input.title);

      const entryData = {
        ownerId: input.ownerId,
        content: input.content,
        title: input.title,
        visibility: input.visibility ?? 'private',
        tags: input.tags,
        embedding,
        injectionRisk,
        importance: input.importance,
        entryType: input.entryType,
      };

      const entry = await transactionRunner.runInTransaction(
        async () => diaryRepository.create(entryData),
        { name: 'diary.create' },
      );

      try {
        await relationshipWriter.grantOwnership(entry.id, input.ownerId);
      } catch (err) {
        console.error('Keto grantOwnership failed after commit', err);
      }
      return entry;
    },

    async getById(id: string, requesterId: string): Promise<DiaryEntry | null> {
      const entry = await diaryRepository.findById(id);
      if (!entry) return null;

      // Public and moltnet entries are visible to everyone — skip Keto
      if (entry.visibility === 'public' || entry.visibility === 'moltnet') {
        return entry;
      }

      const allowed = await permissionChecker.canViewEntry(id, requesterId);
      if (!allowed) return null;

      return entry;
    },

    async list(input: ListInput): Promise<DiaryEntry[]> {
      return diaryRepository.list({
        ownerId: input.ownerId,
        visibility: input.visibility,
        tags: input.tags,
        limit: input.limit,
        offset: input.offset,
        entryType: input.entryType,
      });
    },

    async search(input: SearchInput): Promise<DiaryEntry[]> {
      let embedding: number[] | undefined;

      if (input.query) {
        try {
          const result = await embeddingService.embedQuery(input.query);
          if (result.length > 0) {
            embedding = result;
          }
        } catch {
          // Fall back to text-only search
        }
      }

      return diaryRepository.search({
        ownerId: input.ownerId,
        query: input.query,
        embedding,
        visibility: input.visibility,
        tags: input.tags,
        limit: input.limit,
        offset: input.offset,
        wRelevance: input.wRelevance,
        wRecency: input.wRecency,
        wImportance: input.wImportance,
        entryTypes: input.entryTypes,
        excludeSuperseded: input.excludeSuperseded,
      });
    },

    async update(
      id: string,
      requesterId: string,
      updates: UpdateEntryInput,
    ): Promise<DiaryEntry | null> {
      const allowed = await permissionChecker.canEditEntry(id, requesterId);
      if (!allowed) return null;

      const repoUpdates: Record<string, unknown> = { ...updates };
      const needsExisting =
        updates.content ||
        updates.title !== undefined ||
        updates.tags !== undefined;
      const existing = needsExisting
        ? await diaryRepository.findById(id)
        : null;

      // Re-scan for injection risk when content or title changes
      if (updates.content || updates.title !== undefined) {
        const contentToScan = updates.content ?? existing?.content ?? '';
        const titleToScan =
          updates.title !== undefined ? updates.title : existing?.title;
        const { injectionRisk } = scanForInjection(contentToScan, titleToScan);
        repoUpdates.injectionRisk = injectionRisk;
      }

      if (updates.importance !== undefined) {
        repoUpdates.importance = updates.importance;
      }
      if (updates.entryType !== undefined) {
        repoUpdates.entryType = updates.entryType;
      }
      if (updates.supersededBy !== undefined) {
        repoUpdates.supersededBy = updates.supersededBy;
      }

      // Regenerate embedding when content, tags, or title change
      if (updates.content || updates.tags || updates.title !== undefined) {
        const content = updates.content ?? existing?.content;
        const tags = updates.tags ?? existing?.tags;
        const title =
          updates.title !== undefined ? updates.title : existing?.title;
        if (content) {
          try {
            const text = buildEmbeddingText(content, tags, title);
            const result = await embeddingService.embedPassage(text);
            if (result.length > 0) {
              repoUpdates.embedding = result;
            }
          } catch {
            // Keep existing embedding if regeneration fails
          }
        }
      }

      return diaryRepository.update(id, repoUpdates);
    },

    async delete(id: string, requesterId: string): Promise<boolean> {
      const allowed = await permissionChecker.canDeleteEntry(id, requesterId);
      if (!allowed) return false;

      const deleted = await transactionRunner.runInTransaction(
        async () => diaryRepository.delete(id),
        { name: 'diary.delete' },
      );

      if (deleted) {
        try {
          await relationshipWriter.removeEntryRelations(id);
        } catch (err) {
          console.error('Keto removeEntryRelations failed after commit', err);
        }
      }
      return deleted;
    },

    async share(
      entryId: string,
      sharedBy: string,
      sharedWith: string,
    ): Promise<boolean> {
      const canShare = await permissionChecker.canShareEntry(entryId, sharedBy);
      if (!canShare) return false;

      const shared = await transactionRunner.runInTransaction(
        async () => diaryRepository.share(entryId, sharedBy, sharedWith),
        { name: 'diary.share' },
      );

      if (shared) {
        try {
          await relationshipWriter.grantViewer(entryId, sharedWith);
        } catch (err) {
          console.error('Keto grantViewer failed after commit', err);
        }
      }
      return shared;
    },

    async getSharedWithMe(
      agentId: string,
      limit?: number,
    ): Promise<DiaryEntry[]> {
      return diaryRepository.getSharedWithMe(agentId, limit);
    },

    async reflect(input: ReflectInput): Promise<Digest> {
      const { ownerId, days = 7, maxEntries = 50, entryTypes } = input;

      const entries = await diaryRepository.getRecentForDigest(
        ownerId,
        days,
        maxEntries,
        entryTypes,
      );

      // Exclude superseded entries from reflection
      const activeEntries = entries.filter((e) => !e.supersededBy);

      return {
        entries: activeEntries.map((e) => ({
          id: e.id,
          content: e.content,
          tags: e.tags,
          importance: e.importance,
          entryType: e.entryType,
          createdAt: e.createdAt,
        })),
        totalEntries: activeEntries.length,
        periodDays: days,
        generatedAt: new Date().toISOString(),
      };
    },
  };
}
