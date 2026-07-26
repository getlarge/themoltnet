import { UuidSchema } from '@moltnet/models';
import { Type } from 'typebox';

const TOOL_NAME_PATTERN = '^[a-zA-Z0-9_.:-]{1,128}$';

const ToolNameSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: TOOL_NAME_PATTERN,
  description: 'A tool identifier, e.g. an executable name like "git".',
});

export const ToolEnforcementSchema = Type.Union(
  [Type.Literal('off'), Type.Literal('watch'), Type.Literal('enforce')],
  {
    $id: 'ToolEnforcement',
    description:
      'Runtime tool-policy enforcement mode: off (inert), watch (audit only), enforce (block disallowed tools, fail-closed).',
  },
);

export const RuntimePolicySchema = Type.Object(
  {
    id: UuidSchema,
    teamId: UuidSchema,
    name: Type.String(),
    description: Type.Union([Type.String(), Type.Null()]),
    createdAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    updatedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  },
  { $id: 'RuntimePolicy' },
);

export const RuntimePolicyWithToolsSchema = Type.Object(
  {
    id: UuidSchema,
    teamId: UuidSchema,
    name: Type.String(),
    description: Type.Union([Type.String(), Type.Null()]),
    createdAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    updatedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    tools: Type.Array(ToolNameSchema),
  },
  { $id: 'RuntimePolicyWithTools' },
);

export const RuntimePolicyListSchema = Type.Object(
  { items: Type.Array(Type.Ref(RuntimePolicySchema.$id)) },
  { $id: 'RuntimePolicyList' },
);

export const CreateRuntimePolicyBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 100, pattern: '\\S' }),
    description: Type.Optional(Type.String({ maxLength: 4096 })),
    tools: Type.Array(ToolNameSchema, { default: [] }),
  },
  { $id: 'CreateRuntimePolicyBody' },
);

export const UpdateRuntimePolicyBodySchema = Type.Object(
  {
    name: Type.Optional(
      Type.String({ minLength: 1, maxLength: 100, pattern: '\\S' }),
    ),
    description: Type.Optional(
      Type.Union([Type.String({ maxLength: 4096 }), Type.Null()]),
    ),
    addTools: Type.Optional(Type.Array(ToolNameSchema)),
    removeTools: Type.Optional(Type.Array(ToolNameSchema)),
  },
  { $id: 'UpdateRuntimePolicyBody' },
);

export const SetProfilePoliciesBodySchema = Type.Object(
  { policyIds: Type.Array(UuidSchema) },
  { $id: 'SetProfilePoliciesBody' },
);

export const AllowedToolsResponseSchema = Type.Object(
  {
    enforcement: Type.Ref(ToolEnforcementSchema.$id),
    allowedTools: Type.Array(ToolNameSchema),
  },
  { $id: 'AllowedToolsResponse' },
);

export const runtimePolicySchemas = [
  ToolEnforcementSchema,
  RuntimePolicySchema,
  RuntimePolicyWithToolsSchema,
  RuntimePolicyListSchema,
  CreateRuntimePolicyBodySchema,
  UpdateRuntimePolicyBodySchema,
  SetProfilePoliciesBodySchema,
  AllowedToolsResponseSchema,
];
