import { type ToolEnforcement, ToolEnforcementSchema } from '@moltnet/models';
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

export const RUNTIME_PROFILE_RUNTIME_KIND_PATTERN = '^[a-z][a-z0-9._-]{0,99}$';
export const RUNTIME_PROFILE_RUNTIME_KIND_REGEXP = new RegExp(
  RUNTIME_PROFILE_RUNTIME_KIND_PATTERN,
);

export const RuntimeProfileRuntimeKind = Type.String({
  minLength: 1,
  maxLength: 100,
  pattern: RUNTIME_PROFILE_RUNTIME_KIND_PATTERN,
});
export type RuntimeProfileRuntimeKind = Static<
  typeof RuntimeProfileRuntimeKind
>;

export const RuntimeProfileWorkspaceMode = Type.Union([
  Type.Literal('none'),
  Type.Literal('shared_mount'),
  Type.Literal('dedicated_worktree'),
]);
export type RuntimeProfileWorkspaceMode = Static<
  typeof RuntimeProfileWorkspaceMode
>;

/**
 * Tool-policy enforcement mode for the profile's runtime `tool_call` gate:
 * `off` (inert), `watch` (audit only), `enforce` (block disallowed tools,
 * fail-closed). Read by the daemon via `GET /runtime-profiles/:id/allowed-tools`.
 */
export const RuntimeProfileToolEnforcement = ToolEnforcementSchema;
export type RuntimeProfileToolEnforcement = ToolEnforcement;

export const RuntimeProfileAllowedWorkspaceModes = Type.Array(
  RuntimeProfileWorkspaceMode,
  {
    minItems: 1,
    maxItems: 3,
    uniqueItems: true,
  },
);
export type RuntimeProfileAllowedWorkspaceModes = Static<
  typeof RuntimeProfileAllowedWorkspaceModes
>;

const RuntimeProfileThinkingLevelOptions = [
  Type.Literal('off'),
  Type.Literal('minimal'),
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
  Type.Literal('xhigh'),
] as const;

export const RuntimeProfileThinkingLevel = Type.Union([
  ...RuntimeProfileThinkingLevelOptions,
]);
export type RuntimeProfileThinkingLevel = Static<
  typeof RuntimeProfileThinkingLevel
>;

export const RuntimeProfileNullableThinkingLevel = Type.Union([
  ...RuntimeProfileThinkingLevelOptions,
  Type.Null(),
]);

export const RuntimeProfileNullableTemperature = Type.Union([
  Type.Null(),
  Type.Number({ minimum: 0, maximum: 2 }),
]);
export type RuntimeProfileNullableTemperature = Static<
  typeof RuntimeProfileNullableTemperature
>;

export const RuntimeProfileNullableTopP = Type.Union([
  Type.Null(),
  Type.Number({ minimum: 0, maximum: 1 }),
]);
export type RuntimeProfileNullableTopP = Static<
  typeof RuntimeProfileNullableTopP
>;

export const RuntimeProfileNullableTopK = Type.Union([
  Type.Integer({ minimum: 1, maximum: 10_000 }),
  Type.Null(),
]);
export type RuntimeProfileNullableTopK = Static<
  typeof RuntimeProfileNullableTopK
>;

export const RuntimeProfileNullableMaxOutputTokens = Type.Union([
  Type.Integer({ minimum: 1, maximum: 1_000_000 }),
  Type.Null(),
]);
export type RuntimeProfileNullableMaxOutputTokens = Static<
  typeof RuntimeProfileNullableMaxOutputTokens
>;

export const RuntimeProfileAllowedHost = Type.String({
  minLength: 1,
  maxLength: 255,
  pattern:
    '^(?:\\*\\.)?(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$',
});
export type RuntimeProfileAllowedHost = Static<
  typeof RuntimeProfileAllowedHost
>;

