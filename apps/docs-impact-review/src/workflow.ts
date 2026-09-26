import {
  createInlineContext,
  type Logger,
  type SdkTaskAttempt,
  type TaskClient,
  type TaskMessage,
  waitForTaskOutcome,
  type WorkflowContext,
} from '@themoltnet/tasks-orchestrator';

import type { Git } from './git.js';
import { boundDiff, collectChangeSet } from './ingest.js';
import {
  routeDocs,
  type RoutingMap,
  searchDocsForTerms,
  selectDocs,
} from './routing.js';
import { extractExcerpt } from './sections.js';
import {
  buildCoverageTask,
  buildExtractTask,
  type CreateBody,
  parseContractExtraction,
  parseCoverageCheck,
  STAGE_RUNNING_TIMEOUT_SEC,
  type StageContext,
} from './stages.js';
import { truncateAtLine } from './text.js';
import { stageTiming } from './timing.js';
import type {
  ChangedFile,
  ChangeSet,
  ContractChange,
  CoverageGap,
  DocsImpactReport,
  FileCategory,
  SelectedDoc,
} from './types.js';

export interface Budgets {
  diffTotalBytes: number;
  diffPerFileBytes: number;
  docsDiffBytes: number;
  docExcerptBytes: number;
  maxDocs: number;
  manifestLines: number;
}

/**
 * Initial budgets sized for ~24k input tokens per stage (≈4 bytes/token):
 * extraction gets the diff; coverage gets docs diff plus six excerpts.
 */
export const DEFAULT_BUDGETS: Budgets = {
  diffTotalBytes: 64_000,
  diffPerFileBytes: 12_000,
  docsDiffBytes: 16_000,
  docExcerptBytes: 8_000,
  maxDocs: 6,
  manifestLines: 150,
};

export interface DocsImpactInput extends StageContext {
  pollIntervalSec?: number;
  budgets?: Partial<Budgets>;
}

export interface DocsImpactDeps {
  git: Git;
  tasks: TaskClient;
  ctx: WorkflowContext;
  routingMap: RoutingMap;
  logger?: Logger;
  now?: () => number;
}

/**
 * Inline context whose `sleepFor` really sleeps. The orchestrator's
 * `inlineContext` treats sleeps as no-ops, which would turn task polling
 * into a busy loop outside Absurd.
 */
export function createSleepingContext(): WorkflowContext {
  return {
    ...createInlineContext(),
    sleepFor: (_name, seconds) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, seconds * 1_000);
      }),
  };
}

/**
 * Default poll delay. It only adds wall-clock, never skews phase timings
 * (those come from server timestamps). Faster polling trips the REST API's
 * per-principal read limit (150/min by default), which a co-located daemon
 * running as the same identity also consumes; the SDK then sleeps through
 * Retry-After and stalls the review for minutes.
 */
export const DEFAULT_POLL_INTERVAL_SEC = 2;

/** Consecutive failed reads of one poll before the review gives up. */
export const POLL_READ_RETRY_LIMIT = 5;

/**
 * Statuses worth retrying while polling a task this run created. 403 is
 * included only because production maps Keto 429s to a false 403 until the
 * 503 fix in libs/auth ships; drop it once deployed.
 */
const RETRYABLE_READ_STATUSES = new Set([403, 429, 502, 503, 504]);

/**
 * Wraps task reads with bounded, logged retries so one throttled poll does
 * not discard a review whose task is still running server-side.
 */
