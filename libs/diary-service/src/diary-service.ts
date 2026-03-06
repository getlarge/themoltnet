/**
 * @moltnet/diary-service — Diary Service
 *
 * Orchestrates all diary operations: container CRUD, sharing/invitations,
 * and entry CRUD with embedding generation and permission management.
 * Sits between the API layer and the database repositories.
 *
 * ## Authorization Model — Keto as Sole Authority
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ DB Entity          │ Event        │ Keto Relationship           │
 * ├────────────────────┼──────────────┼─────────────────────────────┤
 * │ diaries            │ INSERT       │ Diary:{id}#owner@Agent:{ownerId}           │
 * │ diaries            │ DELETE       │ Remove ALL Diary:{id} relations            │
 * │ diary_entries      │ INSERT       │ DiaryEntry:{id}#parent@Diary:{diaryId}             │
 * │ diary_entries      │ DELETE       │ Remove ALL DiaryEntry:{id} relations       │
 * │ agent_keys         │ INSERT       │ Agent:{identityId}#self@Agent:{identityId} │
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

import type {
  CreateDiaryInput,
  CreateEntryInput,
  Diary,
  DiaryEntry,
  DiaryServiceDeps,
  DiaryShare,
  Digest,
  ListInput,
  ReflectInput,
  SearchInput,
  ShareDiaryInput,
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
  listDiaries(ownerId: string): Promise<Diary[]>;
  findDiary(id: string, agentId: string): Promise<Diary>;
  findOwnedDiary(agentId: string, id: string): Promise<Diary | null>;
  updateDiary(
    id: string,
    agentId: string,
    updates: UpdateDiaryInput,
  ): Promise<Diary | null>;
  deleteDiary(id: string, agentId: string): Promise<boolean>;

  // ── Sharing operations ───────────────────────────────────────
  listShares(diaryId: string): Promise<DiaryShare[]>;
  /**
   * Invite another agent to a diary.
   * Throws DiaryServiceError on business logic failures.
   */
  shareDiary(input: ShareDiaryInput): Promise<DiaryShare>;
  listInvitations(agentId: string): Promise<DiaryShare[]>;
  /** Throws DiaryServiceError if not found or wrong status. */
  acceptInvitation(id: string, agentId: string): Promise<DiaryShare>;
  /** Throws DiaryServiceError if not found or wrong status. */
  declineInvitation(id: string, agentId: string): Promise<DiaryShare>;
  /** Throws DiaryServiceError if diary/agent/share not found. */
  revokeShare(
    diaryId: string,
    fingerprint: string,
    ownerId: string,
  ): Promise<void>;

  // ── Entry operations ─────────────────────────────────────────
  createEntry(input: CreateEntryInput, agentId: string): Promise<DiaryEntry>;
  getEntryById(
    id: string,
    diaryId: string,
    agentId: string,
  ): Promise<DiaryEntry>;
  listEntries(input: ListInput): Promise<DiaryEntry[]>;
  searchEntries(input: SearchInput, agentId: string): Promise<DiaryEntry[]>;
  searchOwned(input: SearchInput, agentId: string): Promise<DiaryEntry[]>;
  searchAccessible(input: SearchInput, agentId: string): Promise<DiaryEntry[]>;
  updateEntry(
    id: string,
    diaryId: string,
    agentId: string,
    updates: UpdateEntryInput,
  ): Promise<DiaryEntry | null>;
  deleteEntry(id: string, diaryId: string, agentId: string): Promise<boolean>;
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
    diaryShareRepository,
    agentRepository,
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
          ownerId: input.ownerId,
          name: input.name,
          visibility: input.visibility ?? 'private',
        });
        try {
          await relationshipWriter.grantDiaryOwner(diary.id, input.ownerId);
        } catch (err) {
          // Keto write failed — compensate by removing the DB row so the
          // diary is not left in a state where it exists in DB but has no
          // Keto owner relation (which would cause 403 on all subsequent ops).
          logger.error(
            { diaryId: diary.id, agentId: input.ownerId, err },
            'diary.keto_grant_failed',
          );
          await diaryRepository.delete(diary.id);
          throw err;
        }
        logger.info(
          { diaryId: diary.id, agentId: input.ownerId },
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

    async listDiaries(agentId: string): Promise<Diary[]> {
      const ids = await relationshipReader.listDiaryIdsByAgent(agentId);
      return diaryRepository.listByIds(ids);
    },

    async findDiary(id: string, agentId: string): Promise<Diary> {
      const allowed = await permissionChecker.canReadDiary(id, agentId);

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

    findOwnedDiary(ownerId: string, id: string): Promise<Diary | null> {
      return diaryRepository.findOwnedById(ownerId, id);
    },

    async updateDiary(
      id: string,
      agentId: string,
      updates: UpdateDiaryInput,
    ): Promise<Diary | null> {
      const diary = await diaryRepository.findById(id);
      if (!diary) return null;
      const allowed = await permissionChecker.canManageDiary(diary.id, agentId);
      if (!allowed)
        throw new DiaryServiceError('forbidden', 'Insufficient permissions');
      return diaryRepository.update(id, updates);
    },

    async deleteDiary(id: string, agentId: string): Promise<boolean> {
      const diary = await diaryRepository.findById(id);
      if (!diary) return false;

      const allowed = await permissionChecker.canManageDiary(diary.id, agentId);
      if (!allowed)
        throw new DiaryServiceError('forbidden', 'Insufficient permissions');

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

    // ── Sharing operations ─────────────────────────────────────

    listShares(diaryId: string): Promise<DiaryShare[]> {
      return diaryShareRepository.listByDiary(diaryId);
    },

    async shareDiary(input: ShareDiaryInput): Promise<DiaryShare> {
      const diary = await diaryRepository.findOwnedById(
        input.ownerId,
        input.diaryId,
      );
      if (!diary) {
        throw new DiaryServiceError('not_found', 'Diary not found');
      }

      const normalizedFingerprint = input.fingerprint.toUpperCase();
      const targetAgent = await agentRepository.findByFingerprint(
        normalizedFingerprint,
      );
      if (!targetAgent) {
        throw new DiaryServiceError(
          'not_found',
          `Agent with fingerprint "${normalizedFingerprint}" not found`,
        );
      }

      if (targetAgent.identityId === input.ownerId) {
        throw new DiaryServiceError(
          'self_share',
          'Cannot share a diary with yourself',
        );
      }

      const existingShare = await diaryShareRepository.findByDiaryAndAgent(
        diary.id,
        targetAgent.identityId,
      );

      if (existingShare) {
        if (
          existingShare.status === 'revoked' ||
          existingShare.status === 'declined'
        ) {
          const updated = await diaryShareRepository.updateStatus(
            existingShare.id,
            'pending',
            { respondedAt: null, role: input.role ?? 'reader' },
          );
          if (!updated) {
            throw new DiaryServiceError('not_found', 'Share not found');
          }
          return updated;
        }
        throw new DiaryServiceError(
          'already_shared',
          `Share already exists with status "${existingShare.status}"`,
        );
      }

      const share = await diaryShareRepository.create({
        diaryId: diary.id,
        sharedWith: targetAgent.identityId,
        role: input.role ?? 'reader',
      });

      if (!share) {
        throw new DiaryServiceError(
          'already_shared',
          'Share already exists for this diary and agent',
        );
      }

      logger.info(
        { diaryId: diary.id, targetAgentId: targetAgent.identityId },
        'diary.shared',
      );
      return share;
    },

    listInvitations(agentId: string): Promise<DiaryShare[]> {
      return diaryShareRepository.listPendingForAgent(agentId);
    },

    acceptInvitation(id: string, agentId: string): Promise<DiaryShare> {
      return transactionRunner.runInTransaction(
        async () => {
          const share = await diaryShareRepository.findById(id);
          if (!share || share.sharedWith !== agentId) {
            throw new DiaryServiceError('not_found', 'Invitation not found');
          }

          if (share.status !== 'pending') {
            throw new DiaryServiceError(
              'wrong_status',
              `Invitation has already been ${share.status}`,
            );
          }

          const accepted = await diaryShareRepository.updateStatus(
            id,
            'accepted',
          );
          if (!accepted) {
            throw new DiaryServiceError('not_found', 'Invitation not found');
          }

          if (accepted.role === 'writer') {
            await relationshipWriter.grantDiaryWriter(
              accepted.diaryId,
              agentId,
            );
          } else {
            await relationshipWriter.grantDiaryReader(
              accepted.diaryId,
              agentId,
            );
          }

          return accepted;
        },
        { name: 'diary.accept-invitation' },
      );
    },

    async declineInvitation(id: string, agentId: string): Promise<DiaryShare> {
      const share = await diaryShareRepository.findById(id);
      if (!share || share.sharedWith !== agentId) {
        throw new DiaryServiceError('not_found', 'Invitation not found');
      }

      if (share.status !== 'pending') {
        throw new DiaryServiceError(
          'wrong_status',
          `Invitation has already been ${share.status}`,
        );
      }

      const updated = await diaryShareRepository.updateStatus(id, 'declined');
      if (!updated) {
        throw new DiaryServiceError('not_found', 'Invitation not found');
      }

      return updated;
    },

    async revokeShare(
      diaryId: string,
      fingerprint: string,
      ownerId: string,
    ): Promise<void> {
      const diary = await diaryRepository.findOwnedById(ownerId, diaryId);
      if (!diary) {
        throw new DiaryServiceError('not_found', 'Diary not found');
      }

      const normalizedFingerprint = fingerprint.toUpperCase();
      const targetAgent = await agentRepository.findByFingerprint(
        normalizedFingerprint,
      );
      if (!targetAgent) {
        throw new DiaryServiceError(
          'not_found',
          `Agent with fingerprint "${normalizedFingerprint}" not found`,
        );
      }

      const share = await diaryShareRepository.findByDiaryAndAgent(
        diary.id,
        targetAgent.identityId,
      );
      if (!share) {
        throw new DiaryServiceError('not_found', 'Share not found');
      }

      await transactionRunner.runInTransaction(
        async () => {
          await diaryShareRepository.updateStatus(share.id, 'revoked');
          await relationshipWriter.removeDiaryRelationForAgent(
            diary.id,
            targetAgent.identityId,
          );
        },
        { name: 'diary.revoke-share' },
      );
    },

    // ── Entry operations ───────────────────────────────────────

    async createEntry(
      input: CreateEntryInput,
      agentId: string,
    ): Promise<DiaryEntry> {
      const diary = await diaryRepository.findById(input.diaryId);
      if (!diary) {
        throw new DiaryServiceError('not_found', 'Diary not found');
      }
      const allowed = await permissionChecker.canWriteDiary(
        input.diaryId,
        agentId,
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

      const entry = await diaryWorkflows.createEntry(input);
      logger.info(
        { entryId: entry.id, diaryId: input.diaryId, type: input.entryType },
        'entry.created',
      );
      return entry;
    },

    async getEntryById(
      id: string,
      diaryId: string,
      agentId: string,
    ): Promise<DiaryEntry> {
      const entry = await diaryEntryRepository.findById(id);
      if (!entry || entry.diaryId !== diaryId) {
        throw new DiaryServiceError('not_found', 'Diary entry not found');
      }
      const allowed = await permissionChecker.canViewEntry(id, agentId);
      if (!allowed) {
        throw new DiaryServiceError('forbidden', 'Insufficient permissions');
      }
      return entry;
    },

    listEntries(input: ListInput): Promise<DiaryEntry[]> {
      return diaryEntryRepository.list({
        diaryId: input.diaryId,
        tags: input.tags,
        limit: input.limit,
        offset: input.offset,
        entryType: input.entryType,
      });
    },

    async searchEntries(
      input: SearchInput,
      agentId: string,
    ): Promise<DiaryEntry[]> {
      if (input.diaryId) {
        await this.findDiary(input.diaryId, agentId); // also checks access
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
      const ownedDiaries = await diaryRepository.listByOwner(agentId);
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
      const [ownedDiaries, acceptedShares] = await Promise.all([
        diaryRepository.listByOwner(agentId),
        diaryShareRepository.listAcceptedForAgent(agentId),
      ]);
      const diaryIds = [
        ...new Set([
          ...ownedDiaries.map((d) => d.id),
          ...acceptedShares.map((s) => s.diaryId),
        ]),
      ];
      if (!diaryIds.length) return [];
      return diaryEntryRepository.search({
        ...input,
        diaryIds,
        embedding: await resolveEmbedding(input.query),
      });
    },

    async updateEntry(
      id: string,
      diaryId: string,
      agentId: string,
      updates: UpdateEntryInput,
    ): Promise<DiaryEntry | null> {
      const diary = await this.findDiary(diaryId, agentId);

      if (
        updates.content &&
        updates.content.length > MAX_PUBLIC_CONTENT_LENGTH &&
        diary.visibility === 'public'
      ) {
        throw new DiaryServiceError(
          'validation_failed',
          'Public diary entries are limited to 10,000 characters',
        );
      }
      const allowed = await permissionChecker.canEditEntry(id, agentId);
      if (!allowed)
        throw new DiaryServiceError('forbidden', 'Insufficient permissions');

      // Fetch existing entry when the update touches fields that require it
      // (immutability check for signed entries, embedding rebuild for content changes)
      const touchesContent =
        updates.content !== undefined ||
        updates.title !== undefined ||
        updates.entryType !== undefined ||
        updates.tags !== undefined ||
        updates.importance !== undefined;
      const existing = touchesContent
        ? await diaryEntryRepository.findById(id)
        : null;

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
            'Entry is content-signed and immutable — content, title, entryType, and tags are included in the content hash. Create a new entry and set superseded_by on this one.',
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

      const updated = await diaryWorkflows.updateEntry(
        id,
        updates,
        existing?.content,
        existing?.title,
        existing?.tags,
      );
      if (updated) {
        logger.info({ entryId: id, diaryId }, 'entry.updated');
      }
      return updated;
    },

    async deleteEntry(
      id: string,
      diaryId: string,
      agentId: string,
    ): Promise<boolean> {
      await this.findDiary(diaryId, agentId);

      const allowed = await permissionChecker.canDeleteEntry(id, agentId);
      if (!allowed)
        throw new DiaryServiceError('forbidden', 'Insufficient permissions');

      // const existing = await fastify.diaryService.getEntryById(
      //   entryId,
      //   diaryId,
      //   request.authContext!.identityId,
      // );
      // if (!existing || existing.diaryId !== diary.id) {
      //   throw createProblem('not-found', 'Entry not found');
      // }

      const deleted = await diaryWorkflows.deleteEntry(id);
      if (deleted) {
        logger.info({ entryId: id, diaryId }, 'entry.deleted');
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
