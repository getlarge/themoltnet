import type { PermissionChecker } from '@moltnet/auth';
import { estimateTokens } from '@moltnet/context-distill';
import {
  computeContentHash,
  computePackCid,
  computeRenderedPackCid,
  type PackEntryRef,
} from '@moltnet/crypto-service';
import type {
  ContextPackRepository,
  DiaryEntryRepository,
  RenderedPackRepository,
} from '@moltnet/database';

import { fitEntries } from './entry-fitter.js';
import type { EntryFetcher } from './entry-loader.js';
import { loadSelectedEntries } from './entry-loader.js';
import { renderPackToMarkdown } from './pack-renderer.js';
import type {
  CreateCustomPackInput,
  CreateRenderedPackInput,
  FitResult,
  GetLatestRenderedPackInput,
  GetPackByIdInput,
  GetPackForProvenanceInput,
  GetRenderedPackByIdInput,
  ListPacksByDiaryInput,
  ListPacksByDiaryResult,
  ListPacksByEntryInput,
  ListRenderedPacksByDiaryInput,
  ListRenderedPacksByDiaryResult,
  PackActor,
  PacksByEntryResult,
  PackWithOptionalEntries,
  PreviewRenderedPackInput,
  RenderedPackPreview,
  RenderedPackResult,
} from './types.js';

export interface ContextPackServiceDeps {
  contextPackRepository: Pick<
    ContextPackRepository,
    | 'createPack'
    | 'addEntries'
    | 'findById'
    | 'findByCid'
    | 'findByEntryId'
    | 'listByDiary'
    | 'listEntriesExpanded'
    | 'listEntriesExpandedByPackIds'
  >;
  renderedPackRepository: Pick<
    RenderedPackRepository,
    | 'create'
    | 'findById'
    | 'findByCid'
    | 'findLatestBySourcePackId'
    | 'listByDiary'
    | 'listBySourcePackIds'
  >;
  diaryEntryRepository: Pick<DiaryEntryRepository, 'findById'>;
  permissionChecker: Pick<
    PermissionChecker,
    'canViewEntry' | 'canReadPack' | 'canReadPacks'
  >;
  entryFetcher: EntryFetcher;
  runTransaction: <T>(fn: () => Promise<T>) => Promise<T>;
  grantPackParent: (packId: string, diaryId: string) => Promise<void>;
  removePackRelations: (packId: string) => Promise<void>;
  deleteMany: (ids: string[]) => Promise<number>;
  /**
   * Verifies the actor can read the diary. Must throw on denied/not-found.
   * Typically wired to `DiaryService.findDiary`.
   */
  assertDiaryReadable: (
    diaryId: string,
    identityId: string,
    subjectNs: PackActor['subjectNs'],
  ) => Promise<void>;
  logger?: { error: (obj: Record<string, unknown>, msg: string) => void };
  ttlDays: number;
}

export class PackServiceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'not_found'
      | 'forbidden'
      | 'conflict'
      | 'validation'
      | 'internal',
  ) {
    super(message);
    this.name = 'PackServiceError';
  }
}

export interface CustomPackResult {
  id: string;
  packCid: string;
  packType: 'custom';
  params: Record<string, unknown>;
  fitResult: FitResult;
  persisted: boolean;
}

export class ContextPackService {
  constructor(private readonly deps: ContextPackServiceDeps) {}

  async listPacksByEntry(
    input: ListPacksByEntryInput,
  ): Promise<PacksByEntryResult> {
    const entry = await this.deps.diaryEntryRepository.findById(input.entryId);
    if (!entry) {
      throw new PackServiceError(
        `Entry ${input.entryId} not found`,
        'not_found',
      );
    }

    const allowed = await this.deps.permissionChecker.canViewEntry(
      input.entryId,
      input.actor.identityId,
      input.actor.subjectNs,
    );
    if (!allowed) {
      throw new PackServiceError(
        `Not authorized to read entry ${input.entryId}`,
        'forbidden',
      );
    }

    const result = await this.deps.contextPackRepository.findByEntryId(
      input.entryId,
      {
        diaryId: input.diaryId,
        limit: input.limit,
        offset: input.offset,
      },
    );

    if (result.items.length === 0) {
      return input.includeRendered
        ? { items: [], total: result.total, renderedPacks: [] }
        : { items: [], total: result.total };
    }

    const readablePacks = await this.deps.permissionChecker.canReadPacks(
      result.items.map((pack) => pack.id),
      input.actor.identityId,
      input.actor.subjectNs,
    );
    const visibleItems = result.items.filter(
      (pack) => readablePacks.get(pack.id) ?? false,
    );
    const deniedOnPage = result.items.length - visibleItems.length;

    const response: PacksByEntryResult = {
      items: visibleItems,
      total: result.total - deniedOnPage,
    };

    if (input.includeRendered && visibleItems.length > 0) {
      response.renderedPacks =
        await this.deps.renderedPackRepository.listBySourcePackIds(
          visibleItems.map((pack) => pack.id),
        );
    }

    return response;
  }

