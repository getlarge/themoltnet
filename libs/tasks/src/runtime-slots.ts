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

export const RuntimeSlotSession = Type.Object(
  {
    slotId: Type.String({ format: 'uuid' }),
    sessionDir: Type.String({ minLength: 1 }),
    sessionPath: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  },
  { $id: 'RuntimeSlotSession' },
);
export type RuntimeSlotSession = Static<typeof RuntimeSlotSession>;

export const RuntimeSlot = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    teamId: Type.String({ format: 'uuid' }),
    daemonId: Type.String({ minLength: 1, maxLength: 200 }),
    agentName: Type.String({ minLength: 1, maxLength: 100 }),
    daemonProfileId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    provider: Type.String({ minLength: 1, maxLength: 100 }),
    model: Type.String({ minLength: 1, maxLength: 200 }),
    slotKey: Type.String({ minLength: 1 }),
    taskType: Type.String({ minLength: 1, maxLength: 100 }),
    state: RuntimeSlotState,
    lastTaskId: Type.String({ format: 'uuid' }),
    lastAttemptN: Type.Integer({ minimum: 1 }),
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
    session: Type.Union([RuntimeSlotSession, Type.Null()]),
    workspace: Type.Union([RuntimeWorkspace, Type.Null()]),
  },
  { $id: 'ResolvedRuntimeSlot' },
);
export type ResolvedRuntimeSlot = Static<typeof ResolvedRuntimeSlot>;

export const BeginRuntimeSlotBody = Type.Object(
  {
    daemonId: Type.String({ minLength: 1, maxLength: 200 }),
    agentName: Type.String({ minLength: 1, maxLength: 100 }),
    daemonProfileId: Type.Optional(Type.String({ format: 'uuid' })),
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
    ttlSec: Type.Integer({ minimum: 1, maximum: 86_400 }),
  },
  { $id: 'BeginRuntimeSlotBody', additionalProperties: false },
);
export type BeginRuntimeSlotBody = Static<typeof BeginRuntimeSlotBody>;

export const FinishRuntimeSlotBody = Type.Object(
  {
    daemonId: Type.String({ minLength: 1, maxLength: 200 }),
    agentName: Type.String({ minLength: 1, maxLength: 100 }),
    provider: Type.String({ minLength: 1, maxLength: 100 }),
    model: Type.String({ minLength: 1, maxLength: 200 }),
    slotKey: Type.String({ minLength: 1 }),
    taskId: Type.String({ format: 'uuid' }),
    attemptN: Type.Integer({ minimum: 1 }),
    ttlSec: Type.Integer({ minimum: 1, maximum: 86_400 }),
    sessionPath: Type.Optional(Type.String({ minLength: 1 })),
  },
  { $id: 'FinishRuntimeSlotBody', additionalProperties: false },
);
export type FinishRuntimeSlotBody = Static<typeof FinishRuntimeSlotBody>;

export const FindRuntimeProducerSlotQuery = Type.Object(
  {
    taskId: Type.String({ format: 'uuid' }),
    attemptN: Type.Integer({ minimum: 1 }),
  },
  { $id: 'FindRuntimeProducerSlotQuery', additionalProperties: false },
);
export type FindRuntimeProducerSlotQuery = Static<
  typeof FindRuntimeProducerSlotQuery
>;

export const runtimeSlotSchemas = [
  RuntimeWorkspace,
  RuntimeSlotSession,
  RuntimeSlot,
  ResolvedRuntimeSlot,
  BeginRuntimeSlotBody,
  FinishRuntimeSlotBody,
  FindRuntimeProducerSlotQuery,
];
