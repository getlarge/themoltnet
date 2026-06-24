import type { CreateTaskData } from '@moltnet/api-client';
import {
  type AssessBriefInput,
  type ContextBinding,
  type CuratePackInput,
  type FreeformInput,
  type FulfillBriefInput,
  type JudgeEvalAttemptInput,
  type JudgePackInput,
  normalizeTaskInputForCreate,
  type PrReviewInput,
  type RenderPackInput,
  type RunEvalInput,
  type TaskRef,
  validateTaskCreateRequest,
} from '@moltnet/tasks';

import { TaskBuildError } from './errors.js';

/** The `tasks.create` request body the builder produces. */
export type CreateTaskBody = CreateTaskData['body'];

/** Role a referenced task's output plays in the new task. */
export type ReferenceRole = TaskRef['role'];

/** Anything {@link TaskBuilder.references} can normalize into a `TaskRef`. */
export type ReferenceSource =
  | TaskRef
  | { taskId: string | null; outputCid: string }
  | { outputRef(role: ReferenceRole): TaskRef };

/**
 * Task types that receive the auto-injected `submit-output` gate at create
 * time. Mirrors `PRODUCER_TASK_TYPES_WITH_SUBMIT_GATE` in
 * `@moltnet/tasks`'s `normalizeTaskInputForCreate`.
 */
export const PRODUCER_TASK_TYPES: ReadonlySet<string> = new Set([
  'freeform',
  'fulfill_brief',
  'curate_pack',
  'render_pack',
  'run_eval',
]);

interface Gate {
  id: string;
  kind: string;
  description?: string;
  required?: boolean;
  spec?: Record<string, unknown>;
}

/**
 * Fluent, network-free builder for a `tasks.create` body. Encodes the
 * non-obvious task schema (context arrays, success-criteria gates,
 * references + the easily-forgotten `outputCid`) so `.build()` returns a
 * body that passes the same validation the server runs.
 *
 * Construct via the per-type factories ({@link buildFreeform}, …) or the
 * generic {@link buildTask}.
 */
export class TaskBuilder<TInput extends Record<string, unknown>> {
  private readonly taskType: string;
  private inputData: Record<string, unknown>;
  private readonly refs: TaskRef[] = [];
  private readonly body: Partial<CreateTaskBody> = {};

  constructor(taskType: string, input: TInput) {
    this.taskType = taskType;
    this.inputData = { ...input };
  }

  /**
   * Merge a partial patch into the typed `input` payload.
   *
   * @param patch - Fields to merge over the current input.
   * @returns This builder, for chaining.
   */
  input(patch: Partial<TInput>): this {
    this.inputData = { ...this.inputData, ...patch };
    return this;
  }

  /**
   * Push a context entry onto `input.context` — a `ContextRef[]`, NOT a
   * free-form object. `content` must be a string (≤ 64 KiB); `slug` must
   * match `^[a-zA-Z0-9_-]+$`. The soft cap is 5 entries.
   *
   * @param slug - Kebab/snake-safe identifier for the entry.
   * @param binding - How the bytes reach the LLM.
   * @param content - The UTF-8 string content.
   * @returns This builder, for chaining.
   */
  context(slug: string, binding: ContextBinding, content: string): this {
    // Copy before appending so we never mutate a `context` array the caller
    // passed into the factory (or shares across builders).
    const ctx = [...((this.inputData.context as unknown[] | undefined) ?? [])];
    ctx.push({ slug, binding, content });
    this.inputData.context = ctx;
    return this;
  }

  /**
   * Convenience for `context(slug, 'context_inline', …)`. Non-string values
   * are JSON-stringified into `content` (objects, arrays, numbers welcome).
   *
   * @param slug - Identifier for the entry.
   * @param value - String passed through; anything else `JSON.stringify`d.
   * @returns This builder, for chaining.
   */
  contextInline(slug: string, value: unknown): this {
    const content = typeof value === 'string' ? value : JSON.stringify(value);
    return this.context(slug, 'context_inline', content);
  }

