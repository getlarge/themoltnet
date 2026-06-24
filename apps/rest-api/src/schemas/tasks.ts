import {
  ClaimCondition,
  type ClaimCondition as ClaimConditionType,
  ClaimConditionDefinition,
  DaemonState,
  type DaemonState as DaemonStateType,
  ExecutorTrustLevel,
  type ExecutorTrustLevel as ExecutorTrustLevelType,
  RuntimeProfileRef,
  type RuntimeProfileRef as RuntimeProfileRefType,
  Task,
  TaskAttempt,
  TaskError,
  type TaskError as TaskErrorType,
  TaskMessage,
  TaskMessageKind,
  type TaskMessageKind as TaskMessageKindType,
  TaskRef,
  type TaskRef as TaskRefType,
  TaskStatus,
  type TaskStatus as TaskStatusType,
  TaskUsage,
  type TaskUsage as TaskUsageType,
} from '@moltnet/tasks';
import { Type } from 'typebox';

// ── Params ───────────────────────────────────────────────────────────────────

export const TaskParamsSchema = Type.Object(
  { id: Type.String({ format: 'uuid' }) },
  { $id: 'TaskParams' },
);

export const TaskAttemptParamsSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    n: Type.Integer({ minimum: 1 }),
  },
  { $id: 'TaskAttemptParams' },
);

// ── Request bodies ───────────────────────────────────────────────────────────

export const CreateTaskBodySchema = Type.Object(
  {
    taskType: Type.String({ minLength: 1 }),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    tags: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
        maxItems: 20,
      }),
    ),
    diaryId: Type.String({ format: 'uuid' }),
    input: Type.Record(Type.String(), Type.Unknown()),
    references: Type.Optional(
      Type.Array(Type.Unsafe<TaskRefType>(Type.Ref(TaskRef.$id))),
    ),
    correlationId: Type.Optional(Type.String({ format: 'uuid' })),
    claimCondition: Type.Optional(
      Type.Unsafe<ClaimConditionType>(Type.Ref(ClaimCondition.$id)),
    ),
    maxAttempts: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
    expiresInSec: Type.Optional(Type.Integer({ minimum: 1 })),
    requiredExecutorTrustLevel: Type.Optional(
      Type.Unsafe<ExecutorTrustLevelType>(Type.Ref(ExecutorTrustLevel.$id)),
    ),
    // Proposer-set runtime profile allowlist. Empty/unset = no restriction.
    // Each profile id must resolve to a profile in the task's team.
    allowedProfiles: Type.Optional(
      Type.Array(
        Type.Unsafe<RuntimeProfileRefType>(Type.Ref(RuntimeProfileRef.$id)),
        { maxItems: 16 },
      ),
    ),
    // Proposer-set timeout overrides (in seconds). Null/unset → server
    // defaults (300s / 7200s). Bounds chosen to span e2e tests (≥1s) up
    // to long-running brief fulfillment (≤86400s = 24h).
    dispatchTimeoutSec: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 86400 }),
    ),
    runningTimeoutSec: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 86400 }),
    ),
  },
  { $id: 'CreateTaskBody' },
);

export const UpdateTaskMetadataBodySchema = Type.Object(
  {
    title: Type.Optional(
      Type.Union([Type.String({ minLength: 1, maxLength: 255 }), Type.Null()]),
    ),
    tags: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
        maxItems: 20,
      }),
    ),
  },
  {
    $id: 'UpdateTaskMetadataBody',
    additionalProperties: false,
    minProperties: 1,
  },
);

export const BatchDeleteTasksBodySchema = Type.Object(
  {
    ids: Type.Array(Type.String({ format: 'uuid' }), {
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
    }),
    mode: Type.Optional(
      Type.Union([Type.Literal('safe'), Type.Literal('accept-risk')], {
        default: 'safe',
      }),
    ),
    reason: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
  },
  { $id: 'BatchDeleteTasksBody', additionalProperties: false },
);

