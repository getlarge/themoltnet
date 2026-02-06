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
 * When DBOS DataSource is available:
 * - DB writes AND workflow scheduling run inside `dataSource.runTransaction()`
 * - Keto relationship mutations are durable workflows with automatic retry
 * - CRITICAL: Workflow scheduling MUST happen inside the transaction callback.
 *   Scheduling outside creates a crash window where DB commits but Keto is never updated.
 *
 * When DBOS is not available (fallback):
 * - Uses repository transactions with synchronous Keto calls
 * - Keto failure rolls back the DB transaction
 */

import { DBOS, ketoWorkflows } from '@moltnet/database';

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

export function createDiaryService(deps: DiaryServiceDeps): DiaryService {
  const { diaryRepository, permissionChecker, embeddingService, dataSource } =
    deps;

  return {
    async create(input: CreateEntryInput): Promise<DiaryEntry> {
      let embedding: number[] | undefined;

      try {
        const result = await embeddingService.embedPassage(input.content);
        if (result.length > 0) {
          embedding = result;
        }
      } catch {
        // Embedding generation is best-effort; entry is created without it
      }

      const entryData = {
        ownerId: input.ownerId,
        content: input.content,
        title: input.title,
        visibility: input.visibility ?? 'private',
        tags: input.tags,
        embedding,
      };

      // When DBOS is available, use durable transactions + workflows
      // CRITICAL: Workflow scheduling MUST happen inside runTransaction for atomicity.
      // If scheduled outside, a crash between DB commit and workflow start would leave
      // the entry without Keto permissions.
      if (dataSource) {
        return dataSource.runTransaction(
          async () => {
            const entry = await diaryRepository.create(
              entryData,
              dataSource.client,
            );
            await DBOS.startWorkflow(ketoWorkflows.grantOwnership)(
              entry.id,
              input.ownerId,
            );
            return entry;
          },
          { name: 'diary.create' },
        );
      }

      // Fallback: repository transaction with synchronous Keto call
      return diaryRepository.transaction(async (tx) => {
        const entry = await diaryRepository.create(entryData, tx);
        await permissionChecker.grantOwnership(entry.id, input.ownerId);
        return entry;
      });
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
        limit: input.limit,
        offset: input.offset,
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
        limit: input.limit,
        offset: input.offset,
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

      // Regenerate embedding when content changes
      if (updates.content) {
        try {
          const result = await embeddingService.embedPassage(updates.content);
          if (result.length > 0) {
            repoUpdates.embedding = result;
          }
        } catch {
          // Keep existing embedding if regeneration fails
        }
      }

      return diaryRepository.update(id, repoUpdates);
    },

    async delete(id: string, requesterId: string): Promise<boolean> {
      const allowed = await permissionChecker.canDeleteEntry(id, requesterId);
      if (!allowed) return false;

      // When DBOS is available, use durable transactions + workflows
      // CRITICAL: Workflow scheduling MUST happen inside runTransaction for atomicity.
      if (dataSource) {
        return dataSource.runTransaction(
          async () => {
            const deleted = await diaryRepository.delete(id, dataSource.client);
            if (!deleted) return false;
            await DBOS.startWorkflow(ketoWorkflows.removeEntryRelations)(id);
            return true;
          },
          { name: 'diary.delete' },
        );
      }

      // Fallback: repository transaction with synchronous Keto call
      return diaryRepository.transaction(async (tx) => {
        const deleted = await diaryRepository.delete(id, tx);
        if (!deleted) return false;

        await permissionChecker.removeEntryRelations(id);
        return true;
      });
    },

    async share(
      entryId: string,
      sharedBy: string,
      sharedWith: string,
    ): Promise<boolean> {
      const canShare = await permissionChecker.canShareEntry(entryId, sharedBy);
      if (!canShare) return false;

      // When DBOS is available, use durable transactions + workflows
      // CRITICAL: Workflow scheduling MUST happen inside runTransaction for atomicity.
      if (dataSource) {
        return dataSource.runTransaction(
          async () => {
            const shared = await diaryRepository.share(
              entryId,
              sharedBy,
              sharedWith,
              dataSource.client,
            );
            if (!shared) return false;
            await DBOS.startWorkflow(ketoWorkflows.grantViewer)(
              entryId,
              sharedWith,
            );
            return true;
          },
          { name: 'diary.share' },
        );
      }

      // Fallback: repository transaction with synchronous Keto call
      return diaryRepository.transaction(async (tx) => {
        const shared = await diaryRepository.share(
          entryId,
          sharedBy,
          sharedWith,
          tx,
        );
        if (!shared) return false;

        await permissionChecker.grantViewer(entryId, sharedWith);
        return true;
      });
    },

    async getSharedWithMe(
      agentId: string,
      limit?: number,
    ): Promise<DiaryEntry[]> {
      return diaryRepository.getSharedWithMe(agentId, limit);
    },

    async reflect(input: ReflectInput): Promise<Digest> {
      const { ownerId, days = 7, maxEntries = 50 } = input;

      const entries = await diaryRepository.getRecentForDigest(
        ownerId,
        days,
        maxEntries,
      );

      return {
        entries: entries.map((e) => ({
          id: e.id,
          content: e.content,
          tags: e.tags,
          createdAt: e.createdAt,
        })),
        totalEntries: entries.length,
        periodDays: days,
        generatedAt: new Date().toISOString(),
      };
    },
  };
}