  /**
   * Like {@link contextInline} but with the `user_inline` binding.
   *
   * @param slug - Identifier for the entry.
   * @param value - String passed through; anything else `JSON.stringify`d.
   * @returns This builder, for chaining.
   */
  userInline(slug: string, value: unknown): this {
    const content = typeof value === 'string' ? value : JSON.stringify(value);
    return this.context(slug, 'user_inline', content);
  }

  /**
   * Explicitly add the `submit-output` gate. Idempotent and harmless:
   * producer task types get it auto-injected at {@link build} anyway. Use
   * for self-documentation of intent.
   *
   * @returns This builder, for chaining.
   */
  requireSubmitOutput(): this {
    return this.addGate({
      id: 'submit-output',
      kind: 'submit-tool-call',
      description:
        `Call \`submit_${this.taskType}_output\` exactly once with valid ` +
        'structured output.',
      required: true,
    });
  }

  /**
   * Add a `schema-check` gate binding the output to a schema CID.
   *
   * @param schemaCid - CID of the schema the output must satisfy.
   * @returns This builder, for chaining.
   */
  requireSchema(schemaCid: string): this {
    return this.addGate({
      id: `schema-check:${schemaCid}`,
      kind: 'schema-check',
      spec: { schemaCid },
      required: true,
    });
  }

  private addGate(gate: Gate): this {
    const sc =
      (this.inputData.successCriteria as
        | { version?: number; gates?: Gate[] }
        | undefined) ?? {};
    const gates = sc.gates ? [...sc.gates] : [];
    if (!gates.some((g) => g.id === gate.id)) gates.push(gate);
    this.inputData.successCriteria = { version: 1, ...sc, gates };
    return this;
  }

  /**
   * Add a reference to a prior task's output. Accepts a result reader
   * (`readResult(...)`), a raw `{ taskId, outputCid }`, or a `TaskRef`.
   * The easily-forgotten `outputCid` is pulled automatically; a source
   * without one throws {@link TaskBuildError}.
   *
   * @param source - The prior task's result, a `TaskRef`, or `{taskId,outputCid}`.
   * @param role - The role the referenced output plays.
   * @returns This builder, for chaining.
   * @throws {TaskBuildError} when the source has no `outputCid`.
   * @example
   * builder.references(prevResult, 'context')
   */
  references(source: ReferenceSource, role: ReferenceRole): this {
    let ref: TaskRef;
    if ('outputRef' in source && typeof source.outputRef === 'function') {
      ref = source.outputRef(role);
    } else {
      const s = source as {
        taskId: string | null;
        outputCid?: string;
      };
      if (!s.outputCid) {
        throw new TaskBuildError([
          {
            field: 'references/outputCid',
            message: 'reference is missing required outputCid',
          },
        ]);
      }
      ref = { taskId: s.taskId ?? null, outputCid: s.outputCid, role };
    }
    this.refs.push(ref);
    return this;
  }

  /**
   * Set the owning team (required by the wire schema).
   *
   * @param teamId - Team UUID.
   * @returns This builder, for chaining.
   */
  team(teamId: string): this {
    this.body.teamId = teamId;
    return this;
  }

  /**
   * Set the diary (required by the wire schema).
   *
   * @param diaryId - Diary UUID.
   * @returns This builder, for chaining.
   */
  diary(diaryId: string): this {
    this.body.diaryId = diaryId;
    return this;
  }

  /**
   * Set the correlation id. Auto-generated server-side if omitted.
   *
   * @param id - Correlation UUID grouping related tasks.
   * @returns This builder, for chaining.
   */
  correlationId(id: string): this {
    this.body.correlationId = id;
    return this;
  }

  /**
   * Replace the task tags.
   *
   * @param t - Tag strings.
   * @returns This builder, for chaining.
   */
  tags(...t: string[]): this {
    this.body.tags = t;
    return this;
  }

  /**
   * Set the human-readable title.
   *
   * @param s - Title string.
   * @returns This builder, for chaining.
   */
  title(s: string): this {
    this.body.title = s;
    return this;
  }

  /**
   * Set the maximum number of delivery attempts.
   *
   * @param n - Attempt cap (≥ 1).
   * @returns This builder, for chaining.
   */
  maxAttempts(n: number): this {
    this.body.maxAttempts = n;
    return this;
  }