function withReadRetries(
  tasks: TaskClient,
  ctx: WorkflowContext,
  backoffSec: number,
  logger?: Logger,
): TaskClient {
  const retry = async <T>(label: string, read: () => Promise<T>) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await read();
      } catch (error) {
        const status = (error as { statusCode?: unknown }).statusCode;
        if (
          attempt >= POLL_READ_RETRY_LIMIT ||
          typeof status !== 'number' ||
          !RETRYABLE_READ_STATUSES.has(status)
        ) {
          throw error;
        }
        logger?.warn(
          { label, status, attempt, limit: POLL_READ_RETRY_LIMIT },
          'docs_impact.task_read.retry',
        );
        await ctx.sleepFor(`${label}.retry.${attempt}`, backoffSec * attempt);
      }
    }
  };
  return {
    ...tasks,
    getTask: (id) => retry(`get:${id}`, () => tasks.getTask(id)),
    listAttempts: (id) => retry(`attempts:${id}`, () => tasks.listAttempts(id)),
  };
}

/**
 * A stage ran out of its running budget. That is a coverage limit, not an
 * infrastructure failure: the review reports `incomplete` with the stage as
 * the uncovered scope instead of `failed`.
 */
/** Runtime error codes that mean a stage ran out of an enforced budget. */
const BUDGET_ERROR_REASONS: Record<string, string> = {
  running_total_exceeded: `exceeded the ${STAGE_RUNNING_TIMEOUT_SEC}s running budget before producing output`,
  max_turns_exceeded: 'used its tool-turn budget without submitting output',
};

class StageBudgetExceeded extends Error {
  constructor(
    readonly stage: 'extract' | 'coverage',
    readonly reason: string,
  ) {
    super(`${stage} stage ${reason}`);
    this.name = 'StageBudgetExceeded';
  }
}

async function transcriptHead(
  tasks: TaskClient,
  taskId: string,
  attempt: SdkTaskAttempt | undefined,
): Promise<TaskMessage[]> {
  if (!attempt || !tasks.listMessages) return [];
  try {
    return await tasks.listMessages(taskId, attempt.attemptN);
  } catch {
    // Timing is diagnostic; a transcript read failure must not fail review.
    return [];
  }
}

async function runStage<T>(
  deps: DocsImpactDeps,
  input: DocsImpactInput,
  body: CreateBody,
  stage: 'extract' | 'coverage',
  parse: (output: unknown) => T,
  timings: DocsImpactReport['timings']['stages'],
): Promise<T> {
  const now = deps.now ?? Date.now;
  const pollIntervalSec = input.pollIntervalSec ?? DEFAULT_POLL_INTERVAL_SEC;
  const createdAt = now();
  const task = await deps.tasks.createTask(body);
  const outcome = await waitForTaskOutcome(task.id, {
    tasks: withReadRetries(deps.tasks, deps.ctx, pollIntervalSec, deps.logger),
    ctx: deps.ctx,
    pollIntervalSec,
    parse,
    logger: deps.logger,
    description: `docs-impact ${stage}`,
    logPrefix: 'docs_impact',
  });
  const observedMs = now() - createdAt;
  const finalTask =
    outcome.kind === 'accepted' ? outcome.result.task : outcome.task;
  const attempt =
    outcome.kind === 'accepted'
      ? outcome.result.attempt
      : outcome.kind === 'invalid_output'
        ? outcome.attempt
        : outcome.attempts.at(-1);
  timings[stage] = stageTiming({
    task: finalTask,
    attempt,
    messages: await transcriptHead(deps.tasks, task.id, attempt),
    observedMs,
  });
  if (outcome.kind === 'accepted') return outcome.result.state;
  const budgetReason = attempt?.error?.code
    ? BUDGET_ERROR_REASONS[attempt.error.code]
    : undefined;
  if (budgetReason) throw new StageBudgetExceeded(stage, budgetReason);
  throw new Error(`${stage} stage: ${outcome.reason}`);
}

function manifestText(files: ChangedFile[], maxLines: number): string {
  const lines = files
    .slice(0, maxLines)
    .map(
      (file) =>
        `- ${file.path} (${file.category}, ${file.status}${
          file.previousPath ? ` from ${file.previousPath}` : ''
        }, +${file.additions}/-${file.deletions})`,
    );
  if (files.length > maxLines) {
    lines.push(`- … ${files.length - maxLines} more files not listed`);
  }
  return lines.join('\n');
}

