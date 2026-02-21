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
 * │ diary_entries      │ INSERT       │ DiaryEntry:{id}#owner@Agent:{requesterId}  │
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

import { scanForInjection } from './injection-scanner.js';
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

export interface DiaryService {
  // ── Diary container operations ───────────────────────────────
  createDiary(
    input: CreateDiaryInput,
    opts?: { withinTransaction?: boolean },
  ): Promise<Diary>;
  listDiaries(ownerId: string): Promise<Diary[]>;
  /**
   * Find a diary by ID, checking access permission.
   * Returns null if the diary does not exist or the requester lacks access.
   * To hide existence from unauthorized requesters, both cases return null.
   */
  findDiary(
    id: string,
    requesterId: string,
    mode: 'read' | 'write' | 'manage',
  ): Promise<Diary | null>;
  findOwnedDiary(ownerId: string, id: string): Promise<Diary | null>;
  updateDiary(
    id: string,
    ownerId: string,
    updates: UpdateDiaryInput,
  ): Promise<Diary | null>;
  deleteDiary(id: string, ownerId: string): Promise<boolean>;

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
    diaryEntryRepository,
    diaryShareRepository,
    agentRepository,
    permissionChecker,
    relationshipWriter,
    embeddingService,
    transactionRunner,
  } = deps;

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
        await relationshipWriter.grantDiaryOwner(diary.id, input.ownerId);
        return diary;
      };

      if (opts?.withinTransaction) {
        return doCreate();
      }
      return transactionRunner.runInTransaction(doCreate, {
        name: 'diary.create-diary',
      });
    },

    async listDiaries(ownerId: string): Promise<Diary[]> {
      return diaryRepository.listByOwner(ownerId);
    },

    async findDiary(
      id: string,
      requesterId: string,
      mode: 'read' | 'write' | 'manage',
    ): Promise<Diary | null> {
      const diary = await diaryRepository.findById(id);
      if (!diary) return null;

      let allowed: boolean;
      if (mode === 'read') {
        allowed = await permissionChecker.canReadDiary(diary.id, requesterId);
      } else if (mode === 'write') {
        allowed = await permissionChecker.canWriteDiary(diary.id, requesterId);
      } else {
        allowed = await permissionChecker.canManageDiary(diary.id, requesterId);
      }

      return allowed ? diary : null;
    },

    findOwnedDiary(ownerId: string, id: string): Promise<Diary | null> {
      return diaryRepository.findOwnedById(ownerId, id);
    },

    updateDiary(
      id: string,
      ownerId: string,
      updates: UpdateDiaryInput,
    ): Promise<Diary | null> {
      return diaryRepository.update(id, ownerId, updates);
    },

    async deleteDiary(id: string, ownerId: string): Promise<boolean> {
      const diary = await diaryRepository.findOwnedById(ownerId, id);
      if (!diary) return false;

      await transactionRunner.runInTransaction(
        async () => {
          const deleted = await diaryRepository.delete(diary.id, ownerId);
          if (!deleted) throw new Error('Delete failed unexpectedly');
          await relationshipWriter.removeDiaryRelations(diary.id);
        },
        { name: 'diary.delete-diary' },
      );

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

    async create(input: CreateEntryInput): Promise<DiaryEntry> {
      // TODO: wrap in DBOS workflow
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
        diaryId: input.diaryId,
        content: input.content,
        title: input.title,
        tags: input.tags,
        embedding,
        injectionRisk,
        importance: input.importance,
        entryType: input.entryType,
      };

      const result = await transactionRunner.runInTransaction(
        async () => {
          const entry = await diaryEntryRepository.create(entryData);
          await relationshipWriter.grantOwnership(entry.id, input.requesterId);
          return entry;
        },
        { name: 'diary.create' },
      );

      return result;
    },

    async getById(id: string, requesterId: string): Promise<DiaryEntry | null> {
      const allowed = await permissionChecker.canViewEntry(id, requesterId);
      if (!allowed) return null;

      return diaryEntryRepository.findById(id);
    },

    list(input: ListInput): Promise<DiaryEntry[]> {
      return diaryEntryRepository.list({
        diaryId: input.diaryId,
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

      return diaryEntryRepository.search({
        diaryId: input.diaryId,
        query: input.query,
        embedding,
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
      // TODO: wrap in DBOS workflow
      const allowed = await permissionChecker.canEditEntry(id, requesterId);
      if (!allowed) return null;

      const repoUpdates: Record<string, unknown> = { ...updates };
      const needsExisting =
        updates.content ||
        updates.title !== undefined ||
        updates.tags !== undefined;
      const existing = needsExisting
        ? await diaryEntryRepository.findById(id)
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

      return diaryEntryRepository.update(id, repoUpdates);
    },

    async delete(id: string, requesterId: string): Promise<boolean> {
      // TODO: wrap in DBOS workflow
      const allowed = await permissionChecker.canDeleteEntry(id, requesterId);
      if (!allowed) return false;

      const result = await transactionRunner.runInTransaction(
        async () => {
          const deleted = await diaryEntryRepository.delete(id);
          if (deleted) {
            await relationshipWriter.removeEntryRelations(id);
          }
          return deleted;
        },
        { name: 'diary.delete' },
      );

      return result;
    },

    async reflect(input: ReflectInput): Promise<Digest> {
      const { diaryId, days = 7, maxEntries = 50, entryTypes } = input;

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
