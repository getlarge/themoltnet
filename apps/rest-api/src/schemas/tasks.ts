import {
  Task,
  TaskAttempt,
  TaskError,
  TaskMessage,
  TaskMessageKind,
  TaskRef,
  TaskStatus,
  TaskUsage,
} from '@moltnet/tasks';
import { Type } from '@sinclair/typebox';

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
    task_type: Type.String({ minLength: 1 }),
    team_id: Type.String({ format: 'uuid' }),
    diary_id: Type.String({ format: 'uuid' }),
    input: Type.Record(Type.String(), Type.Unknown()),
    references: Type.Optional(Type.Array(Type.Ref(TaskRef))),
    correlation_id: Type.Optional(Type.String({ format: 'uuid' })),
    max_attempts: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
    expires_in_sec: Type.Optional(Type.Integer({ minimum: 1 })),
    criteria_cid: Type.Optional(Type.String({ minLength: 1 })),
  },
  { $id: 'CreateTaskBody' },
);

export const ListTasksQuerySchema = Type.Object(
  {
    team_id: Type.String({ format: 'uuid' }),
    status: Type.Optional(Type.Ref(TaskStatus)),
    task_type: Type.Optional(Type.String()),
    correlation_id: Type.Optional(Type.String({ format: 'uuid' })),
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 100, default: 20 }),
    ),
    cursor: Type.Optional(Type.String()),
  },
  { $id: 'ListTasksQuery' },
);

export const ClaimTaskBodySchema = Type.Object(
  {
    lease_ttl_sec: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 3600, default: 300 }),
    ),
  },
  { $id: 'ClaimTaskBody' },
);

export const HeartbeatBodySchema = Type.Object(
  {
    lease_ttl_sec: Type.Optional(Type.Integer({ minimum: 1, maximum: 3600 })),
  },
  { $id: 'HeartbeatBody' },
);

export const CompleteTaskBodySchema = Type.Object(
  {
    output: Type.Record(Type.String(), Type.Unknown()),
    output_cid: Type.String({ minLength: 1 }),
    usage: Type.Ref(TaskUsage),
    content_signature: Type.Optional(Type.String()),
  },
  { $id: 'CompleteTaskBody' },
);

export const FailTaskBodySchema = Type.Object(
  {
    error: Type.Ref(TaskError),
  },
  { $id: 'FailTaskBody' },
);

export const CancelTaskBodySchema = Type.Object(
  {
    reason: Type.String({ minLength: 1 }),
  },
  { $id: 'CancelTaskBody' },
);

export const ListMessagesQuerySchema = Type.Object(
  {
    after_seq: Type.Optional(Type.Integer({ minimum: 0 })),
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
        kind: Type.Ref(TaskMessageKind),
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
    items: Type.Array(Type.Ref(Task)),
    total: Type.Integer({ minimum: 0 }),
    next_cursor: Type.Optional(Type.String()),
  },
  { $id: 'TaskListResponse' },
);

export const ClaimTaskResponseSchema = Type.Object(
  {
    task: Type.Ref(Task),
    attempt: Type.Ref(TaskAttempt),
  },
  { $id: 'ClaimTaskResponse' },
);

export const HeartbeatResponseSchema = Type.Object(
  {
    claim_expires_at: Type.String({ format: 'date-time' }),
  },
  { $id: 'HeartbeatResponse' },
);

export const AppendMessagesResponseSchema = Type.Object(
  { count: Type.Integer({ minimum: 0 }) },
  { $id: 'AppendMessagesResponse' },
);

export const taskSchemas = [
  // Primitive enums first (no dependencies)
  TaskStatus,
  TaskMessageKind,
  TaskRef,
  TaskUsage,
  TaskError,
  // Composite types
  Task,
  TaskAttempt,
  TaskMessage,
  // Route-specific schemas (may $ref the above)
  TaskParamsSchema,
  TaskAttemptParamsSchema,
  CreateTaskBodySchema,
  ListTasksQuerySchema,
  ClaimTaskBodySchema,
  HeartbeatBodySchema,
  CompleteTaskBodySchema,
  FailTaskBodySchema,
  CancelTaskBodySchema,
  ListMessagesQuerySchema,
  AppendMessagesBodySchema,
  TaskListResponseSchema,
  ClaimTaskResponseSchema,
  HeartbeatResponseSchema,
  AppendMessagesResponseSchema,
];
