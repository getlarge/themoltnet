import { type Static, Type } from 'typebox';

export const RuntimeProfileName = Type.String({
  minLength: 1,
  maxLength: 100,
  pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$',
});
export type RuntimeProfileName = Static<typeof RuntimeProfileName>;

export const RuntimeProfileEnvName = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Z_][A-Z0-9_]*$',
});
export type RuntimeProfileEnvName = Static<typeof RuntimeProfileEnvName>;

export const RuntimeProfileToolName = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[a-zA-Z0-9._/-]+$',
});
export type RuntimeProfileToolName = Static<typeof RuntimeProfileToolName>;

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

export const RuntimeProfileSandboxResumeCommand = Type.Union([
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
export type RuntimeProfileSandboxResumeCommand = Static<
  typeof RuntimeProfileSandboxResumeCommand
>;

export const RuntimeProfileSandbox = Type.Object(
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
      Type.Array(RuntimeProfileSandboxResumeCommand, { maxItems: 30 }),
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
      Type.Record(RuntimeProfileEnvName, Type.String({ maxLength: 4096 })),
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
  { $id: 'RuntimeProfileSandbox', additionalProperties: false },
);
export type RuntimeProfileSandbox = Static<typeof RuntimeProfileSandbox>;

export const RuntimeProfileContext = Type.Object(
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
  { $id: 'RuntimeProfileContext', additionalProperties: false },
);
export type RuntimeProfileContext = Static<typeof RuntimeProfileContext>;

export const RuntimeProfileRef = Type.Object(
  {
    profileId: Type.String({ format: 'uuid' }),
  },
  { $id: 'RuntimeProfileRef', additionalProperties: false },
);
export type RuntimeProfileRef = Static<typeof RuntimeProfileRef>;

export const RuntimeProfileLeaseTtlSec = Type.Integer({
  minimum: 1,
  maximum: 86_400,
});
export type RuntimeProfileLeaseTtlSec = Static<
  typeof RuntimeProfileLeaseTtlSec
>;

export const RuntimeProfileHeartbeatIntervalMs = Type.Integer({
  minimum: 0,
  maximum: 3_600_000,
});
export type RuntimeProfileHeartbeatIntervalMs = Static<
  typeof RuntimeProfileHeartbeatIntervalMs
>;

export const RuntimeProfileMaxBatchSize = Type.Integer({
  minimum: 1,
  maximum: 1_000,
});
export type RuntimeProfileMaxBatchSize = Static<
  typeof RuntimeProfileMaxBatchSize
>;

export const RuntimeProfile = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    teamId: Type.String({ format: 'uuid' }),
    name: RuntimeProfileName,
    description: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]),
    provider: Type.String({ minLength: 1, maxLength: 100 }),
    model: Type.String({ minLength: 1, maxLength: 200 }),
    runtimeKind: Type.Literal('gondolin_pi'),
    sandbox: RuntimeProfileSandbox,
    sessionStorageMode: Type.Literal('local'),
    workspaceStorageMode: Type.Literal('local'),
    sessionTtlSec: Type.Integer({ minimum: 1, maximum: 86_400 }),
    workspaceTtlSec: Type.Integer({ minimum: 1, maximum: 86_400 }),
    leaseTtlSec: RuntimeProfileLeaseTtlSec,
    heartbeatIntervalMs: RuntimeProfileHeartbeatIntervalMs,
    maxBatchSize: RuntimeProfileMaxBatchSize,
    requiredEnv: Type.Array(RuntimeProfileEnvName, { maxItems: 100 }),
    requiredTools: Type.Array(RuntimeProfileToolName, { maxItems: 100 }),
    context: Type.Array(RuntimeProfileContext, { maxItems: 5 }),
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
  { $id: 'RuntimeProfile', additionalProperties: false },
);
export type RuntimeProfile = Static<typeof RuntimeProfile>;