export const RuntimeProfileSandbox = Type.Object(
  {
    network: Type.Optional(
      Type.Object(
        {
          allowedHosts: Type.Optional(
            Type.Array(RuntimeProfileAllowedHost, { maxItems: 50 }),
          ),
          allowedInternalHosts: Type.Optional(
            Type.Array(RuntimeProfileAllowedHost, { maxItems: 50 }),
          ),
        },
        { additionalProperties: false },
      ),
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

export const RuntimeProfileMaxTurns = Type.Integer({
  minimum: 0,
  maximum: 10_000,
});
export type RuntimeProfileMaxTurns = Static<typeof RuntimeProfileMaxTurns>;

export const RuntimeProfileMaxBashTimeouts = Type.Integer({
  minimum: 0,
  maximum: 1_000,
});
export type RuntimeProfileMaxBashTimeouts = Static<
  typeof RuntimeProfileMaxBashTimeouts
>;

export const RuntimeProfileModelSelection = Type.Object(
  {
    provider: Type.String({ minLength: 1, maxLength: 100 }),
    model: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);
export type RuntimeProfileModelSelection = Static<
  typeof RuntimeProfileModelSelection
>;

export const RuntimeProfileGeneration = Type.Object(
  {
    ...RuntimeProfileModelSelection.properties,
    thinkingLevel: Type.Optional(RuntimeProfileNullableThinkingLevel),
    temperature: Type.Optional(RuntimeProfileNullableTemperature),
    topP: Type.Optional(RuntimeProfileNullableTopP),
    topK: Type.Optional(RuntimeProfileNullableTopK),
    maxOutputTokens: Type.Optional(RuntimeProfileNullableMaxOutputTokens),
  },
  { additionalProperties: false },
);
export type RuntimeProfileGeneration = Static<typeof RuntimeProfileGeneration>;

export const RuntimeProfileModels = Type.Object(
  {
    generation: Type.Optional(RuntimeProfileGeneration),
    classification: Type.Optional(RuntimeProfileModelSelection),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type RuntimeProfileModels = Static<typeof RuntimeProfileModels>;

/** Select a task capability, or describe a profile before a task is selected. */
export function runtimeProfileModel(
  models: RuntimeProfileModels,
  taskType?: string,
): RuntimeProfileModelSelection {
  const model =
    taskType === undefined
      ? (models.generation ?? models.classification)
      : taskType === 'classify'
        ? models.classification
        : models.generation;
  if (!model)
    throw new Error(
      `Runtime profile has no ${taskType === 'classify' ? 'classification' : 'generation'} model configured`,
    );
  return model;
}

export function normalizeRuntimeProfileModels(
  models: RuntimeProfileModels,
): RuntimeProfileModels {
  const selection = (value: RuntimeProfileModelSelection) => ({
    provider: value.provider.toLowerCase(),
    model: value.model.toLowerCase(),
  });
  return {
    ...(models.generation
      ? {
          generation: {
            ...selection(models.generation),
            thinkingLevel: models.generation.thinkingLevel ?? null,
            temperature: models.generation.temperature ?? null,
            topP: models.generation.topP ?? null,
            topK: models.generation.topK ?? null,
            maxOutputTokens: models.generation.maxOutputTokens ?? null,
          },
        }
      : {}),
    ...(models.classification
      ? { classification: selection(models.classification) }
      : {}),
  };
}

export const RuntimeProfile = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    teamId: Type.String({ format: 'uuid' }),
    name: RuntimeProfileName,
    description: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]),
    models: RuntimeProfileModels,
    runtimeKind: RuntimeProfileRuntimeKind,
    sandbox: RuntimeProfileSandbox,
    defaultWorkspaceMode: Type.Union([
      RuntimeProfileWorkspaceMode,
      Type.Null(),
    ]),
    allowedWorkspaceModes: RuntimeProfileAllowedWorkspaceModes,
    maxTurns: RuntimeProfileMaxTurns,
    maxBashTimeouts: RuntimeProfileMaxBashTimeouts,
    toolEnforcement: RuntimeProfileToolEnforcement,
    requiredEnv: Type.Array(RuntimeProfileEnvName, { maxItems: 100 }),
    requiredTools: Type.Array(RuntimeProfileToolName, { maxItems: 100 }),
    requiredExecutables: Type.Array(RuntimeProfileToolName, { maxItems: 100 }),
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

export interface RuntimeProfileDefinitionInput {
  name: string;
  description?: string | null;
  models: RuntimeProfileModels;
  runtimeKind?: string;
  sandbox: unknown;
  defaultWorkspaceMode?: RuntimeProfileWorkspaceMode | null;
  allowedWorkspaceModes?: RuntimeProfileWorkspaceMode[];
  maxTurns?: number;
  maxBashTimeouts?: number;
  toolEnforcement?: RuntimeProfileToolEnforcement;
  requiredEnv?: string[];
  requiredTools?: string[];
  requiredExecutables?: string[];
  context?: unknown[];
}

/** Canonical behavioral payload hashed into a runtime profile CID. */
export function runtimeProfileDefinitionPayload(
  input: RuntimeProfileDefinitionInput,
): Record<string, unknown> {
  const list = (values: readonly string[] | undefined) =>
    [
      ...new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
    ].sort();
  const models = normalizeRuntimeProfileModels(input.models);
  // Preserve the v1 behavioral hash when only the public configuration shape changes.
  // Existing task/slot references must retain their profile identity after migration.
  const generation = models.generation;
  return {
    kind: 'moltnet:runtime-profile',
    name: input.name,
    description: input.description ?? null,
    provider: generation?.provider,
    model: generation?.model,
    ...(models.classification ? { classifier: models.classification } : {}),
    thinkingLevel: generation?.thinkingLevel ?? null,
    temperature: generation?.temperature ?? null,
    topP: generation?.topP ?? null,
    topK: generation?.topK ?? null,
    maxOutputTokens: generation?.maxOutputTokens ?? null,
    runtimeKind: input.runtimeKind ?? 'gondolin_pi',
    sandbox: input.sandbox,
    defaultWorkspaceMode: input.defaultWorkspaceMode ?? null,
    allowedWorkspaceModes: [
      ...new Set(
        input.allowedWorkspaceModes ?? [
          'none',
          'shared_mount',
          'dedicated_worktree',
        ],
      ),
    ],
    maxTurns: input.maxTurns ?? 0,
    maxBashTimeouts: input.maxBashTimeouts ?? 3,
    toolEnforcement: input.toolEnforcement ?? 'off',
    requiredEnv: list(input.requiredEnv),
    requiredTools: list(input.requiredTools),
    requiredExecutables: list(input.requiredExecutables),
    context: input.context ?? [],
  };
}
