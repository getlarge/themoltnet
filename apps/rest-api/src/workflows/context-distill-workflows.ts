/**
 * Context Distill DBOS Workflows
 *
 * consolidateWorkflow: fetch entries + embeddings → cluster() + select() → ConsolidateResult
 * compileWorkflow:     embed query → search entries → fetch embeddings → compile() → CompileResult
 *
 * Both workflows use WorkflowQueue with partitionQueue:true for per-agent concurrency.
 * deduplicationID ensures same input returns cached result without re-running computation.
 *
 * ## Initialization Order
 *
 * Call initContextDistillWorkflows() AFTER configureDBOS() and BEFORE launchDBOS().
 * Call setContextDistillDeps() before any workflow is invoked.
 */

import type { RelationshipWriter } from '@moltnet/auth';
import {
  compile,
  type CompileOptions,
  type CompileResult,
  consolidate,
  type ConsolidateOptions,
  type ConsolidateResult,
  estimateTokens,
} from '@moltnet/context-distill';
import {
  type CompileParams,
  computePackCid,
  type PackEntryRef,
} from '@moltnet/crypto-service';
import {
  type ContextPack,
  type ContextPackEntry,
  type ContextPackRepository,
  type DataSource,
  DBOS,
  type DiaryEntryRepository,
  type NewContextPack,
  type NewContextPackEntry,
  WorkflowQueue,
} from '@moltnet/database';
import type { EmbeddingService } from '@moltnet/embedding-service';

import type { Logger } from './logger.js';

const KETO_RETRY = {
  retriesAllowed: true,
  maxAttempts: 5,
  intervalSeconds: 2,
  backoffRate: 2,
} as const;

// ── Queues ─────────────────────────────────────────────────────

export const consolidateQueue = new WorkflowQueue('context.consolidate', {
  concurrency: 1,
  partitionQueue: true,
});

export const compileQueue = new WorkflowQueue('context.compile', {
  concurrency: 5,
  partitionQueue: true,
});

// ── Errors ─────────────────────────────────────────────────────

export class CompileWorkflowError extends Error {
  constructor(
    public readonly code: 'missing_content_hash' | 'no_entries',
    message: string,
  ) {
    super(message);
    this.name = 'CompileWorkflowError';
  }
}

// ── Types ──────────────────────────────────────────────────────

export interface ContextDistillDeps {
  diaryEntryRepository: DiaryEntryRepository;
  contextPackRepository: ContextPackRepository;
  dataSource: DataSource;
  relationshipWriter: RelationshipWriter;
  embeddingService: EmbeddingService;
  logger: Logger;
}

/** Compile workflow output: the persisted pack + its entries + compile stats. */
export interface CompileWorkflowResult {
  pack: ContextPack;
  packEntries: ContextPackEntry[];
  compileResult: CompileResult;
}

export interface ConsolidateWorkflowInput {
  diaryId: string;
  identityId: string;
  entryIds?: string[];
  tags?: string[];
  excludeTags?: string[];
  threshold?: number;
  strategy?: ConsolidateOptions['strategy'];
}

export interface CompileWorkflowInput {
  diaryId: string;
  identityId: string;
  taskPrompt?: string;
  tokenBudget: number;
  lambda?: CompileOptions['lambda'];
  includeTags?: string[];
  excludeTags?: string[];
  wRecency?: number;
  wImportance?: number;
  limit?: number;
}

// ── Dependency Injection ───────────────────────────────────────

let deps: ContextDistillDeps | null = null;

export function setContextDistillDeps(d: ContextDistillDeps): void {
  deps = d;
}

function getDeps(): ContextDistillDeps {
  if (!deps)
    throw new Error(
      'Context distill deps not set. Call setContextDistillDeps() first.',
    );
  return deps;
}

// ── Lazy Registration ──────────────────────────────────────────

type ConsolidateWorkflowFn = (
  input: ConsolidateWorkflowInput,
) => Promise<ConsolidateResult & { workflowId: string }>;

type CompileWorkflowFn = (
  input: CompileWorkflowInput,
) => Promise<CompileWorkflowResult>;

let _workflows: {
  consolidate: ConsolidateWorkflowFn;
  compile: CompileWorkflowFn;
} | null = null;

