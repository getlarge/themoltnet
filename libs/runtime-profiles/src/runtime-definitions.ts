/**
 * Create bodies for runtime profiles and runtime policies.
 *
 * The REST API validates `POST /runtime-profiles` and `POST /runtime-policies`
 * against these schemas, and the committed definitions under
 * `.github/runtime-profiles/` and `.github/runtime-policies/` use the same
 * shape. Both sides import them from here so a committed file can be checked
 * against what the server accepts without depending on the API app.
 */
import { type Static, Type } from 'typebox';

import {
  RuntimeProfileAllowedWorkspaceModes,
  RuntimeProfileContext,
  RuntimeProfileEnvName,
  RuntimeProfileMaxBashTimeouts,
  RuntimeProfileMaxTurns,
  RuntimeProfileModels,
  RuntimeProfileName,
  RuntimeProfileRuntimeKind,
  RuntimeProfileSandbox,
  RuntimeProfileToolEnforcement,
  RuntimeProfileToolName,
  RuntimeProfileWorkspaceMode,
} from './runtime-profiles.js';

export const CreateRuntimeProfileBodySchema = Type.Object(
  {
    name: RuntimeProfileName,
    description: Type.Optional(Type.String({ maxLength: 4096 })),
    models: RuntimeProfileModels,
    runtimeKind: Type.Optional(RuntimeProfileRuntimeKind),
    sandbox: RuntimeProfileSandbox,
    defaultWorkspaceMode: Type.Optional(
      Type.Union([RuntimeProfileWorkspaceMode, Type.Null()]),
    ),
    allowedWorkspaceModes: Type.Optional(RuntimeProfileAllowedWorkspaceModes),
    maxTurns: Type.Optional(RuntimeProfileMaxTurns),
    maxBashTimeouts: Type.Optional(RuntimeProfileMaxBashTimeouts),
    toolEnforcement: Type.Optional(RuntimeProfileToolEnforcement),
    requiredEnv: Type.Optional(
      Type.Array(RuntimeProfileEnvName, { maxItems: 100 }),
    ),
    requiredTools: Type.Optional(
      Type.Array(RuntimeProfileToolName, { maxItems: 100 }),
    ),
    requiredExecutables: Type.Optional(
      Type.Array(RuntimeProfileToolName, { maxItems: 100 }),
    ),
    context: Type.Optional(Type.Array(RuntimeProfileContext, { maxItems: 5 })),
  },
  { $id: 'CreateRuntimeProfileBody', additionalProperties: false },
);
export type CreateRuntimeProfileBody = Static<
  typeof CreateRuntimeProfileBodySchema
>;

export const UpdateRuntimeProfileBodySchema = Type.Partial(
  CreateRuntimeProfileBodySchema,
  {
    $id: 'UpdateRuntimeProfileBody',
    additionalProperties: false,
    minProperties: 1,
  },
);

const TOOL_NAME_PATTERN = '^(?!.*[\\r\\n])[a-zA-Z0-9_.:-]{1,128}$';

export const RuntimePolicyToolNameSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: TOOL_NAME_PATTERN,
  description:
    'A runtime or MCP tool name, e.g. "read". Never authorizes a shell invocation.',
});

const ShellCommandTokenSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  description: 'One literal argv token.',
});

const SHELL_COMMAND_RULE_ID = 'ShellCommandRule';

export const ShellCommandRuleSchema = Type.Object(
  {
    argvPrefix: Type.Array(ShellCommandTokenSchema, {
      minItems: 1,
      maxItems: 8,
      description:
        'Literal argv tokens matched from the program name onward. Additional argv tokens remain permitted; output redirection is never permitted.',
    }),
  },
  { $id: SHELL_COMMAND_RULE_ID, additionalProperties: false },
);
export type ShellCommandRule = Static<typeof ShellCommandRuleSchema>;

export const CreateRuntimePolicyBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 100, pattern: '\\S' }),
    description: Type.Optional(Type.String({ maxLength: 4096 })),
    tools: Type.Optional(
      Type.Array(RuntimePolicyToolNameSchema, { maxItems: 500 }),
    ),
    shellCommands: Type.Optional(
      Type.Array(Type.Ref(SHELL_COMMAND_RULE_ID), { maxItems: 500 }),
    ),
  },
  { $id: 'CreateRuntimePolicyBody', additionalProperties: false },
);
export interface CreateRuntimePolicyBody {
  name: string;
  description?: string;
  tools?: string[];
  shellCommands?: ShellCommandRule[];
}

/**
 * Schemas referenced by `$ref` from the bodies above. Pass this as the
 * TypeBox context when validating outside Fastify, e.g.
 * `Value.Check(RuntimeDefinitionReferences, CreateRuntimePolicyBodySchema, x)`;
 * an unresolved `$ref` makes every check fail.
 */
export const RuntimeDefinitionReferences = {
  [SHELL_COMMAND_RULE_ID]: ShellCommandRuleSchema,
};
