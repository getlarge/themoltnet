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
  DBOS,
  type DiaryEntryRepository,
  WorkflowQueue,
} from '@moltnet/database';
import type { EmbeddingService } from '@moltnet/embedding-service';

import type { Logger } from './logger.js';

// ── Queues ─────────────────────────────────────────────────────

export const consolidateQueue = new WorkflowQueue('context.consolidate', {
  concurrency: 1,
  partitionQueue: true,
});

export const compileQueue = new WorkflowQueue('context.compile', {
  concurrency: 5,
  partitionQueue: true,
});

// ── Types ──────────────────────────────────────────────────────

export interface ContextDistillDeps {
  diaryEntryRepository: DiaryEntryRepository;
  embeddingService: EmbeddingService;
  logger: Logger;
}

export interface ConsolidateWorkflowInput {
  diaryId: string;
  identityId: string;
  entryIds?: string[];
  tags?: string[];
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
) => Promise<CompileResult>;

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
      limit: number,
    ) => {
      const { diaryEntryRepository } = getDeps();
      if (entryIds && entryIds.length > 0) {
        return diaryEntryRepository.list({
          ids: entryIds,
          limit: Math.min(entryIds.length, 500),
        });
      }
      return diaryEntryRepository.list({
        diaryId,
        tags,
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
      tags: string[] | undefined,
      wRecency: number,
      wImportance: number,
      limit: number,
    ) => {
      const { diaryEntryRepository } = getDeps();
      return diaryEntryRepository.search({
        diaryId,
        tags,
        wRecency,
        wImportance,
        limit,
        excludeSuperseded: true,
      });
    },
    { name: 'context-distill.step.searchEntries' },
  );

  // ── Workflows ──────────────────────────────────────────────

  const consolidateWorkflow = DBOS.registerWorkflow(
    async (input: ConsolidateWorkflowInput) => {
      const entries = await fetchEntriesStep(
        input.diaryId,
        input.entryIds,
        input.tags,
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
    async (input: CompileWorkflowInput) => {
      const taskPromptEmbedding = input.taskPrompt
        ? await embedQueryStep(input.taskPrompt)
        : undefined;

      const limit = input.limit ?? 200;
      const entries = await searchEntriesStep(
        input.diaryId,
        input.includeTags,
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

      return compile(distillEntries, {
        tokenBudget: input.tokenBudget,
        taskPromptEmbedding: taskPromptEmbedding?.length
          ? taskPromptEmbedding
          : undefined,
        lambda: input.lambda,
      });
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
    return _workflows.consolidate.bind(undefined);
  },
  get compile() {
    if (!_workflows)
      throw new Error(
        'Context distill workflows not initialized. Call initContextDistillWorkflows() after configureDBOS().',
      );
    return _workflows.compile.bind(undefined);
  },
};