function countByCategory(files: ChangedFile[]): Record<FileCategory, number> {
  const counts: Record<FileCategory, number> = {
    source: 0,
    docs: 0,
    test: 0,
    generated: 0,
    binary: 0,
  };
  for (const file of files) counts[file.category] += 1;
  return counts;
}

function existsAt(git: Git, revision: string, path: string): boolean {
  try {
    git(['cat-file', '-e', `${revision}:${path}`]);
    return true;
  } catch {
    return false;
  }
}

function retrieveDocs(
  deps: DocsImpactDeps,
  changeSet: ChangeSet,
  changes: ContractChange[],
  budgets: Budgets,
  gaps: CoverageGap[],
): SelectedDoc[] {
  const { git } = deps;
  const head = changeSet.headRevision;
  const evidencePaths = new Set(
    changes.flatMap((change) => change.evidence.map((item) => item.path)),
  );
  const relevant = changeSet.files.filter(
    (file) =>
      file.category === 'docs' ||
      (file.category === 'source' && evidencePaths.has(file.path)),
  );
  const readmes = new Map<string, boolean>();
  const routed = routeDocs(relevant, deps.routingMap, (path) => {
    const cached = readmes.get(path);
    if (cached !== undefined) return cached;
    const exists = existsAt(git, head, path);
    readmes.set(path, exists);
    return exists;
  });
  const terms = changes.flatMap((change) => change.searchTerms);
  for (const path of searchDocsForTerms(git, head, terms).keys()) {
    const reasons = routed.candidates.get(path) ?? [];
    if (!reasons.includes('symbol-search')) reasons.push('symbol-search');
    routed.candidates.set(path, reasons);
  }
  const selection = selectDocs(routed.candidates, budgets.maxDocs);
  for (const path of selection.overflow) {
    gaps.push({
      scope: path,
      reason: `candidate doc not reviewed: more than ${budgets.maxDocs} docs matched`,
    });
  }
  return selection.selected.map(({ path, reasons }) => {
    if (!existsAt(git, head, path)) {
      return { path, reasons, excerpt: '', missing: true };
    }
    const markdown = git(['show', `${head}:${path}`]);
    return {
      path,
      reasons,
      excerpt: extractExcerpt(markdown, terms, budgets.docExcerptBytes),
    };
  });
}

