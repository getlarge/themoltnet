/**
 * @moltnet/diary-service — Diary Service
 *
 * Orchestrates all diary operations: container CRUD (team-scoped)
 * and entry CRUD with embedding generation and permission management.
 * Sits between the API layer and the database repositories.
 *
 * ## Authorization Model — Keto as Sole Authority
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ DB Entity          │ Event        │ Keto Relationship           │
 * ├────────────────────┼──────────────┼─────────────────────────────┤
 * │ diaries            │ INSERT       │ Diary:{id}#team@Team:{teamId}              │
 * │ diaries            │ DELETE       │ Remove ALL Diary:{id} relations            │
 * │ diary_entries      │ INSERT       │ DiaryEntry:{id}#parent@Diary:{diaryId}     │
 * │ diary_entries      │ DELETE       │ Remove ALL DiaryEntry:{id} relations       │
 * │ agents             │ INSERT       │ Agent:{identityId}#self@Agent:{identityId} │
 * └────────────────────┴──────────────┴─────────────────────────────┘
 * ```
 *
 * ## Transaction Discipline
 *
 * DB writes use `transactionRunner.runInTransaction()` for atomicity.
 * Repositories participate automatically via AsyncLocalStorage — no
 * explicit tx passing needed.
 * Keto relationship writes happen inside the transaction.
 */

import type { KetoNamespace } from '@moltnet/auth';
import { computeContentCid } from '@moltnet/crypto-service';

import type {
  CreateDiaryInput,
  CreateEntryInput,
  Diary,
  DiaryEntry,
  DiaryServiceDeps,
  Digest,
  ListInput,
  ListTagsInput,
  ReflectInput,
  SearchInput,
  TagCount,
  UpdateDiaryInput,
  UpdateEntryInput,
} from './types.js';
import { DiaryServiceError } from './types.js';
import { diaryWorkflows } from './workflows/diary-workflows.js';

// Public diary entries: limit to prevent abuse via oversized content
export const MAX_PUBLIC_CONTENT_LENGTH = 10_000;

export interface DiaryService {
  // ── Diary container operations ───────────────────────────────
  createDiary(
    input: CreateDiaryInput,
    opts?: { withinTransaction?: boolean },
  ): Promise<Diary>;
  listDiaries(agentId: string, teamId?: string): Promise<Diary[]>;
  findDiary(
    id: string,
    agentId: string,
    subjectNs: KetoNamespace,
  ): Promise<Diary>;
  findOwnedDiary(agentId: string, id: string): Promise<Diary | null>;
  updateDiary(
    id: string,
    agentId: string,
    subjectNs: KetoNamespace,
    updates: UpdateDiaryInput,
  ): Promise<Diary | null>;
  deleteDiary(
    id: string,
    agentId: string,
    subjectNs: KetoNamespace,
  ): Promise<boolean>;

