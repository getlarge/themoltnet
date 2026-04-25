/**
 * Wire-format types for the MoltNet Task model.
 *
 * These schemas are the single source of truth for:
 *   - `tasks`, `task_attempts`, `task_messages` DB columns (PR 1's Drizzle
 *     schema must match these verbatim)
 *   - REST request/response bodies (PR 4)
 *   - `TaskReporter` output records (PR 0)
 *
 * Invariant: every property on `Task` is type-neutral (applies to all
 * `taskType`s). Type-specific payloads live inside `input` / `output`
 * JSONB, validated against schemas registered under `task_types`.
 *
 * Identity rule:
 *   - claim/execute/sign → agent-only (`task_attempts.claimed_by_agent_id`)
 *   - impose/cancel → agent XOR human (dual nullable FK + XOR check)
 *
 * See GH issue #852 for the full design snapshot.
 */
import { type Static, Type } from '@sinclair/typebox';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const TaskStatus = Type.Union(
  [
    Type.Literal('queued'),
    Type.Literal('dispatched'),
    Type.Literal('running'),
    Type.Literal('completed'),
    Type.Literal('failed'),
    Type.Literal('cancelled'),
    Type.Literal('expired'),
  ],
  { $id: 'TaskStatus' },
);
export type TaskStatus = Static<typeof TaskStatus>;

export const TaskAttemptStatus = Type.Union(
  [
    Type.Literal('claimed'),
    Type.Literal('running'),
    Type.Literal('completed'),
    Type.Literal('failed'),
    Type.Literal('cancelled'),
    Type.Literal('timed_out'),
  ],
  { $id: 'TaskAttemptStatus' },
);
export type TaskAttemptStatus = Static<typeof TaskAttemptStatus>;

export const ExecutorTrustLevel = Type.Union(
  [
    Type.Literal('selfDeclared'),
    Type.Literal('agentSigned'),
    Type.Literal('releaseVerifiedTool'),
    Type.Literal('sandboxAttested'),
  ],
  { $id: 'ExecutorTrustLevel' },
);
export type ExecutorTrustLevel = Static<typeof ExecutorTrustLevel>;

export const OutputKind = Type.Union(
  [Type.Literal('artifact'), Type.Literal('judgment')],
  { $id: 'OutputKind' },
);
export type OutputKind = Static<typeof OutputKind>;

export const TaskMessageKind = Type.Union(
  [
    Type.Literal('text_delta'),
    Type.Literal('tool_call_start'),
    Type.Literal('tool_call_end'),
    Type.Literal('turn_end'),
    Type.Literal('error'),
    Type.Literal('info'),
  ],
  { $id: 'TaskMessageKind' },
);
export type TaskMessageKind = Static<typeof TaskMessageKind>;

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const Uuid = Type.String({ format: 'uuid' });
const Cid = Type.String({ minLength: 1 });
const IsoTimestamp = Type.String({ format: 'date-time' });

/**
 * Reference to another task's output or an external artifact.
 * Embedded in `tasks.references` JSONB array.
 */
export const TaskRef = Type.Object(
  {
    taskId: Type.Union([Uuid, Type.Null()]),
    outputCid: Cid,
    role: Type.Union([
      Type.Literal('judged_work'),
      Type.Literal('reviewed_diff'),
      Type.Literal('target_source'),
      Type.Literal('context'),
    ]),
    external: Type.Optional(
      Type.Object({
        kind: Type.Union([
          Type.Literal('github_pr'),
          Type.Literal('github_issue'),
          Type.Literal('http_url'),
        ]),
        pr: Type.Optional(Type.Number()),
        issue: Type.Optional(Type.Number()),
        url: Type.Optional(Type.String()),
        commit_sha: Type.Optional(Type.String()),
        snapshot_cid: Type.Optional(Cid),
      }),
    ),
  },
  { $id: 'TaskRef', additionalProperties: false },
);
export type TaskRef = Static<typeof TaskRef>;

/**
 * Token / cost accounting for one attempt.
 * Reported by the runtime; persisted per-attempt, also rolled up into
 * `TaskOutput.usage` for convenience.
 */