export const ListTasksQuerySchema = Type.Object(
  {
    query: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    status: Type.Optional(
      Type.Unsafe<TaskStatusType>(Type.Ref(TaskStatus.$id)),
    ),
    // OR filter over multiple statuses (e.g. a board lane covering
    // waiting+queued). Combined with `status` it's the union of both. Lets a
    // multi-status board lane fetch one accurately-counted page.
    statuses: Type.Optional(
      Type.Array(Type.Unsafe<TaskStatusType>(Type.Ref(TaskStatus.$id)), {
        maxItems: 8,
      }),
    ),
    taskTypes: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        maxItems: 20,
        description: 'Repeated task type filter. Single value also accepted.',
      }),
    ),
    tags: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
        maxItems: 20,
        description: 'Repeated tags filter. Task must include all tags.',
      }),
    ),
    excludeTags: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
        maxItems: 20,
        description: 'Repeated excluded tags filter.',
      }),
    ),
    profileId: Type.Optional(Type.String({ format: 'uuid' })),
    correlationId: Type.Optional(Type.String({ format: 'uuid' })),
    diaryId: Type.Optional(Type.String({ format: 'uuid' })),
    proposedByAgentId: Type.Optional(Type.String({ format: 'uuid' })),
    proposedByHumanId: Type.Optional(Type.String({ format: 'uuid' })),
    claimedByAgentId: Type.Optional(Type.String({ format: 'uuid' })),
    hasAttempts: Type.Optional(Type.Boolean()),
    queuedAfter: Type.Optional(Type.String({ format: 'date-time' })),
    queuedBefore: Type.Optional(Type.String({ format: 'date-time' })),
    completedAfter: Type.Optional(Type.String({ format: 'date-time' })),
    completedBefore: Type.Optional(Type.String({ format: 'date-time' })),
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 100, default: 20 }),
    ),
    cursor: Type.Optional(Type.String()),
  },
  { $id: 'ListTasksQuery' },
);

export const ClaimTaskBodySchema = Type.Object(
  {
    leaseTtlSec: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 3600, default: 300 }),
    ),
    executorManifest: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    executorFingerprint: Type.Optional(Type.String({ minLength: 1 })),
    executorSignature: Type.Optional(Type.String({ minLength: 1 })),
    profileId: Type.Optional(Type.String({ format: 'uuid' })),
  },
  { $id: 'ClaimTaskBody' },
);

export const HeartbeatBodySchema = Type.Object(
  {
    leaseTtlSec: Type.Optional(Type.Integer({ minimum: 1, maximum: 3600 })),
  },
  { $id: 'HeartbeatBody' },
);

export const CompleteTaskBodySchema = Type.Object(
  {
    output: Type.Record(Type.String(), Type.Unknown()),
    outputCid: Type.String({ minLength: 1 }),
    usage: Type.Unsafe<TaskUsageType>(Type.Ref(TaskUsage.$id)),
    contentSignature: Type.Optional(Type.String()),
    executorManifest: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    executorFingerprint: Type.Optional(Type.String({ minLength: 1 })),
    executorSignature: Type.Optional(Type.String({ minLength: 1 })),
    // Daemon-asserted runtime state stamped onto the attempt row at
    // completion time. Optional so older daemons that don't know about
    // warm-slot resumability keep working — they persist null.
    daemonState: Type.Optional(
      Type.Union([
        Type.Unsafe<DaemonStateType>(Type.Ref(DaemonState.$id)),
        Type.Null(),
      ]),
    ),
  },
  { $id: 'CompleteTaskBody' },
);

export const FailTaskBodySchema = Type.Object(
  {
    error: Type.Unsafe<TaskErrorType>(Type.Ref(TaskError.$id)),
  },
  { $id: 'FailTaskBody' },
);

export const AbortTaskBodySchema = Type.Object(
  {
    reason: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  },
  { $id: 'AbortTaskBody' },
);

export const CancelTaskBodySchema = Type.Object(
  {
    reason: Type.String({ minLength: 1 }),
  },
  { $id: 'CancelTaskBody' },
);