  // ── Entry operations ─────────────────────────────────────────
  createEntry(
    input: CreateEntryInput,
    agentId: string,
    subjectNs: KetoNamespace,
  ): Promise<DiaryEntry>;
  getEntryById(
    id: string,
    agentId: string,
    subjectNs: KetoNamespace,
    opts?: { diaryId?: string },
  ): Promise<DiaryEntry>;
  listEntries(
    input: ListInput,
  ): Promise<{ items: DiaryEntry[]; total: number }>;
  listTags(
    input: ListTagsInput,
    agentId: string,
    subjectNs: KetoNamespace,
  ): Promise<TagCount[]>;
  searchEntries(
    input: SearchInput,
    agentId: string,
    subjectNs: KetoNamespace,
  ): Promise<DiaryEntry[]>;
  searchOwned(input: SearchInput, agentId: string): Promise<DiaryEntry[]>;
  searchAccessible(input: SearchInput, agentId: string): Promise<DiaryEntry[]>;
  updateEntry(
    id: string,
    agentId: string,
    subjectNs: KetoNamespace,
    updates: UpdateEntryInput,
  ): Promise<DiaryEntry | null>;
  deleteEntry(
    id: string,
    agentId: string,
    subjectNs: KetoNamespace,
  ): Promise<boolean>;
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
    logger,
    diaryRepository,
    diaryEntryRepository,
    entryRelationRepository,
    permissionChecker,
    relationshipReader,
    relationshipWriter,
    embeddingService,
    transactionRunner,
  } = deps;

  const resolveEmbedding = async (
    query?: string,
  ): Promise<number[] | undefined> => {
    if (!query) return undefined;
    try {
      const result = await embeddingService.embedQuery(query);
      return result.length > 0 ? result : undefined;
    } catch (err) {
      logger.warn({ err }, 'diary.embedding_failed');
      return undefined;
    }
  };

  return {
    // ── Diary container operations ─────────────────────────────

    // TODO: replace `withinTransaction` option with local storage check
    async createDiary(
      input: CreateDiaryInput,
      opts?: { withinTransaction?: boolean },
    ): Promise<Diary> {
      const doCreate = async () => {
        const diary = await diaryRepository.create({
          createdBy: input.createdBy,
          name: input.name,
          visibility: input.visibility ?? 'private',
          teamId: input.teamId,
        });
        try {
          await relationshipWriter.grantDiaryTeam(diary.id, input.teamId);
        } catch (err) {
          // Keto write failed — compensate by removing the DB row so the
          // diary is not left in a state where it exists in DB but has no
          // Keto team relation (which would cause 403 on all subsequent ops).
          logger.error(
            { diaryId: diary.id, createdBy: input.createdBy, err },
            'diary.keto_grant_failed',
          );
          try {
            await diaryRepository.delete(diary.id);
          } catch (deleteErr) {
            // Compensation failed — orphan persists. Log without re-throwing
            // so the original Keto error is preserved.
            logger.error(
              { diaryId: diary.id, deleteErr },
              'diary.compensation_delete_failed',
            );
          }
          throw err;
        }
        logger.info(
          {
            diaryId: diary.id,
            createdBy: input.createdBy,
            teamId: input.teamId,
          },
          'diary.created',
        );
        return diary;
      };

      if (opts?.withinTransaction) {
        return doCreate();
      }
      return transactionRunner.runInTransaction(doCreate, {
        name: 'diary.create-diary',
      });
    },

    async listDiaries(agentId: string, teamId?: string): Promise<Diary[]> {
      const teamIds = await relationshipReader.listTeamIdsBySubject(agentId);
      if (teamId) {
        if (!teamIds.includes(teamId)) return [];
        return diaryRepository.listByTeamIds([teamId]);
      }
      return diaryRepository.listByTeamIds(teamIds);
    },

    async findDiary(
      id: string,
      agentId: string,
      subjectNs: KetoNamespace,
    ): Promise<Diary> {
      const allowed = await permissionChecker.canReadDiary(
        id,
        agentId,
        subjectNs,
      );

      if (allowed) {
        const diary = await diaryRepository.findById(id);
        if (diary) {
          return diary;
        }
      }
      throw new DiaryServiceError(
        'not_found',
        'Diary not found or access denied',
      );
    },

    findOwnedDiary(createdBy: string, id: string): Promise<Diary | null> {
      return diaryRepository.findByCreator(createdBy, id);
    },

    async updateDiary(
      id: string,
      agentId: string,
      subjectNs: KetoNamespace,
      updates: UpdateDiaryInput,
    ): Promise<Diary | null> {
      const diary = await diaryRepository.findById(id);
      if (!diary) return null;
      const allowed = await permissionChecker.canManageDiary(
        diary.id,
        agentId,
        subjectNs,
      );
      if (!allowed)
        throw new DiaryServiceError('forbidden', 'Insufficient permissions');
      return diaryRepository.update(id, updates);
    },

    async deleteDiary(
      id: string,
      agentId: string,
      subjectNs: KetoNamespace,
    ): Promise<boolean> {
      const diary = await diaryRepository.findById(id);
      if (!diary) return false;

      const allowed = await permissionChecker.canManageDiary(
        diary.id,
        agentId,
        subjectNs,
      );
      if (!allowed)
        throw new DiaryServiceError('forbidden', 'Insufficient permissions');

      const signedCount = await diaryEntryRepository.countSignedByDiary(id);
      if (signedCount > 0) {
        throw new DiaryServiceError(
          'immutable',
          `Cannot delete diary: it contains ${signedCount} signed ${signedCount === 1 ? 'entry' : 'entries'}. Delete unsigned entries individually and use entry relations (supersedes) for signed ones.`,
        );
      }

      await transactionRunner.runInTransaction(
        async () => {
          const deleted = await diaryRepository.delete(diary.id);
          if (!deleted) throw new Error('Delete failed unexpectedly');
          await relationshipWriter.removeDiaryRelations(diary.id);
        },
        { name: 'diary.delete-diary' },
      );

      logger.info({ diaryId: id }, 'diary.deleted');
      return true;
    },

    // ── Entry operations ───────────────────────────────────────

    async createEntry(
      input: CreateEntryInput,
      agentId: string,
      subjectNs: KetoNamespace,
    ): Promise<DiaryEntry> {
      const diary = await diaryRepository.findById(input.diaryId);
      if (!diary) {
        throw new DiaryServiceError('not_found', 'Diary not found');
      }
      const allowed = await permissionChecker.canWriteDiary(
        input.diaryId,
        agentId,
        subjectNs,
      );
      if (!allowed) {
        throw new DiaryServiceError(
          'forbidden',
          'You do not have permission to write to this diary',
        );
      }
      if (
        diary.visibility === 'public' &&
        input.content.length > MAX_PUBLIC_CONTENT_LENGTH
      ) {
        throw new DiaryServiceError(
          'validation_failed',
          'Public diary entries are limited to 10,000 characters',
        );
      }

      const resolvedEntryType = input.entryType ?? 'semantic';
      const computedContentHash = computeContentCid(
        resolvedEntryType,
        input.title ?? null,
        input.content,
        input.tags ?? null,
      );

      if (
        input.contentHash !== undefined &&
        input.contentHash !== null &&
        input.contentHash !== computedContentHash
      ) {
        throw new DiaryServiceError(
          'validation_failed',
          `Content hash mismatch: provided ${input.contentHash}, computed ${computedContentHash}`,
        );
      }

      const entry = await diaryWorkflows.createEntry({
        ...input,
        contentHash: computedContentHash,
        entryType: resolvedEntryType,
        createdBy: agentId,
      });
      logger.info(
        {
          entryId: entry.id,
          diaryId: input.diaryId,
          type: resolvedEntryType,
        },
        'entry.created',
      );
      return entry;
    },

    async getEntryById(
      id: string,
      agentId: string,
      subjectNs: KetoNamespace,
      opts?: { diaryId?: string },
    ): Promise<DiaryEntry> {
      const diaryId = opts?.diaryId;
      const entry = await diaryEntryRepository.findById(id);
      if (!entry || (diaryId && entry.diaryId !== diaryId)) {
        throw new DiaryServiceError('not_found', 'Diary entry not found');
      }
      const allowed = await permissionChecker.canViewEntry(
        id,
        agentId,
        subjectNs,
      );
      if (!allowed) {
        throw new DiaryServiceError('forbidden', 'Insufficient permissions');
      }
      return entry;
    },

    listEntries(
      input: ListInput,
    ): Promise<{ items: DiaryEntry[]; total: number }> {
      return diaryEntryRepository.list({
        diaryId: input.diaryId,
        ids: input.ids,
        tags: input.tags,
        excludeTags: input.excludeTags,
        limit: input.limit,
        offset: input.offset,
        entryTypes: input.entryTypes,
      });
    },

    async listTags(
      input: ListTagsInput,
      agentId: string,
      subjectNs: KetoNamespace,
    ): Promise<TagCount[]> {
      await this.findDiary(input.diaryId, agentId, subjectNs);
      return diaryEntryRepository.listTags({
        diaryId: input.diaryId,
        prefix: input.prefix,
        minCount: input.minCount,
        entryTypes: input.entryTypes,
      });
    },

    async searchEntries(
      input: SearchInput,
      agentId: string,
      subjectNs: KetoNamespace,
    ): Promise<DiaryEntry[]> {
      if (input.diaryId) {
        await this.findDiary(input.diaryId, agentId, subjectNs); // also checks access
      }
      const results = await diaryEntryRepository.search({
        ...input,
        embedding: await resolveEmbedding(input.query),
      });
      logger.debug(
        {
          diaryId: input.diaryId,
          query: input.query,
          resultCount: results.length,
        },
        'entry.searched',
      );
      return results;
    },

    async searchOwned(
      input: SearchInput,
      agentId: string,
    ): Promise<DiaryEntry[]> {
      const ownedDiaries = await diaryRepository.listByCreator(agentId);
      if (!ownedDiaries.length) return [];
      return diaryEntryRepository.search({
        ...input,
        diaryIds: ownedDiaries.map((d) => d.id),
        embedding: await resolveEmbedding(input.query),
      });
    },

    async searchAccessible(
      input: SearchInput,
      agentId: string,
    ): Promise<DiaryEntry[]> {
      const teamIds = await relationshipReader.listTeamIdsBySubject(agentId);
      if (!teamIds.length) return [];
      return diaryEntryRepository.search({
        ...input,
        teamIds,
        embedding: await resolveEmbedding(input.query),
      });
    },

    async updateEntry(
      id: string,
      agentId: string,
      subjectNs: KetoNamespace,
      updates: UpdateEntryInput,
    ): Promise<DiaryEntry | null> {
      // Strip contentHash from external input — only the service computes it
      const { contentHash: _stripped, ...sanitizedUpdates } = updates;
      updates = sanitizedUpdates;

      const allowed = await permissionChecker.canEditEntry(
        id,
        agentId,
        subjectNs,
      );
      if (!allowed)
        throw new DiaryServiceError('forbidden', 'Insufficient permissions');

      const touchesCidFields =
        updates.content !== undefined ||
        updates.title !== undefined ||
        updates.entryType !== undefined ||
        updates.tags !== undefined;
      const touchesContent =
        touchesCidFields || updates.importance !== undefined;

      let existing: DiaryEntry | null = null;
      if (touchesContent) {
        existing = await diaryEntryRepository.findById(id);
        if (!existing) {
          throw new DiaryServiceError('not_found', 'Diary entry not found');
        }
      }

      if (
        updates.content &&
        updates.content.length > MAX_PUBLIC_CONTENT_LENGTH
      ) {
        const diaryIdForCheck = existing?.diaryId;
        if (!diaryIdForCheck) {
          throw new DiaryServiceError('not_found', 'Diary not found');
        }
        const diary = await diaryRepository.findById(diaryIdForCheck);
        if (!diary) {
          throw new DiaryServiceError('not_found', 'Diary not found');
        }
        if (diary.visibility === 'public') {
          throw new DiaryServiceError(
            'validation_failed',
            'Public diary entries are limited to 10,000 characters',
          );
        }
      }

      // Enforce immutability for content-signed entries
      if (existing?.contentSignature) {
        // All fields included in the CID are immutable on signed entries:
        // content, title, entryType, and tags.
        if (
          updates.content !== undefined ||
          updates.title !== undefined ||
          updates.entryType !== undefined ||
          updates.tags !== undefined
        ) {
          throw new DiaryServiceError(
            'immutable',
            'Entry is content-signed and immutable — content, title, entryType, and tags are included in the content hash. Create a new entry and relate it with a supersedes relation.',
          );
        }

        // importance is also immutable on identity/soul/reflection entries
        if (
          (existing.entryType === 'identity' ||
            existing.entryType === 'soul' ||
            existing.entryType === 'reflection') &&
          updates.importance !== undefined
        ) {
          throw new DiaryServiceError(
            'immutable',
            'Importance is immutable on signed identity, soul, and reflection entries.',
          );
        }
      }

      // Recompute contentHash for unsigned entries when CID-input fields change
      let finalUpdates: UpdateEntryInput = updates;
      if (touchesCidFields && existing && !existing.contentSignature) {
        const mergedContent = updates.content ?? existing.content;
        const mergedTitle =
          updates.title !== undefined ? updates.title : existing.title;
        const mergedEntryType = updates.entryType ?? existing.entryType;
        const mergedTags =
          updates.tags !== undefined ? updates.tags : existing.tags;

        finalUpdates = {
          ...updates,
          contentHash: computeContentCid(
            mergedEntryType,
            mergedTitle ?? null,
            mergedContent,
            mergedTags ?? null,
          ),
        };
      }

      const updated = await diaryWorkflows.updateEntry(
        id,
        finalUpdates,
        existing?.content,
        existing?.title,
        existing?.tags,
      );
      if (updated) {
        logger.info(
          {
            entryId: id,
            diaryId: existing?.diaryId ?? null,
          },
          'entry.updated',
        );
      }
      return updated;
    },

    async deleteEntry(
      id: string,
      agentId: string,
      subjectNs: KetoNamespace,
    ): Promise<boolean> {
      const allowed = await permissionChecker.canDeleteEntry(
        id,
        agentId,
        subjectNs,
      );
      if (!allowed)
        throw new DiaryServiceError('forbidden', 'Insufficient permissions');

      const existing = await diaryEntryRepository.findById(id);
      if (!existing) {
        throw new DiaryServiceError('not_found', 'Diary entry not found');
      }

      if (existing.contentSignature) {
        throw new DiaryServiceError(
          'immutable',
          'Cannot delete a content-signed entry. Create a new entry and relate it with a supersedes relation instead.',
        );
      }

      const deleted = await diaryWorkflows.deleteEntry(id);
      if (deleted) {
        logger.info(
          { entryId: id, diaryId: existing.diaryId },
          'entry.deleted',
        );
      }
      return deleted;
    },

    async reflect(input: ReflectInput): Promise<Digest> {
      const { diaryId, days = 7, maxEntries = 50, entryTypes } = input;
      // TODO: add permission check
      const entries = await diaryEntryRepository.getRecentForDigest(
        diaryId,
        days,
        maxEntries,
        entryTypes,
      );

      // Exclude superseded entries from reflection
      const entryIds = entries.map((e) => e.id);
      const supersededIds =
        entryIds.length > 0
          ? new Set(
              await entryRelationRepository.listSupersededTargetIds(entryIds),
            )
          : new Set<string>();
      const activeEntries = entries.filter((e) => !supersededIds.has(e.id));

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
