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
 * `task_type`s). Type-specific payloads live inside `input` / `output`
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
    task_id: Type.Union([Uuid, Type.Null()]),
    output_cid: Cid,
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
    input_tokens: Type.Number(),
    output_tokens: Type.Number(),
    cache_read_tokens: Type.Optional(Type.Number()),
    cache_write_tokens: Type.Optional(Type.Number()),
    tool_calls: Type.Optional(Type.Number()),
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
    agent_id: Type.Union([Uuid, Type.Null()]),
    human_id: Type.Union([Uuid, Type.Null()]),
  },
  { $id: 'ActorPair', additionalProperties: false },
);
export type ActorPair = Static<typeof ActorPair>;

/**
 * The Task promise body.
 *
 * Type-neutrality invariant: no property on this type is specific to one
 * `task_type`. Type-specific payload lives inside `input` (validated
 * against the schema registered for `task_type`).
 */
export const Task = Type.Object(
  {
    id: Uuid,
    task_type: Type.String({ minLength: 1 }),
    team_id: Uuid,
    diary_id: Type.Union([Uuid, Type.Null()]),

    // Discriminator
    output_kind: OutputKind,

    // Promise body (immutable once an accepted attempt is signed)
    input: Type.Record(Type.String(), Type.Unknown()),
    input_schema_cid: Cid,
    input_cid: Cid,
    criteria_cid: Type.Union([Cid, Type.Null()]),
    references: Type.Array(TaskRef),

    // Grouping (type-neutral)
    correlation_id: Type.Union([Uuid, Type.Null()]),

    // Attribution — imposer is agent XOR human
    imposed_by_agent_id: Type.Union([Uuid, Type.Null()]),
    imposed_by_human_id: Type.Union([Uuid, Type.Null()]),
    accepted_attempt_n: Type.Union([Type.Number(), Type.Null()]),

    // Lifecycle
    status: TaskStatus,
    queued_at: IsoTimestamp,
    completed_at: Type.Union([IsoTimestamp, Type.Null()]),
    expires_at: Type.Union([IsoTimestamp, Type.Null()]),

    // Cancellation — canceller is agent XOR human
    cancelled_by_agent_id: Type.Union([Uuid, Type.Null()]),
    cancelled_by_human_id: Type.Union([Uuid, Type.Null()]),
    cancel_reason: Type.Union([Type.String(), Type.Null()]),

    // Retry policy
    max_attempts: Type.Number({ minimum: 1 }),
  },
  { $id: 'Task', additionalProperties: false },
);
export type Task = Static<typeof Task>;

// ---------------------------------------------------------------------------
// Task attempt (one per delivery attempt)
// ---------------------------------------------------------------------------

/**
 * A single attempt at fulfilling a task. `(task_id, attempt_n)` is the
 * primary key. `tasks.accepted_attempt_n` points at the winning row.
 */
export const TaskAttempt = Type.Object(
  {
    task_id: Uuid,
    attempt_n: Type.Number({ minimum: 1 }),
    claimed_by_agent_id: Uuid,
    runtime_id: Type.Union([Uuid, Type.Null()]),
    claimed_at: IsoTimestamp,
    started_at: Type.Union([IsoTimestamp, Type.Null()]),
    completed_at: Type.Union([IsoTimestamp, Type.Null()]),
    status: TaskAttemptStatus,
    output: Type.Union([
      Type.Record(Type.String(), Type.Unknown()),
      Type.Null(),
    ]),
    output_cid: Type.Union([Cid, Type.Null()]),
    error: Type.Union([TaskError, Type.Null()]),
    usage: Type.Union([TaskUsage, Type.Null()]),
    content_signature: Type.Union([Type.String(), Type.Null()]),
    signed_at: Type.Union([IsoTimestamp, Type.Null()]),
  },
  { $id: 'TaskAttempt', additionalProperties: false },
);
export type TaskAttempt = Static<typeof TaskAttempt>;

// ---------------------------------------------------------------------------
// Task message (append-only stream, per attempt)
// ---------------------------------------------------------------------------

export const TaskMessage = Type.Object(
  {
    task_id: Uuid,
    attempt_n: Type.Number({ minimum: 1 }),
    seq: Type.Number({ minimum: 0 }),
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
    task_id: Uuid,
    attempt_n: Type.Number({ minimum: 1 }),
    status: Type.Union([
      Type.Literal('completed'),
      Type.Literal('failed'),
      Type.Literal('cancelled'),
    ]),
    output: Type.Union([
      Type.Record(Type.String(), Type.Unknown()),
      Type.Null(),
    ]),
    output_cid: Type.Union([Cid, Type.Null()]),
    usage: TaskUsage,
    duration_ms: Type.Number({ minimum: 0 }),
    error: Type.Optional(TaskError),
    content_signature: Type.Optional(Type.String()),
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
    runtime_id: Uuid,
    agent_id: Uuid,
    timestamp: IsoTimestamp,
    status: Type.Union([
      Type.Literal('idle'),
      Type.Literal('busy'),
      Type.Literal('draining'),
    ]),
    active_task_ids: Type.Array(Uuid),
    supported_task_types: Type.Array(Type.String()),
  },
  { $id: 'RuntimeHeartbeat', additionalProperties: false },
);
export type RuntimeHeartbeat = Static<typeof RuntimeHeartbeat>;
