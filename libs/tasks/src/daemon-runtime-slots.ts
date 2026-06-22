import { type Static, Type } from 'typebox';

export const DaemonRuntimeWorkspaceKind = Type.Union([
  Type.Literal('origin'),
  Type.Literal('fork'),
  Type.Literal('scratch'),
]);
export type DaemonRuntimeWorkspaceKind = Static<
  typeof DaemonRuntimeWorkspaceKind
>;

export const DaemonRuntimeSlotState = Type.Union([
  Type.Literal('active'),
  Type.Literal('idle'),
]);
export type DaemonRuntimeSlotState = Static<typeof DaemonRuntimeSlotState>;

export const DaemonRuntimeWorkspace = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    teamId: Type.String({ format: 'uuid' }),
    workspaceId: Type.String({ minLength: 1 }),
    worktreePath: Type.String({ minLength: 1 }),
    worktreeBranch: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    kind: DaemonRuntimeWorkspaceKind,
    createdAtMs: Type.Integer({ minimum: 0 }),
    lastUsedAtMs: Type.Integer({ minimum: 0 }),
  },
  { $id: 'DaemonRuntimeWorkspace' },
);
export type DaemonRuntimeWorkspace = Static<typeof DaemonRuntimeWorkspace>;

export const DaemonRuntimeSlotSession = Type.Object(
  {
    slotId: Type.String({ format: 'uuid' }),
    sessionDir: Type.String({ minLength: 1 }),
    sessionPath: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  },
  { $id: 'DaemonRuntimeSlotSession' },
);
export type DaemonRuntimeSlotSession = Static<typeof DaemonRuntimeSlotSession>;

export const DaemonRuntimeSlot = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    teamId: Type.String({ format: 'uuid' }),
    daemonId: Type.String({ minLength: 1, maxLength: 200 }),
    agentName: Type.String({ minLength: 1, maxLength: 100 }),
    agentIdentityId: Type.String({ format: 'uuid' }),
    daemonProfileId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    provider: Type.String({ minLength: 1, maxLength: 100 }),
    model: Type.String({ minLength: 1, maxLength: 200 }),
    slotKey: Type.String({ minLength: 1 }),
    taskType: Type.String({ minLength: 1, maxLength: 100 }),
    state: DaemonRuntimeSlotState,
    lastTaskId: Type.String({ format: 'uuid' }),
    lastAttemptN: Type.Integer({ minimum: 1 }),
    workspaceRowId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    createdAtMs: Type.Integer({ minimum: 0 }),
    lastUsedAtMs: Type.Integer({ minimum: 0 }),
    expiresAtMs: Type.Integer({ minimum: 0 }),
  },
  { $id: 'DaemonRuntimeSlot' },
);
export type DaemonRuntimeSlot = Static<typeof DaemonRuntimeSlot>;

export const ResolvedDaemonRuntimeSlot = Type.Object(
  {
    slot: Type.Unsafe<DaemonRuntimeSlot>(Type.Ref('DaemonRuntimeSlot')),
    session: Type.Union([
      Type.Unsafe<DaemonRuntimeSlotSession>(
        Type.Ref('DaemonRuntimeSlotSession'),
      ),
      Type.Null(),
    ]),
    workspace: Type.Union([
      Type.Unsafe<DaemonRuntimeWorkspace>(Type.Ref('DaemonRuntimeWorkspace')),
      Type.Null(),
    ]),
  },
  { $id: 'ResolvedDaemonRuntimeSlot' },
);
export type ResolvedDaemonRuntimeSlot = Static<
  typeof ResolvedDaemonRuntimeSlot
>;

export const BeginDaemonRuntimeSlotBody = Type.Object(
  {
    teamId: Type.String({ format: 'uuid' }),
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
    workspaceKind: Type.Optional(DaemonRuntimeWorkspaceKind),
    lastTaskId: Type.String({ format: 'uuid' }),
    lastAttemptN: Type.Integer({ minimum: 1 }),
    ttlSec: Type.Integer({ minimum: 1, maximum: 86_400 }),
  },
  { $id: 'BeginDaemonRuntimeSlotBody', additionalProperties: false },
);
export type BeginDaemonRuntimeSlotBody = Static<
  typeof BeginDaemonRuntimeSlotBody
>;

export const FinishDaemonRuntimeSlotBody = Type.Object(
  {
    teamId: Type.String({ format: 'uuid' }),
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
  { $id: 'FinishDaemonRuntimeSlotBody', additionalProperties: false },
);
export type FinishDaemonRuntimeSlotBody = Static<
  typeof FinishDaemonRuntimeSlotBody
>;

export const FindDaemonRuntimeProducerSlotQuery = Type.Object(
  {
    teamId: Type.String({ format: 'uuid' }),
    taskId: Type.String({ format: 'uuid' }),
    attemptN: Type.Integer({ minimum: 1 }),
  },
  { $id: 'FindDaemonRuntimeProducerSlotQuery', additionalProperties: false },
);
export type FindDaemonRuntimeProducerSlotQuery = Static<
  typeof FindDaemonRuntimeProducerSlotQuery
>;

export const daemonRuntimeSlotSchemas = [
  DaemonRuntimeWorkspace,
  DaemonRuntimeSlotSession,
  DaemonRuntimeSlot,
  ResolvedDaemonRuntimeSlot,
  BeginDaemonRuntimeSlotBody,
  FinishDaemonRuntimeSlotBody,
  FindDaemonRuntimeProducerSlotQuery,
];
