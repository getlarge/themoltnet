import { type Static, Type } from 'typebox';

export const TaskArtifact = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    teamId: Type.String({ format: 'uuid' }),
    taskId: Type.String({ format: 'uuid' }),
    attemptN: Type.Integer({ minimum: 1 }),
    kind: Type.String({ minLength: 1, maxLength: 100 }),
    title: Type.String({ minLength: 1, maxLength: 255 }),
    contentType: Type.String({ minLength: 1, maxLength: 200 }),
    contentEncoding: Type.Union([
      Type.String({ minLength: 1, maxLength: 100 }),
      Type.Null(),
    ]),
    sizeBytes: Type.Integer({ minimum: 0 }),
    cid: Type.String({ minLength: 1, maxLength: 100 }),
    createdByAgentId: Type.String({ format: 'uuid' }),
    expiresAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    createdAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'TaskArtifact' },
);
export type TaskArtifact = Static<typeof TaskArtifact>;

export const TaskArtifactList = Type.Object(
  {
    artifacts: Type.Array(TaskArtifact),
    nextCursor: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  },
  { $id: 'TaskArtifactList' },
);
export type TaskArtifactList = Static<typeof TaskArtifactList>;

export const ListTaskArtifactsQuery = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    cursor: Type.Optional(Type.String({ minLength: 1 })),
  },
  { $id: 'ListTaskArtifactsQuery', additionalProperties: false },
);
export type ListTaskArtifactsQuery = Static<typeof ListTaskArtifactsQuery>;

export const UploadTaskArtifactQuery = Type.Object(
  {
    kind: Type.String({ minLength: 1, maxLength: 100 }),
    title: Type.String({ minLength: 1, maxLength: 255 }),
    contentType: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    contentEncoding: Type.Optional(
      Type.String({ minLength: 1, maxLength: 100 }),
    ),
  },
  { $id: 'UploadTaskArtifactQuery', additionalProperties: false },
);
export type UploadTaskArtifactQuery = Static<typeof UploadTaskArtifactQuery>;

export const TaskArtifactContent = Type.String({
  $id: 'TaskArtifactContent',
  description: 'Task artifact content stream.',
  format: 'binary',
});
export type TaskArtifactContent = Static<typeof TaskArtifactContent>;

export const TaskArtifactTaskParams = Type.Object(
  {
    taskId: Type.String({ format: 'uuid' }),
  },
  {
    $id: 'TaskArtifactTaskParams',
    additionalProperties: false,
  },
);
export type TaskArtifactTaskParams = Static<typeof TaskArtifactTaskParams>;

export const TaskArtifactAttemptParams = Type.Object(
  {
    taskId: Type.String({ format: 'uuid' }),
    attemptN: Type.Integer({ minimum: 1 }),
  },
  {
    $id: 'TaskArtifactAttemptParams',
    additionalProperties: false,
  },
);
export type TaskArtifactAttemptParams = Static<
  typeof TaskArtifactAttemptParams
>;

export const TaskArtifactContentParams = Type.Object(
  {
    taskId: Type.String({ format: 'uuid' }),
    attemptN: Type.Integer({ minimum: 1 }),
    cid: Type.String({ minLength: 1, maxLength: 100 }),
  },
  {
    $id: 'TaskArtifactContentParams',
    additionalProperties: false,
  },
);
export type TaskArtifactContentParams = Static<
  typeof TaskArtifactContentParams
>;

export const taskArtifactSchemas = [
  TaskArtifact,
  TaskArtifactList,
  ListTaskArtifactsQuery,
  UploadTaskArtifactQuery,
  TaskArtifactContent,
  TaskArtifactTaskParams,
  TaskArtifactAttemptParams,
  TaskArtifactContentParams,
];
