import {
  RuntimeProfile,
  RuntimeProfileAllowedWorkspaceModes,
  RuntimeProfileContext,
  RuntimeProfileEnvName,
  RuntimeProfileHeartbeatIntervalMs,
  RuntimeProfileLeaseTtlSec,
  RuntimeProfileMaxBashTimeouts,
  RuntimeProfileMaxBatchSize,
  RuntimeProfileMaxTurns,
  RuntimeProfileName,
  RuntimeProfileSandbox,
  RuntimeProfileToolName,
  RuntimeProfileWorkspaceMode,
} from '@moltnet/tasks';
import { Type } from 'typebox';

export const CreateRuntimeProfileBodySchema = Type.Object(
  {
    name: RuntimeProfileName,
    description: Type.Optional(Type.String({ maxLength: 4096 })),
    provider: Type.String({ minLength: 1, maxLength: 100 }),
    model: Type.String({ minLength: 1, maxLength: 200 }),
    runtimeKind: Type.Optional(Type.Literal('gondolin_pi')),
    sandbox: RuntimeProfileSandbox,
    sessionStorageMode: Type.Optional(Type.Literal('local')),
    workspaceStorageMode: Type.Optional(Type.Literal('local')),
    defaultWorkspaceMode: Type.Optional(
      Type.Union([RuntimeProfileWorkspaceMode, Type.Null()]),
    ),
    allowedWorkspaceModes: Type.Optional(RuntimeProfileAllowedWorkspaceModes),
    sessionTtlSec: Type.Optional(Type.Integer({ minimum: 1, maximum: 86_400 })),
    workspaceTtlSec: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 86_400 }),
    ),
    leaseTtlSec: Type.Optional(RuntimeProfileLeaseTtlSec),
    heartbeatIntervalMs: Type.Optional(RuntimeProfileHeartbeatIntervalMs),
    maxBatchSize: Type.Optional(RuntimeProfileMaxBatchSize),
    maxTurns: Type.Optional(RuntimeProfileMaxTurns),
    maxBashTimeouts: Type.Optional(RuntimeProfileMaxBashTimeouts),
    requiredEnv: Type.Optional(
      Type.Array(RuntimeProfileEnvName, { maxItems: 100 }),
    ),
    requiredTools: Type.Optional(
      Type.Array(RuntimeProfileToolName, { maxItems: 100 }),
    ),
    context: Type.Optional(Type.Array(RuntimeProfileContext, { maxItems: 5 })),
  },
  { $id: 'CreateRuntimeProfileBody', additionalProperties: false },
);

export const UpdateRuntimeProfileBodySchema = Type.Partial(
  CreateRuntimeProfileBodySchema,
  {
    $id: 'UpdateRuntimeProfileBody',
    additionalProperties: false,
    minProperties: 1,
  },
);

export const RuntimeProfileListResponseSchema = Type.Object(
  {
    items: Type.Array(RuntimeProfile),
  },
  { $id: 'RuntimeProfileListResponse' },
);

export const runtimeProfileSchemas = [
  RuntimeProfileSandbox,
  RuntimeProfileContext,
  RuntimeProfile,
  CreateRuntimeProfileBodySchema,
  UpdateRuntimeProfileBodySchema,
  RuntimeProfileListResponseSchema,
];
