import { type Static, Type } from 'typebox';

export const RuntimeWorkspaceKind = Type.Union([
  Type.Literal('origin'),
  Type.Literal('fork'),
  Type.Literal('scratch'),
]);
export type RuntimeWorkspaceKind = Static<typeof RuntimeWorkspaceKind>;

export const RuntimeSlotState = Type.Union([
  Type.Literal('active'),
  Type.Literal('idle'),
]);
export type RuntimeSlotState = Static<typeof RuntimeSlotState>;

export const RuntimeWorkspace = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    teamId: Type.String({ format: 'uuid' }),
    workspaceId: Type.String({ minLength: 1 }),
    worktreePath: Type.String({ minLength: 1 }),
    worktreeBranch: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    kind: RuntimeWorkspaceKind,
    createdAtMs: Type.Integer({ minimum: 0 }),
    lastUsedAtMs: Type.Integer({ minimum: 0 }),
  },
  { $id: 'RuntimeWorkspace' },
);
export type RuntimeWorkspace = Static<typeof RuntimeWorkspace>;

export const RuntimeSlot = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    teamId: Type.String({ format: 'uuid' }),
    agentName: Type.String({ minLength: 1, maxLength: 100 }),
    runtimeProfileId: Type.Union([
      Type.String({ format: 'uuid' }),
      Type.Null(),
    ]),
    provider: Type.String({ minLength: 1, maxLength: 100 }),
    model: Type.String({ minLength: 1, maxLength: 200 }),
    slotKey: Type.String({ minLength: 1 }),
    taskType: Type.String({ minLength: 1, maxLength: 100 }),
    state: RuntimeSlotState,
    lastTaskId: Type.String({ format: 'uuid' }),
    lastAttemptN: Type.Integer({ minimum: 1 }),
    sessionDir: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    sessionPath: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    workspaceRowId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    createdAtMs: Type.Integer({ minimum: 0 }),
    lastUsedAtMs: Type.Integer({ minimum: 0 }),
    expiresAtMs: Type.Integer({ minimum: 0 }),
  },
  { $id: 'RuntimeSlot' },
);
export type RuntimeSlot = Static<typeof RuntimeSlot>;

export const ResolvedRuntimeSlot = Type.Object(
  {
    slot: RuntimeSlot,
    workspace: Type.Union([RuntimeWorkspace, Type.Null()]),
  },
  { $id: 'ResolvedRuntimeSlot' },
);
export type ResolvedRuntimeSlot = Static<typeof ResolvedRuntimeSlot>;

export const BeginRuntimeSlotBody = Type.Object(
  {
    agentName: Type.String({ minLength: 1, maxLength: 100 }),
    runtimeProfileId: Type.String({ format: 'uuid' }),
    provider: Type.String({ minLength: 1, maxLength: 100 }),
    model: Type.String({ minLength: 1, maxLength: 200 }),
    slotKey: Type.String({ minLength: 1 }),
    taskType: Type.String({ minLength: 1, maxLength: 100 }),
    sessionDir: Type.Optional(Type.String({ minLength: 1 })),
    sessionPath: Type.Optional(Type.String({ minLength: 1 })),
    workspaceId: Type.Optional(Type.String({ minLength: 1 })),
    worktreePath: Type.Optional(Type.String({ minLength: 1 })),
    worktreeBranch: Type.Optional(Type.String({ minLength: 1 })),
    workspaceKind: Type.Optional(RuntimeWorkspaceKind),
    lastTaskId: Type.String({ format: 'uuid' }),
    lastAttemptN: Type.Integer({ minimum: 1 }),
  },
  { $id: 'BeginRuntimeSlotBody', additionalProperties: false },
);
export type BeginRuntimeSlotBody = Static<typeof BeginRuntimeSlotBody>;

export const FinishRuntimeSlotBody = Type.Object(
  {
    agentName: Type.String({ minLength: 1, maxLength: 100 }),
    runtimeProfileId: Type.String({ format: 'uuid' }),
    provider: Type.String({ minLength: 1, maxLength: 100 }),
    model: Type.String({ minLength: 1, maxLength: 200 }),
    slotKey: Type.String({ minLength: 1 }),
    taskId: Type.String({ format: 'uuid' }),
    attemptN: Type.Integer({ minimum: 1 }),
    sessionPath: Type.Optional(Type.String({ minLength: 1 })),
  },
  { $id: 'FinishRuntimeSlotBody', additionalProperties: false },
);
export type FinishRuntimeSlotBody = Static<typeof FinishRuntimeSlotBody>;

export const FindLatestRuntimeSlotForAttemptQuery = Type.Object(
  {
    taskId: Type.String({ format: 'uuid' }),
    attemptN: Type.Integer({ minimum: 1 }),
  },
  {
    $id: 'FindLatestRuntimeSlotForAttemptQuery',
    additionalProperties: false,
  },
);
export type FindLatestRuntimeSlotForAttemptQuery = Static<
  typeof FindLatestRuntimeSlotForAttemptQuery
>;

export const runtimeSlotSchemas = [
  RuntimeWorkspace,
  RuntimeSlot,
  ResolvedRuntimeSlot,
  BeginRuntimeSlotBody,
  FinishRuntimeSlotBody,
  FindLatestRuntimeSlotForAttemptQuery,
];
