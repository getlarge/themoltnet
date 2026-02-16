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
  DiaryRepository,
  EmbeddingService,
  PermissionChecker,
  UpdateEntryInput,
} from '../types.js';

// ── Types ──────────────────────────────────────────────────────

export interface DiaryWorkflowDeps {
  diaryRepository: DiaryRepository;
  permissionChecker: PermissionChecker;
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
) => Promise<DiaryEntry | null>;
type DeleteEntryFn = (id: string) => Promise<boolean>;
type ShareEntryFn = (
  entryId: string,
  sharedBy: string,
  sharedWith: string,
) => Promise<boolean>;

let _workflows: {
  createEntry: CreateEntryFn;
  updateEntry: UpdateEntryFn;
  deleteEntry: DeleteEntryFn;
  shareEntry: ShareEntryFn;
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
      const { permissionChecker } = getDeps();
      await permissionChecker.grantOwnership(entryId, ownerId);
    },
    { name: 'diary.step.grantOwnership', ...KETO_RETRY },
  );

  const grantViewerStep = DBOS.registerStep(
    async (entryId: string, agentId: string): Promise<void> => {
      const { permissionChecker } = getDeps();
      await permissionChecker.grantViewer(entryId, agentId);
    },
    { name: 'diary.step.grantViewer', ...KETO_RETRY },
  );

  const removeEntryRelationsStep = DBOS.registerStep(
    async (entryId: string): Promise<void> => {
      const { permissionChecker } = getDeps();
      await permissionChecker.removeEntryRelations(entryId);
    },
    { name: 'diary.step.removeEntryRelations', ...KETO_RETRY },
  );

  // ── Workflows ──────────────────────────────────────────────

  _workflows = {
    createEntry: DBOS.registerWorkflow(
      async (input: CreateEntryInput): Promise<DiaryEntry> => {
        const { diaryRepository, dataSource } = getDeps();

        const entryId = await generateIdStep();
        const embedding = await embedPassageStep(input.content);
        const { injectionRisk } = await scanInjectionStep(
          input.content,
          input.title,
        );

        const entry = await dataSource.runTransaction(
          () =>
            diaryRepository.create({
              id: entryId,
              ownerId: input.ownerId,
              content: input.content,
              title: input.title,
              visibility: input.visibility ?? 'private',
              tags: input.tags,
              embedding: embedding.length > 0 ? embedding : undefined,
              injectionRisk,
            }),
          { name: 'diary.create.persist' },
        );

        try {
          await grantOwnershipStep(entry.id, input.ownerId);
        } catch {
          // Compensation: delete the orphaned entry
          await dataSource.runTransaction(
            () => diaryRepository.delete(entry.id),
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
      ): Promise<DiaryEntry | null> => {
        const { diaryRepository, dataSource } = getDeps();
        const repoUpdates: Record<string, unknown> = { ...updates };

        if (updates.content || updates.title !== undefined) {
          const contentToScan = updates.content ?? existingContent ?? '';
          const titleToScan =
            updates.title !== undefined ? updates.title : existingTitle;
          const { injectionRisk } = await scanInjectionStep(
            contentToScan,
            titleToScan,
          );
          repoUpdates.injectionRisk = injectionRisk;
        }

        if (updates.content) {
          const embedding = await embedPassageStep(updates.content);
          if (embedding.length > 0) repoUpdates.embedding = embedding;
        }

        return dataSource.runTransaction(
          () => diaryRepository.update(id, repoUpdates),
          { name: 'diary.update.persist' },
        );
      },
      { name: 'diary.update' },
    ),

    deleteEntry: DBOS.registerWorkflow(
      async (id: string): Promise<boolean> => {
        const { diaryRepository, dataSource } = getDeps();

        const deleted = await dataSource.runTransaction(
          () => diaryRepository.delete(id),
          { name: 'diary.delete.persist' },
        );

        if (deleted) {
          await removeEntryRelationsStep(id);
        }

        return deleted;
      },
      { name: 'diary.delete' },
    ),

    shareEntry: DBOS.registerWorkflow(
      async (
        entryId: string,
        sharedBy: string,
        sharedWith: string,
      ): Promise<boolean> => {
        const { diaryRepository, dataSource } = getDeps();

        const shared = await dataSource.runTransaction(
          () => diaryRepository.share(entryId, sharedBy, sharedWith),
          { name: 'diary.share.persist' },
        );

        if (shared) {
          try {
            await grantViewerStep(entryId, sharedWith);
          } catch {
            // Compensation: remove the orphaned share record
            await dataSource.runTransaction(
              () => diaryRepository.unshare(entryId, sharedWith),
              { name: 'diary.share.compensate' },
            );
            throw new Error('Failed to grant viewer after share creation');
          }
        }

        return shared;
      },
      { name: 'diary.share' },
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
    return _workflows.createEntry;
  },
  get updateEntry() {
    if (!_workflows) {
      throw new Error(
        'Diary workflows not initialized. Call initDiaryWorkflows() after configureDBOS().',
      );
    }
    return _workflows.updateEntry;
  },
  get deleteEntry() {
    if (!_workflows) {
      throw new Error(
        'Diary workflows not initialized. Call initDiaryWorkflows() after configureDBOS().',
      );
    }
    return _workflows.deleteEntry;
  },
  get shareEntry() {
    if (!_workflows) {
      throw new Error(
        'Diary workflows not initialized. Call initDiaryWorkflows() after configureDBOS().',
      );
    }
    return _workflows.shareEntry;
  },
};
