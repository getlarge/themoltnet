import {
  RuntimeModel,
  RuntimeModelCapabilities,
  RuntimeModelName,
  RuntimeModelProvider,
} from '@moltnet/tasks';
import { Type } from 'typebox';

export const CreateRuntimeModelBodySchema = Type.Object(
  {
    provider: RuntimeModelProvider,
    model: RuntimeModelName,
    displayName: Type.Optional(
      Type.String({ minLength: 1, maxLength: 200 }),
    ),
    description: Type.Optional(Type.String({ maxLength: 4096 })),
    capabilities: Type.Optional(RuntimeModelCapabilities),
  },
  { $id: 'CreateRuntimeModelBody', additionalProperties: false },
);

export const UpdateRuntimeModelBodySchema = Type.Partial(
  Type.Object(
    {
      provider: RuntimeModelProvider,
      model: RuntimeModelName,
      displayName: Type.String({ minLength: 1, maxLength: 200 }),
      description: Type.String({ maxLength: 4096 }),
      capabilities: RuntimeModelCapabilities,
      isActive: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  {
    $id: 'UpdateRuntimeModelBody',
    additionalProperties: false,
    minProperties: 1,
  },
);

export const RuntimeModelListResponseSchema = Type.Object(
  {
    items: Type.Array(RuntimeModel),
  },
  { $id: 'RuntimeModelListResponse' },
);

export const RuntimeModelParamsSchema = Type.Object(
  { entryId: Type.String({ format: 'uuid' }) },
  { $id: 'RuntimeModelParams' },
);

export const runtimeModelSchemas = [
  RuntimeModel,
  CreateRuntimeModelBodySchema,
  UpdateRuntimeModelBodySchema,
  RuntimeModelListResponseSchema,
  RuntimeModelParamsSchema,
];