export const ListMessagesQuerySchema = Type.Object(
  {
    afterSeq: Type.Optional(
      Type.Integer({
        minimum: 0,
        description:
          'Exclusive cursor: return only messages whose seq is strictly greater than this value. Omit to fetch all messages from the beginning. Pass the seq of the last message you received to poll for new ones.',
      }),
    ),
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 200, default: 200 }),
    ),
  },
  { $id: 'ListMessagesQuery' },
);

export const AppendMessagesBodySchema = Type.Object(
  {
    messages: Type.Array(
      Type.Object({
        kind: Type.Unsafe<TaskMessageKindType>(Type.Ref(TaskMessageKind.$id)),
        payload: Type.Record(Type.String(), Type.Unknown()),
        timestamp: Type.Optional(Type.String({ format: 'date-time' })),
      }),
      { minItems: 1 },
    ),
  },
  { $id: 'AppendMessagesBody' },
);

// ── Response schemas ─────────────────────────────────────────────────────────

export const TaskListResponseSchema = Type.Object(
  {
    items: Type.Array(Type.Ref(Task.$id)),
    total: Type.Integer({ minimum: 0 }),
    nextCursor: Type.Optional(Type.String()),
  },
  { $id: 'TaskListResponse' },
);

export const ClaimTaskResponseSchema = Type.Object(
  {
    task: Type.Ref(Task.$id),
    attempt: Type.Ref(TaskAttempt.$id),
  },
  { $id: 'ClaimTaskResponse' },
);

export const HeartbeatResponseSchema = Type.Object(
  {
    claimExpiresAt: Type.String({ format: 'date-time' }),
    // When true the proposer (or a diary writer) cancelled the task while
    // this attempt was running. The runtime should abort the executor
    // instead of continuing — finishing the work and calling /complete
    // will fail with 409 anyway, and any side effects after this point
    // are wasted (#938).
    cancelled: Type.Boolean(),
    cancelReason: Type.Union([Type.String(), Type.Null()]),
  },
  { $id: 'HeartbeatResponse' },
);

export const AppendMessagesResponseSchema = Type.Object(
  { count: Type.Integer({ minimum: 0 }) },
  { $id: 'AppendMessagesResponse' },
);

export const TaskTypeDescriptorSchema = Type.Object(
  {
    taskType: Type.String(),
    outputKind: Type.Union([
      Type.Literal('artifact'),
      Type.Literal('judgment'),
    ]),
    inputSchemaCid: Type.String(),
    // The embedded schema is arbitrary JSON Schema — we don't constrain
    // its shape here. Consumers parse it client-side to render forms or
    // validate inputs.
    inputSchema: Type.Record(Type.String(), Type.Unknown()),
  },
  { $id: 'TaskTypeDescriptor' },
);

export const ListTaskSchemasResponseSchema = Type.Object(
  {
    items: Type.Array(Type.Ref(TaskTypeDescriptorSchema.$id)),
  },
  { $id: 'ListTaskSchemasResponse' },
);

export const taskSchemas = [
  // Primitive enums first (no dependencies)
  TaskStatus,
  ClaimConditionDefinition,
  ExecutorTrustLevel,
  RuntimeProfileRef,
  TaskMessageKind,
  TaskRef,
  TaskUsage,
  TaskError,
  DaemonState,
  // Composite types
  Task,
  TaskAttempt,
  TaskMessage,
  // Route-specific schemas (may $ref the above)
  TaskParamsSchema,
  TaskAttemptParamsSchema,
  CreateTaskBodySchema,
  UpdateTaskMetadataBodySchema,
  BatchDeleteTasksBodySchema,
  ListTasksQuerySchema,
  ClaimTaskBodySchema,
  HeartbeatBodySchema,
  CompleteTaskBodySchema,
  FailTaskBodySchema,
  AbortTaskBodySchema,
  CancelTaskBodySchema,
  ListMessagesQuerySchema,
  AppendMessagesBodySchema,
  TaskListResponseSchema,
  ClaimTaskResponseSchema,
  HeartbeatResponseSchema,
  AppendMessagesResponseSchema,
  TaskTypeDescriptorSchema,
  ListTaskSchemasResponseSchema,
];
