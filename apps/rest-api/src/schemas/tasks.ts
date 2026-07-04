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
    force: Type.Optional(Type.Boolean({ default: false })),
    reason: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
  },
  { $id: 'BatchDeleteTasksBody', additionalProperties: false },
);

export const BatchDeleteTasksAcceptedResponseSchema = Type.Object(
  {
    workflowId: Type.Union([Type.String(), Type.Null()]),
    operationId: Type.String(),
    status: Type.Union([
      Type.Literal('queued'),
      Type.Literal('duplicate'),
      Type.Literal('noop'),
    ]),
    accepted: Type.Array(Type.String({ format: 'uuid' })),
    skipped: Type.Array(Type.String({ format: 'uuid' })),
  },
  { $id: 'BatchDeleteTasksAcceptedResponse' },
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

export const TaskActivityAnalyticsGroupBySchema = Type.Union(
  [
    Type.Literal('none'),
    Type.Literal('day'),
    Type.Literal('tag'),
    Type.Literal('taskType'),
    Type.Literal('profile'),
    Type.Literal('diary'),
    Type.Literal('agent'),
    Type.Literal('providerModel'),
  ],
  { $id: 'TaskActivityAnalyticsGroupBy' },
);

export const TaskActivityAnalyticsQuerySchema = Type.Object(
  {
    completedAfter: Type.Optional(Type.String({ format: 'date-time' })),
    completedBefore: Type.Optional(Type.String({ format: 'date-time' })),
    tags: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
        maxItems: 20,
        description: 'Repeated tags filter. Task must include all tags.',
      }),
    ),
    taskTypes: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), { maxItems: 20 }),
    ),
    profileIds: Type.Optional(
      Type.Array(Type.String({ format: 'uuid' }), { maxItems: 20 }),
    ),
    diaryIds: Type.Optional(
      Type.Array(Type.String({ format: 'uuid' }), { maxItems: 20 }),
    ),
    claimedByAgentIds: Type.Optional(
      Type.Array(Type.String({ format: 'uuid' }), { maxItems: 20 }),
    ),
    groupBy: Type.Optional(TaskActivityAnalyticsGroupBySchema),
  },
  { $id: 'TaskActivityAnalyticsQuery' },
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

const Rate = Type.Number({ minimum: 0, maximum: 1 });
const NullableNumber = Type.Union([Type.Number(), Type.Null()]);

