/**
 * Diary Durable Workflows
 *
 * DBOS workflows for diary CRUD operations. Each write operation
 * (create, update, delete, share) is a workflow with discrete steps
 * and compensation where needed.
 *
 * Replaces the fire-and-forget pattern where Keto operations ran
 * outside transactions with no compensation on failure.
 *
 * ## Initialization Order
 *
 * Workflows are registered lazily on first access via `initDiaryWorkflows()`.
 * This allows the module to be imported before DBOS is configured.
 * The Fastify DBOS plugin calls `initDiaryWorkflows()` after `configureDBOS()`.
 */

import { type RelationshipWriter } from '@moltnet/auth';
import {
  DBOS,
  type DiaryEntryRepository,
  type TransactionRunner,
} from '@moltnet/database';
import type { EmbeddingService } from '@moltnet/embedding-service';

import { scanForInjection, type ScanResult } from '../injection-scanner.js';
import type {
  DiaryEntry,
  UpdateEntryInput,
  WorkflowCreateEntryInput,
} from '../types.js';

// ── Private Helpers ────────────────────────────────────────────

/**
 * Build the text sent to the embedding model.
 * Mirrors `buildEmbeddingText` from diary-service to avoid circular imports.
 */
function buildEmbeddingTextLocal(
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

// ── Types ──────────────────────────────────────────────────────

export interface DiaryWorkflowDeps {
  diaryEntryRepository: DiaryEntryRepository;
  relationshipWriter: RelationshipWriter;
  embeddingService: EmbeddingService;
  transactionRunner: TransactionRunner;
}

// ── Dependency Injection ───────────────────────────────────────

let deps: DiaryWorkflowDeps | null = null;

export function setDiaryWorkflowDeps(d: DiaryWorkflowDeps): void {
  deps = d;
}

function getDeps(): DiaryWorkflowDeps {
  if (!deps) {
    throw new Error(
      'Diary workflow deps not set. Call setDiaryWorkflowDeps() ' +
        'before using diary workflows.',
    );
  }
  return deps;
}

// ── Retry Configuration ────────────────────────────────────────

export const DIARY_EMBEDDING_QUEUE = 'diary-embeddings';

/** Persist after DBOS launch and before accepting requests. */
export async function registerDiaryEmbeddingQueue(
  concurrency = 1,
): Promise<void> {
  await DBOS.registerQueue(DIARY_EMBEDDING_QUEUE, {
    concurrency,
    // Sub-second inference must not leave the pool idle for the default 1s poll.
    minPollingIntervalMs: 50,
    onConflict: 'update_if_latest_version',
  });
}

type EmbeddingInput = Pick<DiaryEntry, 'id' | 'content' | 'title' | 'tags'>;

const KETO_RETRY = {
  retriesAllowed: true,
  maxAttempts: 5,
  intervalSeconds: 2,
  backoffRate: 2,
} as const;

// ── Lazy Registration ──────────────────────────────────────────

type CreateEntryFn = (input: WorkflowCreateEntryInput) => Promise<DiaryEntry>;
type UpdateEntryFn = (
  id: string,
  updates: UpdateEntryInput,
  existingContent?: string,
  existingTitle?: string | null,
  existingTags?: string[] | null,
) => Promise<DiaryEntry | null>;
type DeleteEntryFn = (id: string) => Promise<boolean>;

let _workflows: {
  createEntry: CreateEntryFn;
  updateEntry: UpdateEntryFn;
  deleteEntry: DeleteEntryFn;
} | null = null;

/**
 * Initialize and register diary workflows with DBOS.
 *
 * Must be called AFTER configureDBOS() and BEFORE launchDBOS().
 * Idempotent - safe to call multiple times.
 */
export function initDiaryWorkflows(): void {
  if (_workflows) return;

  // ── Steps ──────────────────────────────────────────────────

  const generateIdStep = DBOS.registerStep(
    async (): Promise<string> => {
      return Promise.resolve(crypto.randomUUID());
    },
    { name: 'diary.step.generateId' },
  );

  const embedPassageStep = DBOS.registerStep(
    async (content: string): Promise<number[]> => {
      const vector = await getDeps().embeddingService.embedPassage(content);
      if (vector.length !== 384 || !vector.every(Number.isFinite)) {
        throw new Error('Embedding must contain 384 finite dimensions');
      }
      return vector;
    },
    { name: 'diary.step.embedPassage' },
  );

  const scanInjectionStep = DBOS.registerStep(
    async (content: string, title?: string | null): Promise<ScanResult> => {
      return Promise.resolve(scanForInjection(content, title));
    },
    { name: 'diary.step.scanInjection' },
  );

  const grantEntryParentStep = DBOS.registerStep(
    async (entryId: string, diaryId: string): Promise<void> => {
      const { relationshipWriter } = getDeps();
      // Deferred proposal: derive DiaryEntry containment from the immutable
      // diary_entries.diary_id FK and authorize its parent Diary directly,
      // instead of projecting this duplicate edge into Keto. Keep this write
      // until that authorization-contract change has a separately reviewed
      // rollout. Decision: 22428658-092e-4ec2-b7d0-d5e2f0e74552.
      await relationshipWriter.grantEntryParent(entryId, diaryId);
    },
    { name: 'diary.step.grantEntryParent', ...KETO_RETRY },
  );

  const removeEntryRelationsStep = DBOS.registerStep(
    async (entryId: string): Promise<void> => {
      const { relationshipWriter } = getDeps();
      await relationshipWriter.removeEntryRelations(entryId);
    },
    { name: 'diary.step.removeEntryRelations', ...KETO_RETRY },
  );

  // ── Workflows ──────────────────────────────────────────────

  // A failed attempt hands off to a delayed durable child instead of holding
  // a queue slot asleep. Transient failures never silently discard embeddings;
  // repeated failures remain visible as DELAYED jobs and step error logs.
  const enrichEntry: (
    input: EmbeddingInput,
    jobId: string,
    attempt?: number,
  ) => Promise<void> = DBOS.registerWorkflow(
    async (
      input: EmbeddingInput,
      jobId: string,
      attempt = 0,
    ): Promise<void> => {
      const { diaryEntryRepository, transactionRunner } = getDeps();
      try {
        const needed = await transactionRunner.runInTransaction(
          () => diaryEntryRepository.needsEmbedding(input),
          { name: 'diary.embedding.check' },
        );
        if (!needed) return;
        const embedding = await embedPassageStep(
          buildEmbeddingTextLocal(input.content, input.tags, input.title),
        );
        await transactionRunner.runInTransaction(
          () => diaryEntryRepository.saveEmbedding(input, embedding),
          { name: 'diary.embedding.persist' },
        );
      } catch (err) {
        DBOS.logger.warn({
          message: 'Diary embedding deferred',
          entryId: input.id,
          attempt,
          error: err instanceof Error ? err.message : String(err),
        });
        // Explicit bounded IDs make retry handoff idempotent across recovery
        // without growing a nested child ID on every failed attempt.
        await DBOS.startWorkflow(enrichEntry, {
          workflowID: `diary-embedding:${jobId}:${attempt + 1}`,
          queueName: DIARY_EMBEDDING_QUEUE,
          timeoutMS: null,
          enqueueOptions: {
            delaySeconds: Math.min(300, 5 * 2 ** Math.min(attempt, 6)),
          },
        })(input, jobId, attempt + 1);
        return;
      }
    },
    { name: 'diary.embed' },
  );

  async function scheduleEmbedding(entry: DiaryEntry): Promise<void> {
    const jobId = await generateIdStep();
    await DBOS.startWorkflow(enrichEntry, {
      workflowID: `diary-embedding:${jobId}:0`,
      queueName: DIARY_EMBEDDING_QUEUE,
      timeoutMS: null,
    })(
      {
        id: entry.id,
        content: entry.content,
        title: entry.title,
        tags: entry.tags,
      },
      jobId,
    );
  }

  _workflows = {
    createEntry: DBOS.registerWorkflow(
      async (input: WorkflowCreateEntryInput): Promise<DiaryEntry> => {
        const { diaryEntryRepository, transactionRunner } = getDeps();

        const entryId = await generateIdStep();
        const resolvedEntryType = input.entryType ?? 'semantic';
        const { injectionRisk, threats: injectionThreats } =
          await scanInjectionStep(input.content, input.title);

        const entry = await transactionRunner.runInTransaction(
          async () => {
            return diaryEntryRepository.create({
              id: entryId,
              diaryId: input.diaryId,
              creatorAgentId:
                input.creator.kind === 'agent' ? input.creator.id : null,
              creatorHumanId:
                input.creator.kind === 'human' ? input.creator.id : null,
              content: input.content,
              title: input.title,
              tags: input.tags,
              importance: input.importance,
              entryType: resolvedEntryType,
              injectionRisk,
              injectionThreats,
              contentHash: input.contentHash,
              contentSignature: input.contentSignature,
              signingNonce: input.signingNonce,
            });
          },
          { name: 'diary.create.persist' },
        );

        try {
          await grantEntryParentStep(entry.id, input.diaryId);
        } catch {
          // Compensation: delete the orphaned entry
          await transactionRunner.runInTransaction(
            () => diaryEntryRepository.delete(entry.id),
            { name: 'diary.create.compensate' },
          );
          throw new Error('Failed to link entry to diary after creation');
        }

        await scheduleEmbedding(entry);
        return entry;
      },
      { name: 'diary.create' },
    ),

    updateEntry: DBOS.registerWorkflow(
      async (
        id: string,
        updates: UpdateEntryInput,
        existingContent?: string,
        existingTitle?: string | null,
        _existingTags?: string[] | null,
      ): Promise<DiaryEntry | null> => {
        const { diaryEntryRepository, transactionRunner } = getDeps();
        const repoUpdates: Record<string, unknown> = { ...updates };

        if (updates.content !== undefined || updates.title !== undefined) {
          const contentToScan = updates.content ?? existingContent ?? '';
          const titleToScan =
            updates.title !== undefined ? updates.title : existingTitle;
          const { injectionRisk, threats } = await scanInjectionStep(
            contentToScan,
            titleToScan,
          );
          repoUpdates.injectionRisk = injectionRisk;
          repoUpdates.injectionThreats = threats;
        }

        if (
          updates.content !== undefined ||
          updates.tags !== undefined ||
          updates.title !== undefined
        ) {
          // Clear the vector in the same transaction as the content edit.
          repoUpdates.embedding = null;
        }

        const entry = await transactionRunner.runInTransaction(
          () => diaryEntryRepository.update(id, repoUpdates),
          { name: 'diary.update.persist' },
        );
        if (entry && repoUpdates.embedding === null)
          await scheduleEmbedding(entry);
        return entry;
      },
      { name: 'diary.update' },
    ),

    deleteEntry: DBOS.registerWorkflow(
      async (id: string): Promise<boolean> => {
        const { diaryEntryRepository, transactionRunner } = getDeps();

        const deleted = await transactionRunner.runInTransaction(
          () => diaryEntryRepository.delete(id),
          { name: 'diary.delete.persist' },
        );

        if (deleted) {
          await removeEntryRelationsStep(id);
        }

        return deleted;
      },
      { name: 'diary.delete' },
    ),
  };
}

// ── Exported Collection ──────────────────────────────────────

export const diaryWorkflows = {
  get createEntry() {
    if (!_workflows) {
      throw new Error(
        'Diary workflows not initialized. Call initDiaryWorkflows() after configureDBOS().',
      );
    }
    // bind(undefined) prevents `this = diaryWorkflows` when called as a method,
    // which would trigger DBOSInvalidWorkflowTransitionError (expects ConfiguredInstance or undefined)
    return _workflows.createEntry.bind(undefined);
  },
  get updateEntry() {
    if (!_workflows) {
      throw new Error(
        'Diary workflows not initialized. Call initDiaryWorkflows() after configureDBOS().',
      );
    }
    return _workflows.updateEntry.bind(undefined);
  },
  get deleteEntry() {
    if (!_workflows) {
      throw new Error(
        'Diary workflows not initialized. Call initDiaryWorkflows() after configureDBOS().',
      );
    }
    return _workflows.deleteEntry.bind(undefined);
  },
};
