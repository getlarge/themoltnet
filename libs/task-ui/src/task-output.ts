/**
 * Read-only views over an attempt's `output` blob.
 *
 * `task-ui` deliberately has no runtime dependency on `@moltnet/tasks`, so
 * these are loose structural mirrors of the task-type schemas. They only
 * narrow what the UI renders; the server has already validated the output
 * against the task type when the attempt completed.
 */
import type { TaskAttemptSummary, TaskSummary } from './types.js';

export interface FreeformArtifactView {
  kind: string;
  title: string;
  description?: string;
  contentType?: string;
  body?: string;
  url?: string;
  path?: string;
  cid?: string;
  sizeBytes?: number;
}

export interface FreeformOutputView {
  summary: string;
  branch?: string;
  artifacts: FreeformArtifactView[];
  diaryEntryIds: string[];
  proposedTaskType?: { name: string; rationale: string };
}

export type VerificationResultStatus = 'pass' | 'fail' | 'skip';

export interface VerificationResultView {
  id: string;
  kind: string;
  status: VerificationResultStatus;
  detail?: string;
}

/**
 * Mirror of `VerificationRecord`: the producing agent's self-assessment
 * against `input.successCriteria`. Advisory only — it never gates
 * completion or `acceptedAttemptN`.
 */
export interface VerificationView {
  passed: boolean;
  inputCid?: string;
  results: VerificationResultView[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readArtifact(value: unknown): FreeformArtifactView | null {
  if (!isRecord(value)) return null;
  const title = optionalString(value.title);
  const kind = optionalString(value.kind);
  if (!title && !kind) return null;
  return {
    kind: kind ?? 'artifact',
    title: title ?? 'Untitled artifact',
    description: optionalString(value.description),
    contentType: optionalString(value.contentType),
    body: typeof value.body === 'string' ? value.body : undefined,
    url: optionalString(value.url),
    path: optionalString(value.path),
    cid: optionalString(value.cid),
    sizeBytes:
      typeof value.sizeBytes === 'number' ? value.sizeBytes : undefined,
  };
}

/** Reads `output.artifacts`, dropping entries without a title or kind. */
export function readFreeformArtifacts(output: unknown): FreeformArtifactView[] {
  if (!isRecord(output) || !Array.isArray(output.artifacts)) return [];
  return output.artifacts
    .map(readArtifact)
    .filter((artifact): artifact is FreeformArtifactView => Boolean(artifact));
}

/** Reads a freeform-shaped output, or returns null when `summary` is absent. */
export function readFreeformOutput(output: unknown): FreeformOutputView | null {
  if (!isRecord(output)) return null;
  const summary = optionalString(output.summary);
  if (!summary) return null;

  const artifacts = readFreeformArtifacts(output);
  const diaryEntryIds = Array.isArray(output.diaryEntryIds)
    ? output.diaryEntryIds.filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      )
    : [];
  const proposal = isRecord(output.proposedTaskType)
    ? output.proposedTaskType
    : null;
  const proposalName = optionalString(proposal?.name);
  const proposalRationale = optionalString(proposal?.rationale);

  return {
    summary,
    branch: optionalString(output.branch),
    artifacts,
    diaryEntryIds,
    proposedTaskType:
      proposalName && proposalRationale
        ? { name: proposalName, rationale: proposalRationale }
        : undefined,
  };
}

const RESULT_STATUSES = new Set<VerificationResultStatus>([
  'pass',
  'fail',
  'skip',
]);

/**
 * Reads `output.verification` for any task type that carries a
 * `VerificationRecord`. Returns null when absent or malformed.
 */
export function readVerification(output: unknown): VerificationView | null {
  if (!isRecord(output) || !isRecord(output.verification)) return null;
  const record = output.verification;
  if (typeof record.passed !== 'boolean' || !Array.isArray(record.results)) {
    return null;
  }
  const results = record.results.flatMap((result): VerificationResultView[] => {
    if (!isRecord(result)) return [];
    const id = optionalString(result.id);
    const status = result.status as VerificationResultStatus;
    if (!id || !RESULT_STATUSES.has(status)) return [];
    return [
      {
        id,
        kind: optionalString(result.kind) ?? 'check',
        status,
        detail: optionalString(result.detail),
      },
    ];
  });
  return {
    passed: record.passed,
    inputCid: optionalString(record.inputCid),
    results,
  };
}

export function summarizeVerification(verification: VerificationView) {
  const counts = { pass: 0, fail: 0, skip: 0 };
  for (const result of verification.results) counts[result.status] += 1;
  return { ...counts, total: verification.results.length };
}

/** Reads a top-level string `summary`, whatever the task type. */
export function readOutputSummary(output: unknown): string | null {
  return isRecord(output) ? (optionalString(output.summary) ?? null) : null;
}

/** The attempt the Task Engine recorded as the task's result, if loaded. */
export function findAcceptedAttempt(
  task: TaskSummary,
  attempts: readonly TaskAttemptSummary[],
): TaskAttemptSummary | null {
  if (task.acceptedAttemptN === null) return null;
  return (
    attempts.find((attempt) => attempt.attemptN === task.acceptedAttemptN) ??
    null
  );
}
