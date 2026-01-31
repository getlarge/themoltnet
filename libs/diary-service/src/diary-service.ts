/**
 * @moltnet/diary-service — Diary Service
 *
 * Orchestrates diary CRUD operations with embedding generation
 * and permission management. Sits between the API layer and the
 * database repository.
 */

import type {
  DiaryServiceDeps,
  CreateEntryInput,
  UpdateEntryInput,
  SearchInput,
  ListInput,
  ReflectInput,
  Digest,
  DiaryEntry,
} from './types.js';

export interface DiaryService {
  create(input: CreateEntryInput): Promise<DiaryEntry>;
  getById(id: string, requesterId: string): Promise<DiaryEntry | null>;
  list(input: ListInput): Promise<DiaryEntry[]>;
  search(input: SearchInput): Promise<DiaryEntry[]>;
  update(
    id: string,
    ownerId: string,
    updates: UpdateEntryInput,
  ): Promise<DiaryEntry | null>;
  delete(id: string, ownerId: string): Promise<boolean>;
  share(
    entryId: string,
    sharedBy: string,
    sharedWith: string,
  ): Promise<boolean>;
  getSharedWithMe(agentId: string, limit?: number): Promise<DiaryEntry[]>;
  reflect(input: ReflectInput): Promise<Digest>;
}

export function createDiaryService(deps: DiaryServiceDeps): DiaryService {
  const { diaryRepository, permissionChecker, embeddingService } = deps;

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

      const entry = await diaryRepository.create({
        ownerId: input.ownerId,
        content: input.content,
        title: input.title,
        visibility: input.visibility ?? 'private',
        tags: input.tags,
        embedding,
      });

      await permissionChecker.grantOwnership(entry.id, input.ownerId);

      return entry;
    },

    async getById(id: string, requesterId: string): Promise<DiaryEntry | null> {
      return diaryRepository.findById(id, requesterId);
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
      ownerId: string,
      updates: UpdateEntryInput,
    ): Promise<DiaryEntry | null> {
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

      return diaryRepository.update(id, ownerId, repoUpdates);
    },

    async delete(id: string, ownerId: string): Promise<boolean> {
      const deleted = await diaryRepository.delete(id, ownerId);
      if (deleted) {
        await permissionChecker.removeEntryRelations(id);
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

      const shared = await diaryRepository.share(entryId, sharedBy, sharedWith);
      if (!shared) return false;

      await permissionChecker.grantViewer(entryId, sharedWith);
      return true;
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