export const TaskUsage = Type.Object(
  {
    inputTokens: Type.Integer({ minimum: 0 }),
    outputTokens: Type.Integer({ minimum: 0 }),
    cacheReadTokens: Type.Optional(Type.Integer({ minimum: 0 })),
    cacheWriteTokens: Type.Optional(Type.Integer({ minimum: 0 })),
    toolCalls: Type.Optional(Type.Integer({ minimum: 0 })),
    model: Type.Optional(Type.String()),
    provider: Type.Optional(Type.String()),
  },
  { $id: 'TaskUsage', additionalProperties: false },
);
export type TaskUsage = Static<typeof TaskUsage>;

/**
 * Structured error returned from a failed attempt.
 */
export const TaskError = Type.Object(
  {
    code: Type.String(),
    message: Type.String(),
    stack: Type.Optional(Type.String()),
    retryable: Type.Optional(Type.Boolean()),
  },
  { $id: 'TaskError', additionalProperties: false },
);
export type TaskError = Static<typeof TaskError>;

// ---------------------------------------------------------------------------
// Task (the promise body + lifecycle metadata)
// ---------------------------------------------------------------------------

/**
 * Authored-by pair — exactly one side is non-null.
 * Enforced at the DB layer via a XOR CHECK constraint on
 * (imposed_by_agent_id, imposed_by_human_id) and
 * (cancelled_by_agent_id, cancelled_by_human_id).
 *
 * We keep both columns flat on the wire to match the DB shape 1:1 (PR 1
 * invariant). A convenience view — `{ kind: 'agent' | 'human'; id }` —
 * can be derived application-side.
 */
export const ActorPair = Type.Object(
  {
    agentId: Type.Union([Uuid, Type.Null()]),
    humanId: Type.Union([Uuid, Type.Null()]),
  },
  { $id: 'ActorPair', additionalProperties: false },
);
export type ActorPair = Static<typeof ActorPair>;

/**
 * The Task promise body.
 *
 * Type-neutrality invariant: no property on this type is specific to one
 * `taskType`. Type-specific payload lives inside `input` (validated
 * against the schema registered for `taskType`).
 */
export const Task = Type.Object(
  {
    id: Uuid,
    taskType: Type.String({ minLength: 1 }),
    teamId: Uuid,
    diaryId: Type.Union([Uuid, Type.Null()]),

    // Discriminator
    outputKind: OutputKind,

    // Promise body (immutable once an accepted attempt is signed)
    input: Type.Record(Type.String(), Type.Unknown()),
    inputSchemaCid: Cid,
    inputCid: Cid,
    criteriaCid: Type.Union([Cid, Type.Null()]),
    references: Type.Array(TaskRef),

    // Grouping (type-neutral)
    correlationId: Type.Union([Uuid, Type.Null()]),

    // Attribution — imposer is agent XOR human
    imposedByAgentId: Type.Union([Uuid, Type.Null()]),
    imposedByHumanId: Type.Union([Uuid, Type.Null()]),
    acceptedAttemptN: Type.Union([Type.Number(), Type.Null()]),
    requiredExecutorTrustLevel: ExecutorTrustLevel,

    // Lifecycle
    status: TaskStatus,
    queuedAt: IsoTimestamp,
    completedAt: Type.Union([IsoTimestamp, Type.Null()]),
    expiresAt: Type.Union([IsoTimestamp, Type.Null()]),

    // Cancellation — canceller is agent XOR human
    cancelledByAgentId: Type.Union([Uuid, Type.Null()]),
    cancelledByHumanId: Type.Union([Uuid, Type.Null()]),
    cancelReason: Type.Union([Type.String(), Type.Null()]),

    // Retry policy
    maxAttempts: Type.Number({ minimum: 1 }),

    // Imposer-set timeout overrides. Null means the workflow uses server
    // defaults (300s dispatch, 7200s running). Pinned on the row so
    // retries see the same budget.
    dispatchTimeoutSec: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]),
    runningTimeoutSec: Type.Union([Type.Number({ minimum: 1 }), Type.Null()]),
  },
  { $id: 'Task', additionalProperties: false },
);
export type Task = Static<typeof Task>;

// ---------------------------------------------------------------------------
// Task attempt (one per delivery attempt)
// ---------------------------------------------------------------------------

/**
 * A single attempt at fulfilling a task. `(taskId, attemptN)` is the
 * primary key. `tasks.accepted_attempt_n` points at the winning row.
 */