export function initContextDistillWorkflows(): void {
  if (_workflows) return;

  // ── Steps ──────────────────────────────────────────────────

  const fetchEntriesStep = DBOS.registerStep(
    async (
      diaryId: string,
      entryIds: string[] | undefined,
      tags: string[] | undefined,
      excludeTags: string[] | undefined,
      limit: number,
    ) => {
      const { diaryEntryRepository } = getDeps();
      if (entryIds && entryIds.length > 0) {
        // Always pass diaryId to scope entries to the caller's diary.
        // Prevents cross-diary entry access via user-supplied entryIds.
        return diaryEntryRepository.list({
          ids: entryIds,
          diaryId,
          excludeTags,
          limit: Math.min(entryIds.length, 500),
        });
      }
      return diaryEntryRepository.list({
        diaryId,
        tags,
        excludeTags,
        limit,
        excludeSuperseded: true,
      });
    },
    { name: 'context-distill.step.fetchEntries' },
  );

  const fetchEmbeddingsStep = DBOS.registerStep(
    async (ids: string[]) => {
      const { diaryEntryRepository } = getDeps();
      return diaryEntryRepository.fetchEmbeddings(ids);
    },
    { name: 'context-distill.step.fetchEmbeddings' },
  );

  const embedQueryStep = DBOS.registerStep(
    async (query: string): Promise<number[]> => {
      const { embeddingService, logger } = getDeps();
      try {
        return await embeddingService.embedQuery(query);
      } catch (error) {
        logger.error(
          { err: error, query },
          'context-distill: failed to embed query for compile workflow',
        );
        return [];
      }
    },
    { name: 'context-distill.step.embedQuery' },
  );

  const searchEntriesStep = DBOS.registerStep(
    async (
      diaryId: string,
      query: string | undefined,
      embedding: number[] | undefined,
      tags: string[] | undefined,
      excludeTags: string[] | undefined,
      wRecency: number,
      wImportance: number,
      limit: number,
    ) => {
      const { diaryEntryRepository } = getDeps();
      return diaryEntryRepository.search({
        diaryId,
        query,
        embedding,
        tags,
        excludeTags,
        wRecency,
        wImportance,
        limit,
        excludeSuperseded: true,
      });
    },
    { name: 'context-distill.step.searchEntries' },
  );

  /**
   * Persist a compile pack + its entry membership atomically.
   * Uses DBOS dataSource.runTransaction so if entry insertion fails,
   * the pack row is rolled back.
   */
  const persistCompilePackStep = DBOS.registerStep(
    async (
      packInput: NewContextPack,
      entryInputs: NewContextPackEntry[],
    ): Promise<{ pack: ContextPack; packEntries: ContextPackEntry[] }> => {
      const { contextPackRepository, dataSource } = getDeps();

      return dataSource.runTransaction(
        async () => {
          const pack = await contextPackRepository.createPack(packInput);
          const packEntries = await contextPackRepository.addEntries(
            entryInputs.map((e) => ({ ...e, packId: pack.id })),
          );
          return { pack, packEntries };
        },
        { name: 'context-distill.tx.persistCompilePack' },
      );
    },
    { name: 'context-distill.step.persistCompilePack' },
  );

  /** Write Keto relationship: ContextPack:{packId}#parent@Diary:{diaryId} */
  const grantPackParentStep = DBOS.registerStep(
    async (packId: string, diaryId: string): Promise<void> => {
      const { relationshipWriter } = getDeps();
      await relationshipWriter.grantPackParent(packId, diaryId);
    },
    { name: 'context-distill.step.grantPackParent', ...KETO_RETRY },
  );

  // ── Workflows ──────────────────────────────────────────────

  const consolidateWorkflow = DBOS.registerWorkflow(
    async (input: ConsolidateWorkflowInput) => {
      const entries = await fetchEntriesStep(
        input.diaryId,
        input.entryIds,
        input.tags,
        input.excludeTags,
        500,
      );
      if (entries.length === 0) {
        return {
          workflowId: DBOS.workflowID ?? '',
          clusters: [],
          stats: {
            inputCount: 0,
            clusterCount: 0,
            singletonRate: 0,
            clusterSizeDistribution: [0, 0, 0, 0, 0] as [
              number,
              number,
              number,
              number,
              number,
            ],
            elapsedMs: 0,
          },
          trace: {
            thresholdUsed: input.threshold ?? 0.15,
            strategyUsed: (input.strategy ?? 'hybrid') as
              | 'score'
              | 'centroid'
              | 'hybrid',
            embeddingDim: 0,
          },
        } satisfies ConsolidateResult & { workflowId: string };
      }

      const ids = entries.map((e) => e.id);
      const embeddingRows = await fetchEmbeddingsStep(ids);
      const embeddingMap = new Map(
        embeddingRows.map((r) => [r.id, r.embedding]),
      );

      const distillEntries = entries
        .filter((e) => embeddingMap.has(e.id))
        .map((e) => ({
          id: e.id,
          embedding: embeddingMap.get(e.id)!,
          content: e.content,
          tokens: estimateTokens(e.content),
          importance: e.importance,
          createdAt:
            e.createdAt instanceof Date
              ? e.createdAt.toISOString()
              : e.createdAt,
        }));

      const result = consolidate(distillEntries, {
        threshold: input.threshold,
        strategy: input.strategy,
      });

      return { workflowId: DBOS.workflowID ?? '', ...result };
    },
    { name: 'context.consolidate' },
  );

  const compileWorkflow = DBOS.registerWorkflow(
    async (input: CompileWorkflowInput): Promise<CompileWorkflowResult> => {
      const taskPromptEmbedding = input.taskPrompt
        ? await embedQueryStep(input.taskPrompt)
        : undefined;

      const limit = input.limit ?? 200;
      const entries = await searchEntriesStep(
        input.diaryId,
        input.taskPrompt,
        taskPromptEmbedding?.length ? taskPromptEmbedding : undefined,
        input.includeTags,
        input.excludeTags,
        input.wRecency ?? 0,
        input.wImportance ?? 0,
        limit,
      );
      const ids = entries.map((e) => e.id);
      const embeddingRows =
        ids.length > 0 ? await fetchEmbeddingsStep(ids) : [];
      const embeddingMap = new Map(
        embeddingRows.map((r) => [r.id, r.embedding]),
      );

      const distillEntries = entries
        .filter((e) => embeddingMap.has(e.id))
        .map((e) => ({
          id: e.id,
          embedding: embeddingMap.get(e.id)!,
          content: e.content,
          tokens: estimateTokens(e.content),
          importance: e.importance,
          createdAt:
            e.createdAt instanceof Date
              ? e.createdAt.toISOString()
              : e.createdAt,
        }));

      const compileResult = compile(distillEntries, {
        tokenBudget: input.tokenBudget,
        taskPromptEmbedding: taskPromptEmbedding?.length
          ? taskPromptEmbedding
          : undefined,
        lambda: input.lambda,
      });

      // Validate CIDs before entering the persist step (data integrity,
      // not retryable). The step itself only does DB writes (retryable).
      const compiledIds = new Set(compileResult.entries.map((ce) => ce.id));
      const sourceEntryHashes = entries
        .filter((e) => compiledIds.has(e.id))
        .map((e) => ({
          id: e.id,
          contentHash: e.contentHash,
        }));

      for (const entry of sourceEntryHashes) {
        if (!entry.contentHash) {
          throw new CompileWorkflowError(
            'missing_content_hash',
            `Entry ${entry.id} has no contentHash. Run the backfill script (tools/db/backfill-content-hashes.ts).`,
          );
        }
      }

      // Build pack CID and inputs (pure computation, no DB)
      const hashMap = new Map(
        sourceEntryHashes.map((e) => [e.id, e.contentHash]),
      );
      const createdAt = new Date().toISOString();
      const params: CompileParams = {
        tokenBudget: input.tokenBudget,
        lambda: input.lambda,
        taskPromptHash: compileResult.trace.taskPromptHash,
        wRecency: input.wRecency,
        wImportance: input.wImportance,
      };
      const packEntryRefs: PackEntryRef[] = compileResult.entries.map(
        (compiled, index) => ({
          cid: hashMap.get(compiled.id) ?? '',
          compressionLevel:
            compiled.compressionLevel as PackEntryRef['compressionLevel'],
          rank: index + 1,
        }),
      );
      const packCid = computePackCid({
        diaryId: input.diaryId,
        createdBy: input.identityId,
        createdAt,
        packType: 'compile',
        params,
        entries: packEntryRefs,
      });

      const createdAtDate = new Date(createdAt);
      const packInput: NewContextPack = {
        diaryId: input.diaryId,
        createdBy: input.identityId,
        packCid,
        packType: 'compile',
        params,
        payload: {
          v: 'moltnet:pack:v1',
          diaryId: input.diaryId,
          createdBy: input.identityId,
          createdAt,
          packType: 'compile',
          params,
          entries: packEntryRefs,
        },
        createdAt: createdAtDate,
        pinned: false,
        expiresAt: new Date(createdAtDate.getTime() + 7 * 24 * 60 * 60 * 1000),
      };

      const entryInputs: NewContextPackEntry[] = compileResult.entries.map(
        (compiled, index) => ({
          packId: '', // filled by the step after pack creation
          entryId: compiled.id,
          entryCidSnapshot: hashMap.get(compiled.id) ?? '',
          compressionLevel:
            compiled.compressionLevel as PackEntryRef['compressionLevel'],
          originalTokens: compiled.originalTokens,
          packedTokens: compiled.compressedTokens,
          rank: index + 1,
        }),
      );

      // Persist atomically (pack + entries in one transaction)
      const { pack, packEntries } = await persistCompilePackStep(
        packInput,
        entryInputs,
      );

      // Wire Keto authorization: ContextPack#parent@Diary
      await grantPackParentStep(pack.id, input.diaryId);

      return { pack, packEntries, compileResult };
    },
    { name: 'context.compile' },
  );

  _workflows = { consolidate: consolidateWorkflow, compile: compileWorkflow };
}

// ── Exported Collection ────────────────────────────────────────

export const contextDistillWorkflows = {
  get consolidate() {
    if (!_workflows)
      throw new Error(
        'Context distill workflows not initialized. Call initContextDistillWorkflows() after configureDBOS().',
      );
    return _workflows.consolidate;
  },
  get compile() {
    if (!_workflows)
      throw new Error(
        'Context distill workflows not initialized. Call initContextDistillWorkflows() after configureDBOS().',
      );
    return _workflows.compile;
  },
};