  /**
   * Set the task time-to-live in seconds.
   *
   * @param n - TTL in seconds.
   * @returns This builder, for chaining.
   */
  expiresInSec(n: number): this {
    this.body.expiresInSec = n;
    return this;
  }

  /**
   * Override the dispatch timeout (seconds, 1–86400).
   *
   * @param n - Dispatch timeout in seconds.
   * @returns This builder, for chaining.
   */
  dispatchTimeoutSec(n: number): this {
    this.body.dispatchTimeoutSec = n;
    return this;
  }

  /**
   * Override the running timeout (seconds, 1–86400).
   *
   * @param n - Running timeout in seconds.
   * @returns This builder, for chaining.
   */
  runningTimeoutSec(n: number): this {
    this.body.runningTimeoutSec = n;
    return this;
  }

  /**
   * Require a minimum executor trust level.
   *
   * @param level - The required trust level.
   * @returns This builder, for chaining.
   */
  requireExecutorTrust(
    level: NonNullable<CreateTaskBody['requiredExecutorTrustLevel']>,
  ): this {
    this.body.requiredExecutorTrustLevel = level;
    return this;
  }

  /**
   * Restrict execution to specific runtime profiles.
   *
   * @param profiles - Runtime profile references.
   * @returns This builder, for chaining.
   */
  allowProfiles(
    ...profiles: NonNullable<CreateTaskBody['allowedProfiles']>
  ): this {
    this.body.allowedProfiles = profiles;
    return this;
  }

  /**
   * Normalize, validate, and return the create body. The `input` payload is
   * normalized identically to the server (producer types receive the
   * `submit-output` gate via the same `normalizeTaskInputForCreate` the server
   * runs), so what you build is what executes. The server additionally fills a
   * generated `correlationId` when omitted, so the persisted top-level body may
   * gain that one field.
   *
   * @returns A validated `CreateTaskData['body']`.
   * @throws {TaskBuildError} when required fields are missing or the payload
   *   fails the shared `@moltnet/tasks` validation, with field-level detail.
   * @example
   * const body = buildFreeform({ brief }).team(t).diary(d).build();
   * await agent.tasks.create(body);
   */
  build(): CreateTaskBody {
    const missing = [];
    if (!this.body.teamId) {
      missing.push({ field: 'teamId', message: 'teamId is required' });
    }
    if (!this.body.diaryId) {
      missing.push({ field: 'diaryId', message: 'diaryId is required' });
    }

    const normalizedInput = PRODUCER_TASK_TYPES.has(this.taskType)
      ? (normalizeTaskInputForCreate(this.taskType, this.inputData) as Record<
          string,
          unknown
        >)
      : this.inputData;

    const references = this.refs.length > 0 ? this.refs : null;
    const validationErrors = validateTaskCreateRequest({
      taskType: this.taskType,
      input: normalizedInput,
      references,
    });

    const all = [...missing, ...validationErrors];
    if (all.length > 0) throw new TaskBuildError(all);

    return {
      ...this.body,
      taskType: this.taskType,
      input: normalizedInput,
      teamId: this.body.teamId as string,
      diaryId: this.body.diaryId as string,
      ...(references ? { references } : {}),
    } as CreateTaskBody;
  }
}

/**
 * Generic builder factory — escape hatch for any task type slug. Prefer the
 * typed per-type factories ({@link buildFreeform}, …) where available.
 *
 * @param taskType - The task type slug.
 * @param input - The type-specific input payload.
 * @returns A {@link TaskBuilder} for the given type.
 */
export function buildTask<TInput extends Record<string, unknown>>(
  taskType: string,
  input: TInput,
): TaskBuilder<TInput> {
  return new TaskBuilder<TInput>(taskType, input);
}

/** Require keys `K` of `T` while keeping the rest optional. */
type WithRequired<T, K extends keyof T> = Pick<T, K> & Partial<T>;

/**
 * Build a `freeform` task. `brief` is required.
 *
 * @param input - Freeform input; `brief` mandatory.
 * @returns A typed {@link TaskBuilder}.
 * @example
 * agent.tasks.buildFreeform({ brief: 'Classify…' })
 *   .contextInline('user-request', userText)
 *   .team(teamId).diary(diaryId).build();
 */
