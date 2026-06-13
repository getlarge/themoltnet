import {
  DaemonProfile,
  DaemonProfileContext,
  DaemonProfileEnvName,
  DaemonProfileHeartbeatIntervalMs,
  DaemonProfileLeaseTtlSec,
  DaemonProfileMaxBatchSize,
  DaemonProfileName,
  DaemonProfileSandbox,
  DaemonProfileToolName,
} from '@moltnet/tasks';
import { Type } from 'typebox';

export const CreateDaemonProfileBodySchema = Type.Object(
  {
    name: DaemonProfileName,
    description: Type.Optional(Type.String({ maxLength: 4096 })),
    provider: Type.String({ minLength: 1, maxLength: 100 }),
    model: Type.String({ minLength: 1, maxLength: 200 }),
    runtimeKind: Type.Optional(Type.Literal('gondolin_pi')),
    sandbox: DaemonProfileSandbox,
    sessionStorageMode: Type.Optional(Type.Literal('local')),
    workspaceStorageMode: Type.Optional(Type.Literal('local')),
    sessionTtlSec: Type.Optional(Type.Integer({ minimum: 1, maximum: 86_400 })),
    workspaceTtlSec: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 86_400 }),
    ),
    leaseTtlSec: Type.Optional(DaemonProfileLeaseTtlSec),
    heartbeatIntervalMs: Type.Optional(DaemonProfileHeartbeatIntervalMs),
    maxBatchSize: Type.Optional(DaemonProfileMaxBatchSize),
    requiredEnv: Type.Optional(
      Type.Array(DaemonProfileEnvName, { maxItems: 100 }),
    ),
    requiredTools: Type.Optional(
      Type.Array(DaemonProfileToolName, { maxItems: 100 }),
    ),
    context: Type.Optional(Type.Array(DaemonProfileContext, { maxItems: 5 })),
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
    items: Type.Array(DaemonProfile),
  },
  { $id: 'DaemonProfileListResponse' },
);

export const daemonProfileSchemas = [
  DaemonProfileSandbox,
  DaemonProfileContext,
  DaemonProfile,
  CreateDaemonProfileBodySchema,
  UpdateDaemonProfileBodySchema,
  DaemonProfileListResponseSchema,
];
