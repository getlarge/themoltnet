import {
  SHA256_HASH_STRING_LENGTH,
  ToolEnforcementSchema as CanonicalToolEnforcementSchema,
  UuidSchema,
} from '@moltnet/models';
import {
  CreateRuntimePolicyBodySchema,
  RuntimePolicyToolNameSchema as ToolNameSchema,
  RuntimeProfileRuntimeKind,
  ShellCommandRuleSchema,
} from '@moltnet/runtime-profiles';
import { Type } from 'typebox';

export { CreateRuntimePolicyBodySchema };

const ToolEnforcementSchema = {
  ...CanonicalToolEnforcementSchema,
  $id: 'ToolEnforcement',
};

const RuntimePolicySchema = Type.Object(
  {
    id: UuidSchema,
    teamId: UuidSchema,
    name: Type.String(),
    description: Type.Union([Type.String(), Type.Null()]),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'RuntimePolicy' },
);

export const RuntimePolicyWithToolsSchema = Type.Object(
  {
    id: UuidSchema,
    teamId: UuidSchema,
    name: Type.String(),
    description: Type.Union([Type.String(), Type.Null()]),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
    tools: Type.Array(ToolNameSchema),
    shellCommands: Type.Array(Type.Ref(ShellCommandRuleSchema.$id)),
  },
  { $id: 'RuntimePolicyWithTools' },
);

export const RuntimePolicyListSchema = Type.Object(
  { items: Type.Array(Type.Ref(RuntimePolicySchema.$id)) },
  { $id: 'RuntimePolicyList' },
);

// Rejects unknown keys (catches misspelled fields) and empty no-op patches.
export const UpdateRuntimePolicyBodySchema = Type.Object(
  {
    name: Type.Optional(
      Type.String({ minLength: 1, maxLength: 100, pattern: '\\S' }),
    ),
    description: Type.Optional(
      Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]),
    ),
    addTools: Type.Optional(Type.Array(ToolNameSchema, { maxItems: 500 })),
    removeTools: Type.Optional(Type.Array(ToolNameSchema, { maxItems: 500 })),
    addShellCommands: Type.Optional(
      Type.Array(Type.Ref(ShellCommandRuleSchema.$id), { maxItems: 500 }),
    ),
    removeShellCommands: Type.Optional(
      Type.Array(Type.Ref(ShellCommandRuleSchema.$id), { maxItems: 500 }),
    ),
  },
  {
    $id: 'UpdateRuntimePolicyBody',
    additionalProperties: false,
    minProperties: 1,
  },
);

export const SetProfilePoliciesBodySchema = Type.Object(
  { policyIds: Type.Array(UuidSchema, { maxItems: 200 }) },
  { $id: 'SetProfilePoliciesBody', additionalProperties: false },
);

export const RuntimeProfilePoliciesResponseSchema = Type.Object(
  { policyIds: Type.Array(UuidSchema) },
  { $id: 'RuntimeProfilePoliciesResponse' },
);

export const AllowedToolsResponseSchema = Type.Object(
  {
    enforcement: Type.Ref(ToolEnforcementSchema.$id),
    allowedTools: Type.Array(ToolNameSchema),
    allowedShellCommands: Type.Array(Type.Ref(ShellCommandRuleSchema.$id)),
    runtimeKind: RuntimeProfileRuntimeKind,
    runtimeProfileRevision: Type.Integer({ minimum: 1 }),
    policySnapshotHash: Type.String({
      pattern: '^sha256:[0-9a-f]{64}$',
      maxLength: SHA256_HASH_STRING_LENGTH,
    }),
  },
  { $id: 'AllowedToolsResponse' },
);

export const runtimePolicySchemas = [
  ToolEnforcementSchema,
  ShellCommandRuleSchema,
  RuntimePolicySchema,
  RuntimePolicyWithToolsSchema,
  RuntimePolicyListSchema,
  CreateRuntimePolicyBodySchema,
  UpdateRuntimePolicyBodySchema,
  SetProfilePoliciesBodySchema,
  RuntimeProfilePoliciesResponseSchema,
  AllowedToolsResponseSchema,
];
