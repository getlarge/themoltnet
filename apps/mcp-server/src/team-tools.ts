/**
 * @moltnet/mcp-server — Team Tool Handlers
 *
 * Read and mutation operations for teams, invites, and members.
 * Delegates to the REST API via the generated API client.
 */

import {
  createTeam,
  createTeamInvite,
  deleteTeam,
  deleteTeamInvite,
  getTeam,
  joinTeam,
  listTeamInvites,
  listTeams,
  removeTeamMember,
} from '@moltnet/api-client';
import type { FastifyInstance } from 'fastify';

import type {
  TeamMembersListInput,
  TeamsCreateInput,
  TeamsDeleteInput,
  TeamsInviteCreateInput,
  TeamsInviteDeleteInput,
  TeamsInviteListInput,
  TeamsJoinInput,
  TeamsListInput,
  TeamsMemberRemoveInput,
} from './schemas/team-schemas.js';
import {
  TeamMembersListSchema,
  TeamsCreateSchema,
  TeamsDeleteSchema,
  TeamsInviteCreateSchema,
  TeamsInviteDeleteSchema,
  TeamsInviteListSchema,
  TeamsJoinSchema,
  TeamsListSchema,
  TeamsMemberRemoveSchema,
} from './schemas/team-schemas.js';
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

export async function handleTeamsCreate(
  args: TeamsCreateInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'teams_create' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await createTeam({
    client: deps.client,
    auth: () => token,
    body: { name: args.name },
  });

  if (error) {
    deps.logger.error({ tool: 'teams_create', err: error }, 'tool.error');
    return errorResult(extractApiErrorMessage(error, 'Failed to create team'));
  }

  return textResult({ success: true, ...data });
}

export async function handleTeamsJoin(
  args: TeamsJoinInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'teams_join' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await joinTeam({
    client: deps.client,
    auth: () => token,
    body: { code: args.code },
  });

  if (error) {
    deps.logger.error({ tool: 'teams_join', err: error }, 'tool.error');
    return errorResult(extractApiErrorMessage(error, 'Failed to join team'));
  }

  return textResult({ success: true, ...data });
}

export async function handleTeamsDelete(
  args: TeamsDeleteInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'teams_delete' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await deleteTeam({
    client: deps.client,
    auth: () => token,
    path: { id: args.team_id },
  });

  if (error) {
    deps.logger.error({ tool: 'teams_delete', err: error }, 'tool.error');
    return errorResult(extractApiErrorMessage(error, 'Failed to delete team'));
  }

  return textResult({ success: true, ...data });
}

export async function handleTeamsInviteCreate(
  args: TeamsInviteCreateInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'teams_invite_create' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await createTeamInvite({
    client: deps.client,
    auth: () => token,
    path: { id: args.team_id },
    body: {
      role: args.role,
      maxUses: args.max_uses,
      expiresInHours: args.expires_in_hours,
    },
  });

  if (error) {
    deps.logger.error(
      { tool: 'teams_invite_create', err: error },
      'tool.error',
    );
    return errorResult(
      extractApiErrorMessage(error, 'Failed to create team invite'),
    );
  }

  return textResult({ success: true, ...data });
}

export async function handleTeamsInviteList(
  args: TeamsInviteListInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'teams_invite_list' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await listTeamInvites({
    client: deps.client,
    auth: () => token,
    path: { id: args.team_id },
  });

  if (error) {
    deps.logger.error({ tool: 'teams_invite_list', err: error }, 'tool.error');
    return errorResult(
      extractApiErrorMessage(error, 'Failed to list team invites'),
    );
  }

  return textResult(data);
}

export async function handleTeamsInviteDelete(
  args: TeamsInviteDeleteInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'teams_invite_delete' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await deleteTeamInvite({
    client: deps.client,
    auth: () => token,
    path: { id: args.team_id, inviteId: args.invite_id },
  });

  if (error) {
    deps.logger.error(
      { tool: 'teams_invite_delete', err: error },
      'tool.error',
    );
    return errorResult(
      extractApiErrorMessage(error, 'Failed to delete team invite'),
    );
  }

  return textResult({ success: true, ...data });
}

export async function handleTeamsMemberRemove(
  args: TeamsMemberRemoveInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'teams_member_remove' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await removeTeamMember({
    client: deps.client,
    auth: () => token,
    path: { id: args.team_id, subjectId: args.subject_id },
  });

  if (error) {
    deps.logger.error(
      { tool: 'teams_member_remove', err: error },
      'tool.error',
    );
    return errorResult(
      extractApiErrorMessage(error, 'Failed to remove team member'),
    );
  }

  return textResult({ success: true, ...data });
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

  fastify.mcpAddTool(
    {
      name: 'teams_create',
      description: 'Create a new team. You become the owner.',
      inputSchema: TeamsCreateSchema,
    },
    async (args, ctx) => handleTeamsCreate(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'teams_join',
      description:
        'Join a team using an invite code. Returns the team ID and your assigned role.',
      inputSchema: TeamsJoinSchema,
    },
    async (args, ctx) => handleTeamsJoin(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'teams_delete',
      description:
        'Delete a team. Only team owners can delete. All invites and memberships are removed.',
      inputSchema: TeamsDeleteSchema,
    },
    async (args, ctx) => handleTeamsDelete(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'teams_invite_create',
      description:
        'Create an invite code for a team. Requires manager or owner role.',
      inputSchema: TeamsInviteCreateSchema,
    },
    async (args, ctx) => handleTeamsInviteCreate(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'teams_invite_list',
      description:
        'List all invite codes for a team. Requires manager or owner role.',
      inputSchema: TeamsInviteListSchema,
    },
    async (args, ctx) => handleTeamsInviteList(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'teams_invite_delete',
      description: 'Delete an invite code. Requires manager or owner role.',
      inputSchema: TeamsInviteDeleteSchema,
    },
    async (args, ctx) => handleTeamsInviteDelete(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'teams_member_remove',
      description:
        'Remove a member from a team. Requires manager or owner role. Cannot remove the last owner.',
      inputSchema: TeamsMemberRemoveSchema,
    },
    async (args, ctx) => handleTeamsMemberRemove(args, deps, ctx),
  );
}