export async function runDocsImpactReview(
  deps: DocsImpactDeps,
  input: DocsImpactInput,
): Promise<DocsImpactReport> {
  const now = deps.now ?? Date.now;
  const budgets = { ...DEFAULT_BUDGETS, ...input.budgets };
  const started = now();
  const timings: DocsImpactReport['timings'] = {
    ingestMs: 0,
    retrievalMs: 0,
    stages: {},
    totalMs: 0,
  };
  const report: DocsImpactReport = {
    version: 1,
    repo: input.repo,
    pr: input.pr,
    baseRevision: input.baseRevision,
    headRevision: input.headRevision,
    status: 'completed',
    findings: [],
    gaps: [],
    repairs: [],
    manifest: {
      files: 0,
      byCategory: countByCategory([]),
      diffBytes: 0,
    },
    selectedDocs: [],
    contractChanges: [],
    timings,
  };
  /** Runs a parser and records its repairs only once the output is accepted. */
  const withRepairs =
    <T>(
      stage: 'extract' | 'coverage',
      parse: (output: unknown, repairs: string[]) => T,
    ) =>
    (output: unknown): T => {
      const repairs: string[] = [];
      const parsed = parse(output, repairs);
      for (const repair of repairs) report.repairs.push({ stage, repair });
      return parsed;
    };
  const finish = (): DocsImpactReport => {
    timings.totalMs = now() - started;
    if (
      report.status === 'completed' &&
      report.gaps.length > 0 &&
      (report.outcome === 'covered' || report.outcome === 'not-needed')
    ) {
      report.outcome = 'incomplete';
    }
    return report;
  };

  try {
    const changeSet = collectChangeSet(
      deps.git,
      input.baseRevision,
      input.headRevision,
    );
    const diff = boundDiff(deps.git, changeSet, {
      totalBytes: budgets.diffTotalBytes,
      perFileBytes: budgets.diffPerFileBytes,
    });
    report.manifest = {
      files: changeSet.files.length,
      byCategory: countByCategory(changeSet.files),
      diffBytes: diff.bytes,
    };
    for (const path of diff.omittedPaths) {
      report.gaps.push({
        scope: path,
        reason: 'omitted from model context by the diff budget',
      });
    }
    for (const path of diff.truncatedPaths) {
      report.gaps.push({
        scope: path,
        reason: 'patch truncated at the per-file budget',
      });
    }
    timings.ingestMs = now() - started;

    const sourcePaths = new Set(
      changeSet.files
        .filter((file) => file.category === 'source')
        .map((file) => file.path),
    );
    const changedDocs = new Set(
      changeSet.files
        .filter((file) => file.category === 'docs')
        .map((file) => file.path),
    );
    if (sourcePaths.size === 0 && changedDocs.size === 0) {
      report.outcome = 'not-needed';
      return finish();
    }

    if (sourcePaths.size > 0) {
      const extraction = await runStage(
        deps,
        input,
        buildExtractTask(input, {
          manifest: manifestText(changeSet.files, budgets.manifestLines),
          diff: diff.text,
        }),
        'extract',
        withRepairs('extract', (output, repairs) =>
          parseContractExtraction(output, sourcePaths, repairs),
        ),
        timings.stages,
      );
      report.contractChanges = extraction.changes;
    }
    if (report.contractChanges.length === 0 && changedDocs.size === 0) {
      report.outcome = 'not-needed';
      return finish();
    }

    const retrievalStarted = now();
    const docs = retrieveDocs(
      deps,
      changeSet,
      report.contractChanges,
      budgets,
      report.gaps,
    );
    report.selectedDocs = docs.map(({ path, reasons, missing }) => ({
      path,
      reasons,
      ...(missing ? { missing } : {}),
    }));
    const docsBlocks = diff.blocks
      .filter((block) => block.category === 'docs')
      .map((block) => block.text)
      .join('');
    const docsDiff = truncateAtLine(docsBlocks, budgets.docsDiffBytes);
    if (docsDiff !== docsBlocks) {
      report.gaps.push({
        scope: 'documentation diff',
        reason: 'truncated at the docs-diff budget',
      });
    }
    timings.retrievalMs = now() - retrievalStarted;

    const coverage = await runStage(
      deps,
      input,
      buildCoverageTask(input, {
        changes: report.contractChanges,
        docs,
        docsDiff,
      }),
      'coverage',
      withRepairs('coverage', (output, repairs) =>
        parseCoverageCheck(
          output,
          {
            changeIds: new Set(
              report.contractChanges.map((change) => change.id),
            ),
            changedPaths: new Set(changeSet.files.map((file) => file.path)),
            changedDocs,
            selectedDocs: new Set(docs.map((doc) => doc.path)),
          },
          repairs,
        ),
      ),
      timings.stages,
    );
    // With no contract changes this was a documentation-only review: "nothing
    // needs documenting" there means the changed instructions held up.
    report.outcome =
      report.contractChanges.length === 0 && coverage.outcome === 'not-needed'
        ? 'covered'
        : coverage.outcome;
    report.findings = coverage.findings;
    return finish();
  } catch (error) {
    if (error instanceof StageBudgetExceeded) {
      report.outcome = 'incomplete';
      report.gaps.push({
        scope: `${error.stage} stage`,
        reason: error.reason,
      });
      return finish();
    }
    report.status = 'failed';
    delete report.outcome;
    report.error = error instanceof Error ? error.message : String(error);
    return finish();
  }
}
