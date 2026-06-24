import type { Task, TaskAttempt } from '@moltnet/api-client';
import {
  type TaskRef,
  getTaskOutputSchema,
  validateTaskOutput,
} from '@moltnet/tasks';

import type { ReferenceRole } from './builder.js';
import { TaskResultError } from './errors.js';

/** Artifact shape shared by `freeform` / `run_eval` outputs. */
export interface FreeformArtifactLike {
  kind: string;
  title: string;
  description?: string;
  url?: string;
  path?: string;
  body?: string;
}

/**
 * Filter for {@link TaskResultReader.artifact} / `artifacts`: a bare kind
 * string, or a `{ kind?, title? }` pair.
 */
export type ArtifactFilter = string | { kind?: string; title?: string };

/** Metadata about the accepted attempt that produced the output. */
export interface AcceptedMeta {
  attemptN: number;
  completedAt: string | null;
  executorFingerprint: string | null;
}

function matches(a: FreeformArtifactLike, filter?: ArtifactFilter): boolean {
  if (filter === undefined) return true;
  if (typeof filter === 'string') return a.kind === filter;
  return (
    (filter.kind === undefined || a.kind === filter.kind) &&
    (filter.title === undefined || a.title === filter.title)
  );
}

/**
 * Typed view over a completed task's accepted output. Construct via
 * {@link createResultReader} or `agent.tasks.readResult(...)`. Validates the
 * output against its registered TypeBox schema on construction, so a
 * malformed/partial output surfaces as a {@link TaskResultError} rather than
 * a silent bad cast.
 *
 * `summary` is `undefined` for task types whose output has no `summary`
 * field (judgment types use `output.verdict` / `output.composite`).
 * `artifact*` accessors apply to `freeform` / `run_eval`; other types yield
 * `[]` / `undefined`.
 */
export class TaskResultReader<TOutput = Record<string, unknown>> {
  /** The validated, typed structured output of the accepted attempt. */
  readonly output: TOutput;
  /** The output `summary` if the task type has one, else `undefined`. */
  readonly summary: string | undefined;
  /** Accepted-attempt metadata. */
  readonly accepted: AcceptedMeta;
  /** Token / cost usage for the accepted attempt, if reported. */
  readonly usage: TaskAttempt['usage'];

  private readonly taskId: string;
  private readonly outputCid: string;

  constructor(task: Task, attempt: TaskAttempt) {
    const errors = [];
    if (task.acceptedAttemptN === null || task.acceptedAttemptN === undefined) {
      errors.push({
        field: 'acceptedAttemptN',
        message: 'task has no accepted attempt',
      });
    }
    if (attempt.output === null || attempt.output === undefined) {
      errors.push({
        field: 'output',
        message: 'accepted attempt has no output',
      });
    }
    if (!attempt.outputCid) {
      errors.push({
        field: 'outputCid',
        message: 'accepted attempt has no outputCid',
      });
    }
    if (errors.length > 0) throw new TaskResultError(errors);

    // Validate output against the registered schema when one exists.
    if (getTaskOutputSchema(task.taskType)) {
      const outErrors = validateTaskOutput(
        task.taskType,
        attempt.output,
        task.input,
      );
      if (outErrors.length > 0) throw new TaskResultError(outErrors);
    }

    this.output = attempt.output as TOutput;
    this.summary = (attempt.output as { summary?: string }).summary;
    this.taskId = task.id;
    this.outputCid = attempt.outputCid as string;
    this.accepted = {
      attemptN: attempt.attemptN,
      completedAt: attempt.completedAt ?? null,
      executorFingerprint: attempt.completedExecutorFingerprint ?? null,
    };
    this.usage = attempt.usage;
  }

  /**
   * All artifacts (optionally filtered). Empty for output types without an
   * `artifacts` field.
   *
   * @param filter - Kind string or `{ kind?, title? }` predicate.
   * @returns Matching artifacts (possibly empty).
   */
  artifacts(filter?: ArtifactFilter): FreeformArtifactLike[] {
    const all =
      (this.output as { artifacts?: FreeformArtifactLike[] }).artifacts ?? [];
    return all.filter((a) => matches(a, filter));
  }

  /**
   * First matching artifact, or `undefined`.
   *
   * @param filter - Kind string or `{ kind?, title? }` predicate.
   * @returns The first match, or `undefined`.
   */
  artifact(filter?: ArtifactFilter): FreeformArtifactLike | undefined {
    return this.artifacts(filter)[0];
  }

  /**
   * Parse a matching artifact's `body` as JSON. This is the escape hatch for
   * structured data that rides inside `artifacts[].body` as a JSON string.
   *
   * @param filter - Kind string or `{ kind?, title? }` predicate.
   * @returns The parsed body, typed as `T`.
   * @throws {TaskResultError} if no artifact matches, it has no `body`, or
   *   the body is not valid JSON.
   */
  artifactBody<T = unknown>(filter?: ArtifactFilter): T {
    const a = this.artifact(filter);
    if (!a || a.body === undefined) {
      throw new TaskResultError([
        { field: 'artifacts', message: 'no matching artifact with a body' },
      ]);
    }
    try {
      return JSON.parse(a.body) as T;
    } catch {
      throw new TaskResultError([
        { field: 'artifacts/body', message: 'artifact body is not valid JSON' },
      ]);
    }
  }

  /**
   * Build a `TaskRef` pointing at this output, ready for a new task's
   * `.references()`. Carries the real `outputCid` — the field people forget.
   *
   * @param role - The role this output plays in the downstream task.
   * @returns A `TaskRef`.
   * @example
   * nextBuilder.references(prevResult.outputRef('context'), 'context');
   * // or simply: nextBuilder.references(prevResult, 'context');
   */
  outputRef(role: ReferenceRole): TaskRef {
    return { taskId: this.taskId, outputCid: this.outputCid, role };
  }
}

/**
 * Validate and construct a {@link TaskResultReader} from a task and its
 * accepted attempt. Pure (no network).
 *
 * @param task - The completed task.
 * @param attempt - The task's accepted attempt.
 * @returns A typed reader.
 * @throws {TaskResultError} on missing/invalid output.
 */
export function createResultReader<TOutput = Record<string, unknown>>(
  task: Task,
  attempt: TaskAttempt,
): TaskResultReader<TOutput> {
  return new TaskResultReader<TOutput>(task, attempt);
}
