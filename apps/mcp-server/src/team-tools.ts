/**
 * @moltnet/mcp-server — Team Read-Only Tool Handlers
 *
 * Exposes read-only team operations so agents can discover
 * their teams and members before granting diary access.
 */

import { getTeam, listTeams } from '@moltnet/api-client';
import type { FastifyInstance } from 'fastify';

import type { TeamMembersListInput, TeamsListInput } from './schemas.js';
import { TeamMembersListSchema, TeamsListSchema } from './schemas.js';
import type { CallToolResult, HandlerContext, McpDeps } from './types.js';
import {
  errorResult,
  extractApiErrorMessage,
  getTokenFromContext,
  textResult,
} from './utils.js';

// --- Handler functions ---

export async function handleTeamsList(
  _args: TeamsListInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'teams_list' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await listTeams({
    client: deps.client,
    auth: () => token,
  });

  if (error) {
    deps.logger.error({ tool: 'teams_list', err: error }, 'tool.error');
    return errorResult(extractApiErrorMessage(error, 'Failed to list teams'));
  }

  return textResult(data);
}

export async function handleTeamMembersList(
  args: TeamMembersListInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'team_members_list' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await getTeam({
    client: deps.client,
    auth: () => token,
    path: { id: args.team_id },
  });

  if (error) {
    deps.logger.error({ tool: 'team_members_list', err: error }, 'tool.error');
    return errorResult(
      extractApiErrorMessage(error, 'Failed to get team details'),
    );
  }

  return textResult({
    teamId: data?.id,
    name: data?.name,
    members: data?.members,
  });
}

// --- Tool registration ---

export function registerTeamTools(
  fastify: FastifyInstance,
  deps: McpDeps,
): void {
  fastify.mcpAddTool(
    {
      name: 'teams_list',
      description:
        'List your teams and your role in each. Useful for discovering team IDs before granting diary access.',
      inputSchema: TeamsListSchema,
    },
    async (args, ctx) => handleTeamsList(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'team_members_list',
      description:
        'List all members of a team with their roles. Useful for discovering subject IDs to grant diary access to.',
      inputSchema: TeamMembersListSchema,
    },
    async (args, ctx) => handleTeamMembersList(args, deps, ctx),
  );
}