  async getPackById(input: GetPackByIdInput) {
    const pack = await this.deps.contextPackRepository.findById(input.packId);
    if (!pack) {
      throw new PackServiceError('Context pack not found', 'not_found');
    }
    await this.assertCanReadPack(pack.id, input.actor);

    if (!input.expandEntries) {
      return pack;
    }
    const entries = await this.deps.contextPackRepository.listEntriesExpanded(
      pack.id,
    );
    return { ...pack, entries };
  }

  async getPackForProvenance(input: GetPackForProvenanceInput) {
    if (!input.packId && !input.packCid) {
      throw new PackServiceError('packId or packCid is required', 'validation');
    }
    const pack = input.packId
      ? await this.deps.contextPackRepository.findById(input.packId)
      : await this.deps.contextPackRepository.findByCid(input.packCid!);
    if (!pack) {
      throw new PackServiceError('Context pack not found', 'not_found');
    }
    await this.assertCanReadPack(pack.id, input.actor);
    return pack;
  }

  async listPacksByDiary(
    input: ListPacksByDiaryInput,
  ): Promise<ListPacksByDiaryResult> {
    const limit = input.limit ?? 20;
    const offset = input.offset ?? 0;

    await this.deps.assertDiaryReadable(
      input.diaryId,
      input.actor.identityId,
      input.actor.subjectNs,
    );

    const { items: packs, total } =
      await this.deps.contextPackRepository.listByDiary(
        input.diaryId,
        limit,
        offset,
      );

    let allowed: Map<string, boolean>;
    try {
      allowed = await this.deps.permissionChecker.canReadPacks(
        packs.map((p) => p.id),
        input.actor.identityId,
        input.actor.subjectNs,
      );
    } catch (error) {
      this.deps.logger?.error(
        {
          err: error,
          diaryId: input.diaryId,
          identityId: input.actor.identityId,
          packCount: packs.length,
        },
        'Failed to check pack read permissions',
      );
      throw new PackServiceError(
        'Failed to check pack read permissions',
        'internal',
      );
    }
    const visible = packs.filter((p) => allowed.get(p.id) ?? false);
    // Best-effort lower bound: packs on other pages may also be denied.
    const adjustedTotal = total - (packs.length - visible.length);

    if (!input.expandEntries) {
      return { items: visible, total: adjustedTotal, limit, offset };
    }

    const entriesByPack =
      await this.deps.contextPackRepository.listEntriesExpandedByPackIds(
        visible.map((p) => p.id),
      );
    const items: PackWithOptionalEntries[] = visible.map((p) => ({
      ...p,
      entries: entriesByPack.get(p.id) ?? [],
    }));
    return { items, total: adjustedTotal, limit, offset };
  }

  async getLatestRenderedPack(input: GetLatestRenderedPackInput) {
    const sourcePack = await this.deps.contextPackRepository.findById(
      input.sourcePackId,
    );
    if (!sourcePack) {
      throw new PackServiceError('Source pack not found', 'not_found');
    }
    await this.assertCanReadPack(sourcePack.id, input.actor);

    const rendered =
      await this.deps.renderedPackRepository.findLatestBySourcePackId(
        sourcePack.id,
      );
    if (!rendered) {
      throw new PackServiceError(
        'No rendered pack found for this source pack',
        'not_found',
      );
    }
    return rendered;
  }

  async getRenderedPackById(input: GetRenderedPackByIdInput) {
    const rendered = await this.deps.renderedPackRepository.findById(
      input.renderedPackId,
    );
    if (!rendered) {
      throw new PackServiceError('Rendered pack not found', 'not_found');
    }
    try {
      await this.assertCanReadPack(rendered.sourcePackId, input.actor);
    } catch (error) {
      if (error instanceof PackServiceError && error.code === 'forbidden') {
        throw new PackServiceError(
          'Not authorized to read this rendered pack',
          'forbidden',
        );
      }
      throw error;
    }
    return rendered;
  }

