import { Type } from 'typebox';

const ProfileName = Type.String({
  minLength: 1,
  maxLength: 100,
  pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$',
});

const EnvName = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Z_][A-Z0-9_]*$',
});

const ToolName = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[a-zA-Z0-9._/-]+$',
});

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

const SandboxResumeCommandSchema = Type.Union([
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

export const DaemonProfileSandboxSchema = Type.Object(
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
      Type.Array(SandboxResumeCommandSchema, { maxItems: 30 }),
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
    env: Type.Optional(Type.Record(EnvName, Type.String({ maxLength: 4096 }))),
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

export const DaemonProfileContextSchema = Type.Object(
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

export const DaemonProfileSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    teamId: Type.String({ format: 'uuid' }),
    name: ProfileName,
    description: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]),
    provider: Type.String({ minLength: 1, maxLength: 100 }),
    model: Type.String({ minLength: 1, maxLength: 200 }),
    runtimeKind: Type.Literal('gondolin_pi'),
    sandbox: DaemonProfileSandboxSchema,
    sessionStorageMode: Type.Literal('local'),
    workspaceStorageMode: Type.Literal('local'),
    sessionTtlSec: Type.Integer({ minimum: 1, maximum: 86_400 }),
    workspaceTtlSec: Type.Integer({ minimum: 1, maximum: 86_400 }),
    requiredEnv: Type.Array(EnvName, { maxItems: 100 }),
    requiredTools: Type.Array(ToolName, { maxItems: 100 }),
    context: Type.Array(DaemonProfileContextSchema, { maxItems: 5 }),
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

export const CreateDaemonProfileBodySchema = Type.Object(
  {
    name: ProfileName,
    description: Type.Optional(Type.String({ maxLength: 4096 })),
    provider: Type.String({ minLength: 1, maxLength: 100 }),
    model: Type.String({ minLength: 1, maxLength: 200 }),
    runtimeKind: Type.Optional(Type.Literal('gondolin_pi')),
    sandbox: DaemonProfileSandboxSchema,
    sessionStorageMode: Type.Optional(Type.Literal('local')),
    workspaceStorageMode: Type.Optional(Type.Literal('local')),
    sessionTtlSec: Type.Optional(Type.Integer({ minimum: 1, maximum: 86_400 })),
    workspaceTtlSec: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 86_400 }),
    ),
    requiredEnv: Type.Optional(Type.Array(EnvName, { maxItems: 100 })),
    requiredTools: Type.Optional(Type.Array(ToolName, { maxItems: 100 })),
    context: Type.Optional(
      Type.Array(DaemonProfileContextSchema, { maxItems: 5 }),
    ),
  },
  { $id: 'CreateDaemonProfileBody', additionalProperties: false },
);

export const UpdateDaemonProfileBodySchema = Type.Partial(
  CreateDaemonProfileBodySchema,
  {
    $id: 'UpdateDaemonProfileBody',
    additionalProperties: false,
    minProperties: 1,
  },
);

export const DaemonProfileListResponseSchema = Type.Object(
  {
    items: Type.Array(DaemonProfileSchema),
  },
  { $id: 'DaemonProfileListResponse' },
);

export const daemonProfileSchemas = [
  DaemonProfileSandboxSchema,
  DaemonProfileContextSchema,
  DaemonProfileSchema,
  CreateDaemonProfileBodySchema,
  UpdateDaemonProfileBodySchema,
  DaemonProfileListResponseSchema,
];
