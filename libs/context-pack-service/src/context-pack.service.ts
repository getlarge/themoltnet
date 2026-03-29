import { estimateTokens } from '@moltnet/context-distill';
import {
  computePackCid,
  type PackEntryRef,
  type RenderedParams,
} from '@moltnet/crypto-service';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';

import { fitEntries } from './entry-fitter.js';
import type { EntryFetcher } from './entry-loader.js';
import { loadSelectedEntries } from './entry-loader.js';
import type {
  CreateCustomPackInput,
  CreateRenderedPackInput,
  FitResult,
  RenderedPackResult,
} from './types.js';

export interface ContextPackServiceDeps {
  contextPackRepository: {
    createPack: (
      input: Record<string, unknown>,
    ) => Promise<{ id: string; packCid: string }>;
    addEntries: (entries: Array<Record<string, unknown>>) => Promise<unknown[]>;
    findById: (id: string) => Promise<{
      id: string;
      diaryId: string;
      packCid: string;
      packType: string;
      params: unknown;
      payload: unknown;
      createdBy: string;
      sourcePackId: string | null;
    } | null>;
    findByCid: (cid: string) => Promise<{ id: string; packCid: string } | null>;
    findRenderedBySourcePackId: (
      sourcePackId: string,
    ) => Promise<{ id: string; packCid: string } | null>;
    clearSourcePackId: (packId: string) => Promise<void>;
    listByDiary: (
      diaryId: string,
      limit?: number,
    ) => Promise<{ items: unknown[]; total: number }>;
    listEntriesExpanded: (packId: string) => Promise<
      Array<{
        entryId: string;
        entryCidSnapshot: string;
        compressionLevel: string;
        originalTokens: number | null;
        packedTokens: number | null;
        rank: number | null;
      }>
    >;
  };
  entryFetcher: EntryFetcher;
  runTransaction: <T>(fn: () => Promise<T>) => Promise<T>;
  grantPackParent: (packId: string, diaryId: string) => Promise<void>;
  ttlDays: number;
}

export class PackServiceError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_found' | 'conflict' | 'validation',
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

    await this.deps.grantPackParent(pack.id, input.diaryId);

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

    // Check for existing rendered pack for this source.
    // The partial unique index enforces at most one rendered pack per
    // source. If one exists, we deactivate it (set sourcePackId = null)
    // before creating the new one.
    const existingRendered =
      await this.deps.contextPackRepository.findRenderedBySourcePackId(
        input.sourcePackId,
      );

    const sourceEntries =
      await this.deps.contextPackRepository.listEntriesExpanded(
        input.sourcePackId,
      );

    const contentHash = bytesToHex(
      sha256(new TextEncoder().encode(input.renderedMarkdown)),
    );

    const renderedParams: RenderedParams = {
      sourcePackCid: sourcePack.packCid,
      renderMethod: input.renderMethod,
      contentHash,
    };

    const packEntryRefs: PackEntryRef[] = sourceEntries.map((e) => ({
      cid: e.entryCidSnapshot,
      compressionLevel: e.compressionLevel as PackEntryRef['compressionLevel'],
      rank: e.rank ?? 0,
    }));

    const packCid = computePackCid({
      diaryId: sourcePack.diaryId,
      packType: 'rendered',
      params: renderedParams,
      entries: packEntryRefs,
    });

    // Idempotency
    const existing = await this.deps.contextPackRepository.findByCid(packCid);
    if (existing) {
      return {
        id: existing.id,
        packCid: existing.packCid,
        sourcePackId: input.sourcePackId,
        sourcePackCid: sourcePack.packCid,
        renderMethod: input.renderMethod,
        totalTokens: estimateTokens(input.renderedMarkdown),
      };
    }

    const createdAt = new Date();
    const pinned = input.pinned ?? false;
    const expiresAt = pinned
      ? null
      : new Date(
          createdAt.getTime() +
            (input.ttlDays ?? this.deps.ttlDays) * 24 * 60 * 60 * 1000,
        );

    const payload = {
      v: 'moltnet:pack:v1',
      diaryId: sourcePack.diaryId,
      createdBy: input.createdBy,
      createdAt: createdAt.toISOString(),
      packType: 'rendered',
      params: renderedParams,
      entries: packEntryRefs,
      markdown: input.renderedMarkdown,
    };

    const pack = await this.deps.runTransaction(async () => {
      // Detach old rendered pack from source (clears sourcePackId so
      // unique index allows new one)
      if (existingRendered) {
        await this.deps.contextPackRepository.clearSourcePackId(
          existingRendered.id,
        );
      }

      const p = await this.deps.contextPackRepository.createPack({
        diaryId: sourcePack.diaryId,
        packCid,
        packType: 'rendered',
        params: renderedParams,
        payload,
        createdBy: input.createdBy,
        sourcePackId: input.sourcePackId,
        pinned,
        expiresAt,
        createdAt,
      });

      await this.deps.contextPackRepository.addEntries(
        sourceEntries.map((e) => ({
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

    await this.deps.grantPackParent(pack.id, sourcePack.diaryId);

    return {
      id: pack.id,
      packCid: pack.packCid,
      sourcePackId: input.sourcePackId,
      sourcePackCid: sourcePack.packCid,
      renderMethod: input.renderMethod,
      totalTokens: estimateTokens(input.renderedMarkdown),
    };
  }
}
