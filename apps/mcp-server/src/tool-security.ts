import type { Tool, ToolHandler } from '@getlarge/fastify-mcp';
import {
  CREDENTIAL_SCOPES,
  type CredentialScope,
  MCP_CLIENT_SCOPES,
} from '@moltnet/models';
import type { FastifyInstance } from 'fastify';
import type { TObject } from 'typebox';

import type { CallToolResult } from './types.js';

const {
  AgentProfile,
  CryptoSign,
  DiaryManage,
  DiaryRead,
  DiaryWrite,
  PackRead,
  PackWrite,
  TaskExecute,
  TaskManage,
  TaskRead,
  TaskWrite,
  TeamJoin,
  TeamManage,
  TeamRead,
} = CREDENTIAL_SCOPES;

/**
 * OAuth scopes each MCP tool needs, taken from the `requiredScopes` of the REST
 * operations its handler calls.
 *
 * Published on every tool as `securitySchemes`. OpenAI's connector (ChatGPT
 * and Codex apps) uses these declarations to decide what to request when it
 * links an account. Without them it asked only for the OIDC scopes the
 * authorization server advertises, so every REST call failed with
 * `Missing required scope` (issue #2967).
 *
 * An empty list still means "OAuth required": the MCP endpoint itself rejects
 * anonymous requests, even when the underlying REST route is public
 * (`crypto_verify`, `agent_lookup`) or the tool makes no REST call (the UI
 * openers).
 */
const TOOL_SCOPES: Readonly<Record<string, readonly CredentialScope[]>> = {
  agent_lookup: [],
  crypto_prepare_signature: [CryptoSign],
  crypto_signing_status: [CryptoSign],
  crypto_submit_signature: [CryptoSign],
  crypto_verify: [],
  diaries_create: [DiaryWrite],
  diaries_get: [DiaryRead],
  diaries_list: [DiaryRead],
  diary_grants_create: [DiaryManage],
  diary_grants_list: [DiaryRead],
  diary_grants_revoke: [DiaryManage],
  diary_tags: [DiaryRead],
  entries_create: [DiaryWrite],
  entries_delete: [DiaryManage],
  entries_get: [DiaryRead],
  entries_list: [DiaryRead],
  entries_map_open: [],
  entries_search: [DiaryRead],
  entries_update: [DiaryWrite],
  moltnet_whoami: [AgentProfile],
  packs_create: [PackWrite],
  packs_diff: [PackRead],
  packs_get: [PackRead],
  packs_list: [PackRead],
  packs_preview: [PackWrite],
  packs_provenance: [PackRead],
  packs_render: [PackWrite],
  packs_render_preview: [PackWrite],
  packs_update: [PackWrite],
  relations_create: [DiaryWrite],
  relations_delete: [DiaryWrite],
  relations_list: [DiaryRead],
  relations_update: [DiaryWrite],
  rendered_packs_get: [PackRead],
  rendered_packs_list: [PackRead],
  rendered_packs_update: [PackWrite],
  task_grants_create: [TaskManage],
  task_grants_list: [TaskRead],
  task_grants_revoke: [TaskManage],
  tasks_app_open: [],
  tasks_artifacts_download: [TaskRead],
  tasks_artifacts_list: [TaskRead],
  tasks_artifacts_stage: [TaskWrite],
  tasks_artifacts_upload: [TaskExecute],
  tasks_attempts_list: [TaskRead],
  tasks_cancel: [TaskManage],
  tasks_console_link: [],
  tasks_continue: [TaskRead, TaskWrite],
  tasks_conversations_get: [TaskRead],
  tasks_conversations_list: [TaskRead],
  tasks_create: [TaskWrite],
  tasks_get: [TaskRead],
  tasks_list: [TaskRead],
  tasks_messages_list: [TaskRead],
  tasks_schemas: [TaskRead],
  team_members_list: [TeamRead],
  teams_create: [TeamManage],
  teams_delete: [TeamManage],
  teams_invite_create: [TeamManage],
  teams_invite_delete: [TeamManage],
  teams_invite_list: [TeamRead],
  teams_join: [TeamJoin],
  teams_list: [TeamRead],
  teams_member_remove: [TeamManage],
  teams_member_update_role: [TeamManage],
};

