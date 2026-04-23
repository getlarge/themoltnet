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
    taskType: Type.String({ minLength: 1 }),
    teamId: Type.String({ format: 'uuid' }),
    diaryId: Type.String({ format: 'uuid' }),
    input: Type.Record(Type.String(), Type.Unknown()),
    references: Type.Optional(Type.Array(Type.Ref(TaskRef))),
    correlationId: Type.Optional(Type.String({ format: 'uuid' })),
    maxAttempts: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
    expiresInSec: Type.Optional(Type.Integer({ minimum: 1 })),
    criteriaCid: Type.Optional(Type.String({ minLength: 1 })),
  },
  { $id: 'CreateTaskBody' },
);

export const ListTasksQuerySchema = Type.Object(
  {
    teamId: Type.String({ format: 'uuid' }),
    status: Type.Optional(Type.Ref(TaskStatus)),
    taskType: Type.Optional(Type.String()),
    correlationId: Type.Optional(Type.String({ format: 'uuid' })),
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
    usage: Type.Ref(TaskUsage),
    contentSignature: Type.Optional(Type.String()),
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
    nextCursor: Type.Optional(Type.String()),
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
    claimExpiresAt: Type.String({ format: 'date-time' }),
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