  async listRenderedPacksByDiary(
    input: ListRenderedPacksByDiaryInput,
  ): Promise<ListRenderedPacksByDiaryResult> {
    const limit = input.limit ?? 20;
    const offset = input.offset ?? 0;

    await this.deps.assertDiaryReadable(
      input.diaryId,
      input.actor.identityId,
      input.actor.subjectNs,
    );

    const { items, total } = await this.deps.renderedPackRepository.listByDiary(
      input.diaryId,
      limit,
      offset,
      {
        sourcePackId: input.sourcePackId,
        renderMethod: input.renderMethod,
      },
    );

    const sourcePackIds = [...new Set(items.map((rp) => rp.sourcePackId))];
    let allowed: Map<string, boolean>;
    try {
      allowed = await this.deps.permissionChecker.canReadPacks(
        sourcePackIds,
        input.actor.identityId,
        input.actor.subjectNs,
      );
    } catch (error) {
      this.deps.logger?.error(
        {
          err: error,
          diaryId: input.diaryId,
          identityId: input.actor.identityId,
          sourcePackIdCount: sourcePackIds.length,
        },
        'Failed to check rendered pack read permissions',
      );
      throw new PackServiceError(
        'Failed to check rendered pack read permissions',
        'internal',
      );
    }
    const visible = items.filter((rp) => allowed.get(rp.sourcePackId) ?? false);
    const adjustedTotal = total - (items.length - visible.length);
    return { items: visible, total: adjustedTotal, limit, offset };
  }

  private async assertCanReadPack(
    packId: string,
    actor: PackActor,
  ): Promise<void> {
    const allowed = await this.deps.permissionChecker.canReadPack(
      packId,
      actor.identityId,
      actor.subjectNs,
    );
    if (!allowed) {
      throw new PackServiceError(
        'Not authorized to read this pack',
        'forbidden',
      );
    }
  }

  async createCustomPack(
    input: CreateCustomPackInput,
  ): Promise<CustomPackResult> {
    const selectedEntries = await loadSelectedEntries(
      this.deps.entryFetcher,
      input.diaryId,
      input.entries,
    );
    const fitResult = fitEntries(selectedEntries, input.tokenBudget);

    const createdAt = new Date();
    const packEntryRefs: PackEntryRef[] = fitResult.entries.map((e) => ({
      cid: e.entryCidSnapshot,
      compressionLevel: e.compressionLevel,
      rank: e.rank,
    }));
    const packCid = computePackCid({
      diaryId: input.diaryId,
      packType: 'custom',
      params: input.params,
      entries: packEntryRefs,
    });

    // Idempotency: return existing if CID matches
    const existing = await this.deps.contextPackRepository.findByCid(packCid);
    if (existing) {
      return {
        id: existing.id,
        packCid: existing.packCid,
        packType: 'custom',
        params: input.params,
        fitResult,
        persisted: true,
      };
    }

    const pinned = input.pinned ?? false;
    const expiresAt = pinned
      ? null
      : new Date(
          createdAt.getTime() +
            (input.ttlDays ?? this.deps.ttlDays) * 24 * 60 * 60 * 1000,
        );

    const payload = {
      v: 'moltnet:pack:v1',
      diaryId: input.diaryId,
      createdBy: input.createdBy,
      createdAt: createdAt.toISOString(),
      packType: 'custom',
      params: input.params,
      entries: packEntryRefs,
    };

    const pack = await this.deps.runTransaction(async () => {
      const p = await this.deps.contextPackRepository.createPack({
        diaryId: input.diaryId,
        packCid,
        packType: 'custom',
        params: input.params,
        payload,
        createdBy: input.createdBy,
        pinned,
        expiresAt,
        createdAt,
      });

      await this.deps.contextPackRepository.addEntries(
        fitResult.entries.map((e) => ({
          packId: p.id,
          entryId: e.entryId,
          entryCidSnapshot: e.entryCidSnapshot,
          compressionLevel: e.compressionLevel,
          originalTokens: e.originalTokens,
          packedTokens: e.packedTokens,
          rank: e.rank,
        })),
      );

      return p;
    });

    await this.grantPackParentWithCleanup(pack.id, input.diaryId);

    return {
      id: pack.id,
      packCid: pack.packCid,
      packType: 'custom',
      params: input.params,
      fitResult,
      persisted: true,
    };
  }

