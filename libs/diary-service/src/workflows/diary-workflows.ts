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

import { type DataSource, DBOS } from '@moltnet/database';

import { scanForInjection } from '../injection-scanner.js';
import type {
  CreateEntryInput,
  DiaryEntry,
  DiaryEntryRepository,
  EmbeddingService,
  RelationshipWriter,
  UpdateEntryInput,
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
  dataSource: DataSource;
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

const KETO_RETRY = {
  retriesAllowed: true,
  maxAttempts: 5,
  intervalSeconds: 2,
  backoffRate: 2,
} as const;

// ── Lazy Registration ──────────────────────────────────────────

type CreateEntryFn = (input: CreateEntryInput) => Promise<DiaryEntry>;
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
      return crypto.randomUUID();
    },
    { name: 'diary.step.generateId' },
  );

  const embedPassageStep = DBOS.registerStep(
    async (content: string): Promise<number[]> => {
      const { embeddingService } = getDeps();
      try {
        return await embeddingService.embedPassage(content);
      } catch {
        return [];
      }
    },
    { name: 'diary.step.embedPassage' },
  );

  const scanInjectionStep = DBOS.registerStep(
    async (
      content: string,
      title?: string | null,
    ): Promise<{ injectionRisk: boolean }> => {
      return scanForInjection(content, title);
    },
    { name: 'diary.step.scanInjection' },
  );

  const grantOwnershipStep = DBOS.registerStep(
    async (entryId: string, ownerId: string): Promise<void> => {
      const { relationshipWriter } = getDeps();
      await relationshipWriter.grantOwnership(entryId, ownerId);
    },
    { name: 'diary.step.grantOwnership', ...KETO_RETRY },
  );

  const removeEntryRelationsStep = DBOS.registerStep(
    async (entryId: string): Promise<void> => {
      const { relationshipWriter } = getDeps();
      await relationshipWriter.removeEntryRelations(entryId);
    },
    { name: 'diary.step.removeEntryRelations', ...KETO_RETRY },
  );

  // ── Workflows ──────────────────────────────────────────────

  _workflows = {
    createEntry: DBOS.registerWorkflow(
      async (input: CreateEntryInput): Promise<DiaryEntry> => {
        const { diaryEntryRepository, dataSource } = getDeps();

        const entryId = await generateIdStep();
        const embedText = buildEmbeddingTextLocal(
          input.content,
          input.tags,
          input.title,
        );
        const embedding = await embedPassageStep(embedText);
        const { injectionRisk } = await scanInjectionStep(
          input.content,
          input.title,
        );

        const entry = await dataSource.runTransaction(
          async () => {
            return diaryEntryRepository.create({
              id: entryId,
              diaryId: input.diaryId,
              content: input.content,
              title: input.title,
              tags: input.tags,
              embedding: embedding.length > 0 ? embedding : undefined,
              injectionRisk,
            });
          },
          { name: 'diary.create.persist' },
        );

        try {
          await grantOwnershipStep(entry.id, input.requesterId);
        } catch {
          // Compensation: delete the orphaned entry
          await dataSource.runTransaction(
            () => diaryEntryRepository.delete(entry.id),
            { name: 'diary.create.compensate' },
          );
          throw new Error('Failed to grant ownership after entry creation');
        }

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
        existingTags?: string[] | null,
      ): Promise<DiaryEntry | null> => {
        const { diaryEntryRepository, dataSource } = getDeps();
        const repoUpdates: Record<string, unknown> = { ...updates };

        if (updates.content !== undefined || updates.title !== undefined) {
          const contentToScan = updates.content ?? existingContent ?? '';
          const titleToScan =
            updates.title !== undefined ? updates.title : existingTitle;
          const { injectionRisk } = await scanInjectionStep(
            contentToScan,
            titleToScan,
          );
          repoUpdates.injectionRisk = injectionRisk;
        }

        if (
          updates.content !== undefined ||
          updates.tags !== undefined ||
          updates.title !== undefined
        ) {
          const content = updates.content ?? existingContent ?? '';
          const tags = updates.tags !== undefined ? updates.tags : existingTags;
          const title =
            updates.title !== undefined ? updates.title : existingTitle;
          const embedText = buildEmbeddingTextLocal(content, tags, title);
          const embedding = await embedPassageStep(embedText);
          if (embedding.length > 0) repoUpdates.embedding = embedding;
        }

        return dataSource.runTransaction(
          () => diaryEntryRepository.update(id, repoUpdates),
          { name: 'diary.update.persist' },
        );
      },
      { name: 'diary.update' },
    ),

    deleteEntry: DBOS.registerWorkflow(
      async (id: string): Promise<boolean> => {
        const { diaryEntryRepository, dataSource } = getDeps();

        const deleted = await dataSource.runTransaction(
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
