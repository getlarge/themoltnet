import type { Tool, ToolHandler } from '@getlarge/fastify-mcp';
import type { FastifyInstance } from 'fastify';
import type { TObject } from 'typebox';

type ToolAnnotations = NonNullable<Tool['annotations']>;

const READ_ONLY_TOOLS = new Set([
  'agent_lookup',
  'crypto_signing_status',
  'crypto_verify',
  'diaries_get',
  'diaries_list',
  'diary_grants_list',
  'diary_tags',
  'entries_get',
  'entries_list',
  'entries_map_open',
  'entries_search',
  'moltnet_whoami',
  'packs_diff',
  'packs_get',
  'packs_list',
  'packs_preview',
  'packs_provenance',
  'packs_render_preview',
  'relations_list',
  'rendered_packs_get',
  'rendered_packs_list',
  'task_grants_list',
  'tasks_app_open',
  'tasks_artifacts_download',
  'tasks_artifacts_list',
  'tasks_attempts_list',
  'tasks_console_link',
  'tasks_get',
  'tasks_list',
  'tasks_messages_list',
  'tasks_schemas',
  'team_members_list',
  'teams_invite_list',
  'teams_list',
]);

const DESTRUCTIVE_TOOLS = new Set([
  'diary_grants_revoke',
  'entries_delete',
  'entries_update',
  'packs_update',
  'relations_delete',
  'relations_update',
  'rendered_packs_update',
  'task_grants_revoke',
  'teams_delete',
  'teams_invite_delete',
  'teams_member_remove',
  'teams_member_update_role',
]);

export function annotationsForTool(name: string): ToolAnnotations {
  const readOnly = READ_ONLY_TOOLS.has(name);
  const destructive = DESTRUCTIVE_TOOLS.has(name);

  return {
    readOnlyHint: readOnly,
    destructiveHint: destructive,
    idempotentHint: readOnly || destructive,
    // Every tool crosses the MCP server boundary into the hosted MoltNet
    // service, even when it only reads data.
    openWorldHint: true,
  };
}

/** Apply one reviewable annotation policy to every registered MCP tool. */
export function installToolAnnotationPolicy(app: FastifyInstance): void {
  const addTool = app.mcpAddTool.bind(app);

  app.mcpAddTool = (<TSchema extends TObject>(
    definition: Omit<Tool, 'inputSchema'> & { inputSchema: TSchema },
    handler?: ToolHandler<TSchema>,
  ) => {
    addTool(
      {
        ...definition,
        annotations: annotationsForTool(definition.name),
      },
      handler,
    );
  }) as typeof app.mcpAddTool;
}