export const TaskAttempt = Type.Object(
  {
    taskId: Uuid,
    attemptN: Type.Number({ minimum: 1 }),
    claimedByAgentId: Uuid,
    runtimeId: Type.Union([Uuid, Type.Null()]),
    claimedAt: IsoTimestamp,
    startedAt: Type.Union([IsoTimestamp, Type.Null()]),
    completedAt: Type.Union([IsoTimestamp, Type.Null()]),
    status: TaskAttemptStatus,
    output: Type.Union([
      Type.Record(Type.String(), Type.Unknown()),
      Type.Null(),
    ]),
    outputCid: Type.Union([Cid, Type.Null()]),
    claimedExecutorFingerprint: Type.Union([Cid, Type.Null()]),
    claimedExecutorManifest: Type.Union([
      Type.Record(Type.String(), Type.Unknown()),
      Type.Null(),
    ]),
    completedExecutorFingerprint: Type.Union([Cid, Type.Null()]),
    completedExecutorManifest: Type.Union([
      Type.Record(Type.String(), Type.Unknown()),
      Type.Null(),
    ]),
    error: Type.Union([TaskError, Type.Null()]),
    usage: Type.Union([TaskUsage, Type.Null()]),
    contentSignature: Type.Union([Type.String(), Type.Null()]),
    signedAt: Type.Union([IsoTimestamp, Type.Null()]),
  },
  { $id: 'TaskAttempt', additionalProperties: false },
);
export type TaskAttempt = Static<typeof TaskAttempt>;

// ---------------------------------------------------------------------------
// Task message (append-only stream, per attempt)
// ---------------------------------------------------------------------------

export const TaskMessage = Type.Object(
  {
    taskId: Uuid,
    attemptN: Type.Number({ minimum: 1 }),
    seq: Type.Number({
      minimum: 0,
      description:
        'Monotonically increasing integer assigned by the server. Use as the afterSeq cursor on the list-messages endpoint to poll for new messages without re-fetching earlier ones.',
    }),
    timestamp: IsoTimestamp,
    kind: TaskMessageKind,
    payload: Type.Record(Type.String(), Type.Unknown()),
  },
  { $id: 'TaskMessage', additionalProperties: false },
);
export type TaskMessage = Static<typeof TaskMessage>;

// ---------------------------------------------------------------------------
// TaskOutput (what executeTask returns on exit)
// ---------------------------------------------------------------------------

/**
 * Terminal result of an attempt. Distinct from `TaskAttempt` — this is
 * the compact shape the runtime surfaces back to whoever drove it
 * (stdout reporter, API reporter in PR 7, etc.).
 */
export const TaskOutput = Type.Object(
  {
    taskId: Uuid,
    attemptN: Type.Number({ minimum: 1 }),
    status: Type.Union([
      Type.Literal('completed'),
      Type.Literal('failed'),
      Type.Literal('cancelled'),
    ]),
    output: Type.Union([
      Type.Record(Type.String(), Type.Unknown()),
      Type.Null(),
    ]),
    outputCid: Type.Union([Cid, Type.Null()]),
    usage: TaskUsage,
    durationMs: Type.Number({ minimum: 0 }),
    error: Type.Optional(TaskError),
    contentSignature: Type.Optional(Type.String()),
  },
  { $id: 'TaskOutput', additionalProperties: false },
);
export type TaskOutput = Static<typeof TaskOutput>;

// ---------------------------------------------------------------------------
// Runtime heartbeat (PR 7 will POST these; PR 0 doesn't emit but the
// shape is locked here so the API swap is truly a no-op)
// ---------------------------------------------------------------------------

export const RuntimeHeartbeat = Type.Object(
  {
    runtimeId: Uuid,
    agentId: Uuid,
    timestamp: IsoTimestamp,
    status: Type.Union([
      Type.Literal('idle'),
      Type.Literal('busy'),
      Type.Literal('draining'),
    ]),
    activeTaskIds: Type.Array(Uuid),
    supportedTaskTypes: Type.Array(Type.String()),
  },
  { $id: 'RuntimeHeartbeat', additionalProperties: false },
);
export type RuntimeHeartbeat = Static<typeof RuntimeHeartbeat>;