export const TaskActivityProductMetricsSchema = Type.Object(
  {
    success: Type.Object(
      {
        taskCount: Type.Integer({ minimum: 0 }),
        acceptedTaskCount: Type.Integer({ minimum: 0 }),
        acceptedOutputRate: Type.Number({
          minimum: 0,
          maximum: 1,
          description:
            'Accepted task ratio: acceptedTaskCount / taskCount. Product intent: how often tasks produce accepted outputs.',
        }),
        firstAttemptAcceptedTaskCount: Type.Integer({ minimum: 0 }),
        firstAttemptAcceptedRate: Type.Number({
          minimum: 0,
          maximum: 1,
          description:
            'First-attempt success ratio. Product intent: how often work succeeds without retry friction.',
        }),
        retryRecoveredTaskCount: Type.Integer({ minimum: 0 }),
        retryRecoveryRate: Type.Number({
          minimum: 0,
          maximum: 1,
          description:
            'Retry recovery ratio. Product intent: how often retries turn failed first attempts into accepted work.',
        }),
        terminalFailureTaskCount: Type.Integer({ minimum: 0 }),
        terminalFailureRate: Rate,
      },
      {
        description:
          'Task success metrics: accepted output rate, first-attempt success, retry recovery, and terminal failure.',
      },
    ),
    productivity: Type.Object(
      {
        attemptCount: Type.Integer({ minimum: 0 }),
        acceptedTasksPerDay: Type.Number({ minimum: 0 }),
        averageAttemptsPerAcceptedTask: NullableNumber,
        medianTimeToAcceptedMs: NullableNumber,
        medianTurnsPerAttempt: NullableNumber,
        medianToolCallsPerAttempt: NullableNumber,
      },
      {
        description:
          'Productivity metrics: accepted task throughput and attempt/turn/tool-call effort required to finish work.',
      },
    ),
    hurdles: Type.Object(
      {
        failedAttemptCount: Type.Integer({ minimum: 0 }),
        timeoutAttemptCount: Type.Integer({ minimum: 0 }),
        abortedAttemptCount: Type.Integer({ minimum: 0 }),
        cancelledAttemptCount: Type.Integer({ minimum: 0 }),
        retryAttemptCount: Type.Integer({ minimum: 0 }),
        highFrictionAttemptCount: Type.Integer({
          minimum: 0,
          description:
            'Attempts with retry, failure, timeout, abort, cancellation, or failed tool-call friction.',
        }),
        failedToolCallCount: Type.Integer({ minimum: 0 }),
        failedToolCallRate: Type.Number({
          minimum: 0,
          maximum: 1,
          description:
            'Failed tool-call ratio. Product intent: surface tooling/runtime reliability drag.',
        }),
      },
      {
        description:
          'Hurdle metrics: failed, timed-out, aborted, cancelled, retry, high-friction, and tool-failure signals.',
      },
    ),
    knowledge: Type.Object(
      {
        knowledgeToolCallCount: Type.Integer({ minimum: 0 }),
        entrySearchCount: Type.Integer({ minimum: 0 }),
        entryGetCount: Type.Integer({ minimum: 0 }),
        packGetCount: Type.Integer({ minimum: 0 }),
        knowledgeCallsPerAcceptedTask: NullableNumber,
      },
      {
        description:
          'Knowledge leverage metrics: diary search/get and pack retrieval usage per accepted task.',
      },
    ),
    roi: Type.Object(
      {
        totalInputTokens: Type.Integer({ minimum: 0 }),
        totalOutputTokens: Type.Integer({ minimum: 0 }),
        totalTokens: Type.Integer({ minimum: 0 }),
        acceptedTasksPerThousandTokens: NullableNumber,
        tokensPerAcceptedTask: Type.Union([Type.Number(), Type.Null()], {
          description:
            'Token cost per accepted task. Product intent: ROI proxy for accepted work.',
        }),
        extraAttemptCount: Type.Integer({ minimum: 0 }),
        extraTokensBeforeAcceptance: Type.Integer({
          minimum: 0,
          description:
            'Tokens spent on attempts before the accepted attempt. Product intent: wasted retry cost.',
        }),
      },
      {
        description:
          'Token-efficiency ROI metrics: token totals, accepted work per token, tokens per accepted task, and retry waste.',
      },
    ),
    raw: Type.Object({
      messageCount: Type.Integer({ minimum: 0 }),
      turnCount: Type.Integer({ minimum: 0 }),
      toolCallCount: Type.Integer({ minimum: 0 }),
      failedToolCallCount: Type.Integer({ minimum: 0 }),
    }),
  },
  { $id: 'TaskActivityProductMetrics' },
);

export const TaskActivityAnalyticsResponseSchema = Type.Object(
  {
    range: Type.Object({
      completedAfter: Type.String({ format: 'date-time' }),
      completedBefore: Type.String({ format: 'date-time' }),
    }),
    statsComplete: Type.Boolean(),
    overall: Type.Ref(TaskActivityProductMetricsSchema.$id),
    groups: Type.Array(
      Type.Object({
        key: Type.String(),
        label: Type.String(),
        metrics: Type.Ref(TaskActivityProductMetricsSchema.$id),
      }),
    ),
  },
  { $id: 'TaskActivityAnalyticsResponse' },
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
  BatchDeleteTasksAcceptedResponseSchema,
  ListTasksQuerySchema,
  TaskActivityAnalyticsGroupBySchema,
  TaskActivityAnalyticsQuerySchema,
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
  TaskActivityProductMetricsSchema,
  TaskActivityAnalyticsResponseSchema,
  TaskTypeDescriptorSchema,
  ListTaskSchemasResponseSchema,
];