export function buildFreeform(
  input: WithRequired<FreeformInput, 'brief'>,
): TaskBuilder<FreeformInput> {
  return buildTask('freeform', input as FreeformInput);
}

/**
 * Build a `fulfill_brief` task. `brief` is required.
 *
 * @param input - Fulfill-brief input; `brief` mandatory.
 * @returns A typed {@link TaskBuilder}.
 */
export function buildFulfillBrief(
  input: WithRequired<FulfillBriefInput, 'brief'>,
): TaskBuilder<FulfillBriefInput> {
  return buildTask('fulfill_brief', input as FulfillBriefInput);
}

/**
 * Build a `curate_pack` task. `diaryId` and `taskPrompt` are required.
 *
 * @param input - Curate-pack input; `diaryId` + `taskPrompt` mandatory.
 * @returns A typed {@link TaskBuilder}.
 */
export function buildCuratePack(
  input: WithRequired<CuratePackInput, 'diaryId' | 'taskPrompt'>,
): TaskBuilder<CuratePackInput> {
  return buildTask('curate_pack', input as CuratePackInput);
}

/**
 * Build a `render_pack` task. `packId` is required.
 *
 * @param input - Render-pack input; `packId` mandatory.
 * @returns A typed {@link TaskBuilder}.
 */
export function buildRenderPack(
  input: WithRequired<RenderPackInput, 'packId'>,
): TaskBuilder<RenderPackInput> {
  return buildTask('render_pack', input as RenderPackInput);
}

/**
 * Build a `run_eval` task. `scenario`, `variantLabel`, `execution`, and
 * `context` are required.
 *
 * @param input - Run-eval input; the four core fields mandatory.
 * @returns A typed {@link TaskBuilder}.
 */
export function buildRunEval(
  input: WithRequired<
    RunEvalInput,
    'scenario' | 'variantLabel' | 'execution' | 'context'
  >,
): TaskBuilder<RunEvalInput> {
  return buildTask('run_eval', input as RunEvalInput);
}

/**
 * Build an `assess_brief` task. Requires `targetTaskId` + `successCriteria`
 * and at least one reference (add via `.references(...)`).
 *
 * @param input - Assess-brief input; `targetTaskId` + `successCriteria` mandatory.
 * @returns A typed {@link TaskBuilder}.
 */
export function buildAssessBrief(
  input: WithRequired<AssessBriefInput, 'targetTaskId' | 'successCriteria'>,
): TaskBuilder<AssessBriefInput> {
  return buildTask('assess_brief', input as AssessBriefInput);
}

/**
 * Build a `judge_pack` task. Requires `renderedPackId`, `sourcePackId`,
 * `successCriteria` and at least one reference.
 *
 * @param input - Judge-pack input; the three core fields mandatory.
 * @returns A typed {@link TaskBuilder}.
 */
export function buildJudgePack(
  input: WithRequired<
    JudgePackInput,
    'renderedPackId' | 'sourcePackId' | 'successCriteria'
  >,
): TaskBuilder<JudgePackInput> {
  return buildTask('judge_pack', input as JudgePackInput);
}

/**
 * Build a `judge_eval_attempt` task. Requires `targetTaskId`,
 * `targetAttemptN`, and `successCriteria`.
 *
 * @param input - Judge-eval-attempt input; the three core fields mandatory.
 * @returns A typed {@link TaskBuilder}.
 */
export function buildJudgeEvalAttempt(
  input: WithRequired<
    JudgeEvalAttemptInput,
    'targetTaskId' | 'targetAttemptN' | 'successCriteria'
  >,
): TaskBuilder<JudgeEvalAttemptInput> {
  return buildTask('judge_eval_attempt', input as JudgeEvalAttemptInput);
}

/**
 * Build a `pr_review` task. Requires `subject` + `successCriteria`. Note the
 * rubric criteria must use `boolean` scoring for this task type.
 *
 * @param input - PR-review input; `subject` + `successCriteria` mandatory.
 * @returns A typed {@link TaskBuilder}.
 */
export function buildPrReview(
  input: WithRequired<PrReviewInput, 'subject' | 'successCriteria'>,
): TaskBuilder<PrReviewInput> {
  return buildTask('pr_review', input as PrReviewInput);
}
