import { Type } from 'typebox';

const DaemonRuntimeWorkspaceKind = Type.Union([
  Type.Literal('origin'),
  Type.Literal('fork'),
  Type.Literal('scratch'),
]);

const DaemonRuntimeSlotState = Type.Union([
  Type.Literal('active'),
  Type.Literal('idle'),
]);

export const DaemonRuntimeWorkspaceSchema = Type.Object(
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

export const DaemonRuntimeSlotSessionSchema = Type.Object(
  {
    slotId: Type.String({ format: 'uuid' }),
    sessionDir: Type.String({ minLength: 1 }),
    sessionPath: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  },
  { $id: 'DaemonRuntimeSlotSession' },
);

export const DaemonRuntimeSlotSchema = Type.Object(
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

export const ResolvedDaemonRuntimeSlotSchema = Type.Object(
  {
    slot: Type.Ref(DaemonRuntimeSlotSchema.$id),
    session: Type.Union([
      Type.Ref(DaemonRuntimeSlotSessionSchema.$id),
      Type.Null(),
    ]),
    workspace: Type.Union([
      Type.Ref(DaemonRuntimeWorkspaceSchema.$id),
      Type.Null(),
    ]),
  },
  { $id: 'ResolvedDaemonRuntimeSlot' },
);

export const BeginDaemonRuntimeSlotBodySchema = Type.Object(
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

export const FinishDaemonRuntimeSlotBodySchema = Type.Object(
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

export const FindDaemonRuntimeProducerSlotQuerySchema = Type.Object(
  {
    teamId: Type.String({ format: 'uuid' }),
    taskId: Type.String({ format: 'uuid' }),
    attemptN: Type.Integer({ minimum: 1 }),
  },
  { $id: 'FindDaemonRuntimeProducerSlotQuery', additionalProperties: false },
);

export const daemonRuntimeSlotSchemas = [
  DaemonRuntimeWorkspaceSchema,
  DaemonRuntimeSlotSessionSchema,
  DaemonRuntimeSlotSchema,
  ResolvedDaemonRuntimeSlotSchema,
  BeginDaemonRuntimeSlotBodySchema,
  FinishDaemonRuntimeSlotBodySchema,
  FindDaemonRuntimeProducerSlotQuerySchema,
];