export interface OAuth2SecurityScheme {
  type: 'oauth2';
  scopes: string[];
}

export function securitySchemesForTool(name: string): OAuth2SecurityScheme[] {
  const scopes = TOOL_SCOPES[name];
  if (!scopes) {
    throw new Error(`Missing MCP tool security policy for ${name}`);
  }
  return [{ type: 'oauth2', scopes: [...scopes] }];
}

/** Every scope some MCP tool declares, in a stable order. */
export const MCP_TOOL_SCOPES: readonly CredentialScope[] = Object.freeze(
  MCP_CLIENT_SCOPES.filter((scope) =>
    Object.values(TOOL_SCOPES).some((scopes) => scopes.includes(scope)),
  ),
);

const MISSING_SCOPE_PATTERN = /Missing required scope: ([a-z]+:[a-z]+)/;

/**
 * The scope a REST 403 reported as missing, if the tool result carries one.
 *
 * Handlers flatten REST problems into `{ error: <detail> }` text, so the
 * detail string is the only signal left by the time the result reaches this
 * policy. Only a known MCP scope is returned, which keeps arbitrary text out
 * of the challenge built from it.
 */
export function missingScopeFromResult(
  result: CallToolResult,
): CredentialScope | null {
  if (!result.isError) return null;
  for (const item of result.content ?? []) {
    if (item.type !== 'text') continue;
    const match = MISSING_SCOPE_PATTERN.exec(item.text);
    const scope = match?.[1];
    if (scope && (MCP_CLIENT_SCOPES as readonly string[]).includes(scope)) {
      return scope as CredentialScope;
    }
  }
  return null;
}

/**
 * RFC 6750 `insufficient_scope` challenge for a tool result.
 *
 * It asks for every MCP tool scope, not only the missing one: a client that
 * re-links replaces its grant, so requesting just the missing scope would
 * trade one failure for another.
 */
export function insufficientScopeChallenge(
  resourceUri: string,
  missingScope: CredentialScope,
): string {
  return [
    `Bearer resource_metadata="${resourceUri}/.well-known/oauth-protected-resource"`,
    'error="insufficient_scope"',
    `scope="${MCP_TOOL_SCOPES.join(' ')}"`,
    `error_description="This connection was not granted ${missingScope}. Reconnect MoltNet to grant it."`,
  ].join(', ');
}

export interface ToolSecurityPolicyOptions {
  /** Protected resource URI; when unset (auth disabled) no challenge is added. */
  resourceUri?: string;
}

/**
 * Publish per-tool `securitySchemes` and turn REST scope denials into OAuth
 * step-up challenges.
 *
 * The schemes go both top-level and in `_meta`, which OpenAI documents as the
 * mirror for clients that read only `_meta`. A denial gains
 * `_meta["mcp/www_authenticate"]`, the signal OpenAI's connector needs to
 * offer re-linking instead of surfacing a dead-end error.
 */
export function installToolSecurityPolicy(
  app: FastifyInstance,
  options: ToolSecurityPolicyOptions,
): void {
  const addTool = app.mcpAddTool.bind(app);
  const { resourceUri } = options;

  app.mcpAddTool = (<TSchema extends TObject>(
    definition: Omit<Tool, 'inputSchema'> & { inputSchema: TSchema },
    handler?: ToolHandler<TSchema>,
  ) => {
    const securitySchemes = securitySchemesForTool(definition.name);
    const wrapped: ToolHandler<TSchema> | undefined =
      handler && resourceUri
        ? async (params, context) => {
            const result = await handler(params, context);
            const missingScope = missingScopeFromResult(result);
            if (!missingScope) return result;
            return {
              ...result,
              _meta: {
                ...result._meta,
                'mcp/www_authenticate': [
                  insufficientScopeChallenge(resourceUri, missingScope),
                ],
              },
            };
          }
        : handler;

    addTool(
      {
        ...definition,
        securitySchemes,
        _meta: { ...definition._meta, securitySchemes },
      } as typeof definition,
      wrapped,
    );
  }) as typeof app.mcpAddTool;
}
