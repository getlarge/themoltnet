import {
  CreateRuntimeProfileBodySchema,
  RuntimeProfile,
  RuntimeProfileContext,
  RuntimeProfileSandbox,
  UpdateRuntimeProfileBodySchema,
} from '@moltnet/runtime-profiles';
import { Type } from 'typebox';

export { CreateRuntimeProfileBodySchema, UpdateRuntimeProfileBodySchema };

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