  async createRenderedPack(
    input: CreateRenderedPackInput,
  ): Promise<RenderedPackResult> {
    const sourcePack = await this.deps.contextPackRepository.findById(
      input.sourcePackId,
    );
    if (!sourcePack) {
      throw new PackServiceError(
        `Source pack ${input.sourcePackId} not found`,
        'not_found',
      );
    }

    const renderedMarkdown = await this.resolveRenderedMarkdown(
      sourcePack.id,
      sourcePack.createdAt,
      input.renderMethod,
      input.renderedMarkdown,
    );
    const contentHash = computeContentHash(renderedMarkdown);
    const packCid = computeRenderedPackCid({
      sourcePackCid: sourcePack.packCid,
      renderMethod: input.renderMethod,
      contentHash,
    });

    // Idempotency: return existing if CID matches (use stored values)
    const existing = await this.deps.renderedPackRepository.findByCid(packCid);
    if (existing) {
      return {
        id: existing.id,
        packCid: existing.packCid,
        sourcePackId: input.sourcePackId,
        sourcePackCid: sourcePack.packCid,
        diaryId: sourcePack.diaryId,
        contentHash,
        renderMethod: input.renderMethod,
        renderedMarkdown,
        totalTokens: existing.totalTokens,
        pinned: existing.pinned,
      };
    }

    const totalTokens = estimateTokens(renderedMarkdown);
    const pinned = input.pinned ?? false;
    const createdAt = new Date();
    const expiresAt = pinned
      ? null
      : new Date(
          createdAt.getTime() +
            (input.ttlDays ?? this.deps.ttlDays) * 24 * 60 * 60 * 1000,
        );

    let rendered;
    try {
      rendered = await this.deps.renderedPackRepository.create({
        packCid,
        sourcePackId: input.sourcePackId,
        diaryId: sourcePack.diaryId,
        content: renderedMarkdown,
        contentHash,
        renderMethod: input.renderMethod,
        totalTokens,
        createdBy: input.createdBy,
        pinned,
        expiresAt,
        createdAt,
      });
    } catch (err) {
      // Handle race condition: concurrent insert with same CID
      const raced = await this.deps.renderedPackRepository.findByCid(packCid);
      if (raced) {
        return {
          id: raced.id,
          packCid: raced.packCid,
          sourcePackId: input.sourcePackId,
          sourcePackCid: sourcePack.packCid,
          diaryId: sourcePack.diaryId,
          contentHash,
          renderMethod: input.renderMethod,
          renderedMarkdown,
          totalTokens: raced.totalTokens,
          pinned: raced.pinned,
        };
      }
      throw err;
    }

    return {
      id: rendered.id,
      packCid: rendered.packCid,
      sourcePackId: rendered.sourcePackId,
      sourcePackCid: sourcePack.packCid,
      diaryId: rendered.diaryId,
      contentHash: rendered.contentHash,
      renderMethod: rendered.renderMethod,
      renderedMarkdown,
      totalTokens: rendered.totalTokens,
      pinned: rendered.pinned,
    };
  }

  async previewRenderedPack(
    input: PreviewRenderedPackInput,
  ): Promise<RenderedPackPreview> {
    const sourcePack = await this.deps.contextPackRepository.findById(
      input.sourcePackId,
    );
    if (!sourcePack) {
      throw new PackServiceError(
        `Source pack ${input.sourcePackId} not found`,
        'not_found',
      );
    }

    const renderedMarkdown = await this.resolveRenderedMarkdown(
      sourcePack.id,
      sourcePack.createdAt,
      input.renderMethod,
      input.renderedMarkdown,
    );

    return {
      sourcePackId: sourcePack.id,
      sourcePackCid: sourcePack.packCid,
      renderMethod: input.renderMethod,
      renderedMarkdown,
      totalTokens: estimateTokens(renderedMarkdown),
    };
  }

  private async resolveRenderedMarkdown(
    sourcePackId: string,
    createdAt: Date,
    renderMethod: string,
    renderedMarkdown?: string,
  ): Promise<string> {
    if (renderMethod.startsWith('server:')) {
      if (renderedMarkdown !== undefined) {
        throw new PackServiceError(
          'renderedMarkdown must not be provided for server render methods',
          'validation',
        );
      }

      const entries =
        await this.deps.contextPackRepository.listEntriesExpanded(sourcePackId);

      return renderPackToMarkdown({
        packId: sourcePackId,
        createdAt: createdAt.toISOString(),
        entries,
      });
    }

    if (renderedMarkdown === undefined) {
      throw new PackServiceError(
        'renderedMarkdown is required for non-server render methods',
        'validation',
      );
    }

    return renderedMarkdown;
  }

  /**
   * Grant Keto ContextPack#parent@Diary relation with cleanup on failure.
   * If granting fails, remove any partial Keto relations and delete the pack
   * to avoid orphaned rows.
   */
  private async grantPackParentWithCleanup(
    packId: string,
    diaryId: string,
  ): Promise<void> {
    try {
      await this.deps.grantPackParent(packId, diaryId);
    } catch (error) {
      this.deps.logger?.error(
        { err: error, packId, diaryId },
        'Failed to grant ContextPack#parent relation',
      );

      try {
        await this.deps.removePackRelations(packId);
        await this.deps.deleteMany([packId]);
      } catch (cleanupError) {
        this.deps.logger?.error(
          { err: cleanupError, packId, diaryId },
          'Failed to clean up pack after authorization grant failure',
        );
      }

      throw new PackServiceError(
        'Failed to finalize pack authorization',
        'internal',
      );
    }
  }
}
