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

export const RuntimeProfile = Type.Object(
  {
    definitionVersion: Type.Integer({ minimum: 1, maximum: 2 }),
    id: Type.String({ format: 'uuid' }),
    teamId: Type.String({ format: 'uuid' }),
    name: RuntimeProfileName,
    description: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]),
    provider: Type.String({ minLength: 1, maxLength: 100 }),
    model: Type.String({ minLength: 1, maxLength: 200 }),
    thinkingLevel: RuntimeProfileNullableThinkingLevel,
    temperature: RuntimeProfileNullableTemperature,
    topP: RuntimeProfileNullableTopP,
    topK: RuntimeProfileNullableTopK,
    maxOutputTokens: RuntimeProfileNullableMaxOutputTokens,
    runtimeKind: RuntimeProfileRuntimeKind,
    sandbox: RuntimeProfileSandbox,
    sessionStorageMode: Type.Literal('local'),
    workspaceStorageMode: Type.Literal('local'),
    defaultWorkspaceMode: Type.Union([
      RuntimeProfileWorkspaceMode,
      Type.Null(),
    ]),
    allowedWorkspaceModes: RuntimeProfileAllowedWorkspaceModes,
    sessionTtlSec: Type.Integer({ minimum: 1, maximum: 86_400 }),
    workspaceTtlSec: Type.Integer({ minimum: 1, maximum: 86_400 }),
    leaseTtlSec: RuntimeProfileLeaseTtlSec,
    heartbeatIntervalMs: RuntimeProfileHeartbeatIntervalMs,
    maxBatchSize: RuntimeProfileMaxBatchSize,
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

export interface RuntimeProfileDefinitionV2Input {
  name: string;
  description?: string | null;
  provider: string;
  model: string;
  thinkingLevel?: string | null;
  temperature?: number | null;
  topP?: number | null;
  topK?: number | null;
  maxOutputTokens?: number | null;
  runtimeKind?: string;
  sandbox: unknown;
  sessionStorageMode?: 'local';
  workspaceStorageMode?: 'local';
  defaultWorkspaceMode?: string | null;
  allowedWorkspaceModes?: string[];
  sessionTtlSec?: number;
  workspaceTtlSec?: number;
  leaseTtlSec?: number;
  heartbeatIntervalMs?: number;
  maxBatchSize?: number;
  maxTurns?: number;
  maxBashTimeouts?: number;
  requiredEnv?: string[];
  requiredTools?: string[];
  requiredExecutables?: string[];
  context?: unknown[];
}

/** Canonical behavioral payload hashed into a runtime profile v2 CID. */
export function runtimeProfileDefinitionV2Payload(
  input: RuntimeProfileDefinitionV2Input,
): Record<string, unknown> {
  const list = (values: readonly string[] | undefined) =>
    [
      ...new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
    ].sort();
  return {
    v: 'moltnet:runtime-profile:v2',
    name: input.name,
    description: input.description ?? null,
    provider: input.provider.toLowerCase(),
    model: input.model.toLowerCase(),
    thinkingLevel: input.thinkingLevel ?? null,
    temperature: input.temperature ?? null,
    topP: input.topP ?? null,
    topK: input.topK ?? null,
    maxOutputTokens: input.maxOutputTokens ?? null,
    runtimeKind: input.runtimeKind ?? 'gondolin_pi',
    sandbox: input.sandbox,
    sessionStorageMode: input.sessionStorageMode ?? 'local',
    workspaceStorageMode: input.workspaceStorageMode ?? 'local',
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
    sessionTtlSec: input.sessionTtlSec ?? 1800,
    workspaceTtlSec: input.workspaceTtlSec ?? 1800,
    leaseTtlSec: input.leaseTtlSec ?? 300,
    heartbeatIntervalMs: input.heartbeatIntervalMs ?? 60_000,
    maxBatchSize: input.maxBatchSize ?? 50,
    maxTurns: input.maxTurns ?? 0,
    maxBashTimeouts: input.maxBashTimeouts ?? 3,
    requiredEnv: list(input.requiredEnv),
    requiredTools: list(input.requiredTools),
    requiredExecutables: list(input.requiredExecutables),
    context: input.context ?? [],
  };
}
