import { estimateTokens } from '@moltnet/context-distill';
import {
  computeContentHash,
  computePackCid,
  computeRenderedPackCid,
  type PackEntryRef,
} from '@moltnet/crypto-service';
import type {
  ContextPackRepository,
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
    | 'listByDiary'
    | 'listEntriesExpanded'
  >;
  renderedPackRepository: Pick<
    RenderedPackRepository,
    'create' | 'findByCid' | 'findLatestBySourcePackId'
  >;
  entryFetcher: EntryFetcher;
  runTransaction: <T>(fn: () => Promise<T>) => Promise<T>;
  grantPackParent: (packId: string, diaryId: string) => Promise<void>;
  removePackRelations: (packId: string) => Promise<void>;
  deleteMany: (ids: string[]) => Promise<number>;
  logger?: { error: (obj: Record<string, unknown>, msg: string) => void };
  ttlDays: number;
}

export class PackServiceError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_found' | 'conflict' | 'validation' | 'internal',
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

      const entries = await this.deps.contextPackRepository.listEntriesExpanded(
        sourcePackId,
      );

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
