import { type Static, Type } from 'typebox';

export const DaemonProfileName = Type.String({
  minLength: 1,
  maxLength: 100,
  pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$',
});
export type DaemonProfileName = Static<typeof DaemonProfileName>;

export const DaemonProfileEnvName = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Z_][A-Z0-9_]*$',
});
export type DaemonProfileEnvName = Static<typeof DaemonProfileEnvName>;

export const DaemonProfileToolName = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[a-zA-Z0-9._/-]+$',
});
export type DaemonProfileToolName = Static<typeof DaemonProfileToolName>;

const SandboxResumeCommandWhenSchema = Type.Object(
  {
    workspaceMode: Type.Optional(
      Type.Array(
        Type.Union([
          Type.Literal('shared_mount'),
          Type.Literal('dedicated_worktree'),
          Type.Literal('scratch_mount'),
        ]),
        { minItems: 1, maxItems: 3 },
      ),
    ),
  },
  { additionalProperties: false },
);

export const DaemonProfileSandboxResumeCommand = Type.Union([
  Type.String({ minLength: 1, maxLength: 4096 }),
  Type.Object(
    {
      run: Type.String({ minLength: 1, maxLength: 4096 }),
      when: Type.Optional(SandboxResumeCommandWhenSchema),
      retries: Type.Optional(Type.Integer({ minimum: 0, maximum: 5 })),
      retryBackoffMs: Type.Optional(
        Type.Integer({ minimum: 0, maximum: 60_000 }),
      ),
    },
    { additionalProperties: false },
  ),
]);
export type DaemonProfileSandboxResumeCommand = Static<
  typeof DaemonProfileSandboxResumeCommand
>;

export const DaemonProfileSandbox = Type.Object(
  {
    snapshot: Type.Optional(
      Type.Object(
        {
          setupCommands: Type.Optional(
            Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), {
              maxItems: 20,
            }),
          ),
          allowedHosts: Type.Optional(
            Type.Array(Type.String({ minLength: 1, maxLength: 255 }), {
              maxItems: 50,
            }),
          ),
          overlaySize: Type.Optional(
            Type.String({
              minLength: 2,
              maxLength: 16,
              pattern: '^[0-9]+[KMGTP]?$',
            }),
          ),
        },
        { additionalProperties: false },
      ),
    ),
    resumeCommands: Type.Optional(
      Type.Array(DaemonProfileSandboxResumeCommand, { maxItems: 30 }),
    ),
    vfs: Type.Optional(
      Type.Object(
        {
          shadow: Type.Optional(
            Type.Array(Type.String({ minLength: 1, maxLength: 255 }), {
              maxItems: 100,
            }),
          ),
          shadowMode: Type.Optional(
            Type.Union([Type.Literal('deny'), Type.Literal('tmpfs')]),
          ),
        },
        { additionalProperties: false },
      ),
    ),
    env: Type.Optional(
      Type.Record(DaemonProfileEnvName, Type.String({ maxLength: 4096 })),
    ),
    hostExec: Type.Optional(
      Type.Object(
        {
          autoApprove: Type.Optional(Type.Literal(false)),
        },
        { additionalProperties: false },
      ),
    ),
    resources: Type.Optional(
      Type.Object(
        {
          memory: Type.Optional(
            Type.String({
              minLength: 2,
              maxLength: 16,
              pattern: '^[0-9]+[KMG]?$',
            }),
          ),
          cpus: Type.Optional(Type.Integer({ minimum: 1, maximum: 32 })),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { $id: 'DaemonProfileSandbox', additionalProperties: false },
);
export type DaemonProfileSandbox = Static<typeof DaemonProfileSandbox>;

export const DaemonProfileContext = Type.Object(
  {
    slug: Type.String({
      minLength: 1,
      maxLength: 64,
      pattern: '^[a-zA-Z0-9_-]+$',
    }),
    binding: Type.Union([
      Type.Literal('skill'),
      Type.Literal('context_inline'),
      Type.Literal('prompt_prefix'),
      Type.Literal('user_inline'),
    ]),
    content: Type.String({ minLength: 1, maxLength: 65_536 }),
  },
  { $id: 'DaemonProfileContext', additionalProperties: false },
);
export type DaemonProfileContext = Static<typeof DaemonProfileContext>;

export const DaemonProfileRef = Type.Object(
  {
    profileId: Type.String({ format: 'uuid' }),
  },
  { $id: 'DaemonProfileRef', additionalProperties: false },
);
export type DaemonProfileRef = Static<typeof DaemonProfileRef>;

export const DaemonProfileLeaseTtlSec = Type.Integer({
  minimum: 1,
  maximum: 86_400,
});
export type DaemonProfileLeaseTtlSec = Static<typeof DaemonProfileLeaseTtlSec>;

export const DaemonProfileHeartbeatIntervalMs = Type.Integer({
  minimum: 0,
  maximum: 3_600_000,
});
export type DaemonProfileHeartbeatIntervalMs = Static<
  typeof DaemonProfileHeartbeatIntervalMs
>;

export const DaemonProfileMaxBatchSize = Type.Integer({
  minimum: 1,
  maximum: 1_000,
});
export type DaemonProfileMaxBatchSize = Static<
  typeof DaemonProfileMaxBatchSize
>;

export const DaemonProfile = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    teamId: Type.String({ format: 'uuid' }),
    name: DaemonProfileName,
    description: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]),
    provider: Type.String({ minLength: 1, maxLength: 100 }),
    model: Type.String({ minLength: 1, maxLength: 200 }),
    runtimeKind: Type.Literal('gondolin_pi'),
    sandbox: DaemonProfileSandbox,
    sessionStorageMode: Type.Literal('local'),
    workspaceStorageMode: Type.Literal('local'),
    sessionTtlSec: Type.Integer({ minimum: 1, maximum: 86_400 }),
    workspaceTtlSec: Type.Integer({ minimum: 1, maximum: 86_400 }),
    leaseTtlSec: DaemonProfileLeaseTtlSec,
    heartbeatIntervalMs: DaemonProfileHeartbeatIntervalMs,
    maxBatchSize: DaemonProfileMaxBatchSize,
    requiredEnv: Type.Array(DaemonProfileEnvName, { maxItems: 100 }),
    requiredTools: Type.Array(DaemonProfileToolName, { maxItems: 100 }),
    context: Type.Array(DaemonProfileContext, { maxItems: 5 }),
    revision: Type.Integer({ minimum: 1 }),
    definitionCid: Type.String({ minLength: 1, maxLength: 100 }),
    createdByAgentId: Type.Union([
      Type.String({ format: 'uuid' }),
      Type.Null(),
    ]),
    createdByHumanId: Type.Union([
      Type.String({ format: 'uuid' }),
      Type.Null(),
    ]),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'DaemonProfile', additionalProperties: false },
);
export type DaemonProfile = Static<typeof DaemonProfile>;
