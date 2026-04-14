/**
 * Team MCP tool input schemas.
 *
 * Covers read-only: teams_list, team_members_list.
 * Covers mutations: teams_create/join/delete, teams_invite_create/list/delete,
 * teams_member_remove.
 */

import { Type } from '@sinclair/typebox';

// --- Team read-only schemas ---

export const TeamsListSchema = Type.Object({});
export type TeamsListInput = {};

export const TeamMembersListSchema = Type.Object({
  team_id: Type.String({
    description: 'Team ID (UUID) to list members for.',
  }),
});
export type TeamMembersListInput = {
  team_id: string;
};

// --- Team mutation schemas ---

export const TeamsCreateSchema = Type.Object({
  name: Type.String({
    description: 'Name for the new team.',
  }),
});
export type TeamsCreateInput = {
  name: string;
};

export const TeamsJoinSchema = Type.Object({
  code: Type.String({
    description: 'Invite code to join a team.',
  }),
});
export type TeamsJoinInput = {
  code: string;
};

export const TeamsDeleteSchema = Type.Object({
  team_id: Type.String({
    description: 'Team ID (UUID) to delete. Only team owners can delete.',
  }),
});
export type TeamsDeleteInput = {
  team_id: string;
};

export const TeamsInviteCreateSchema = Type.Object({
  team_id: Type.String({
    description: 'Team ID (UUID) to create an invite for.',
  }),
  role: Type.Optional(
    Type.Union([Type.Literal('member'), Type.Literal('manager')], {
      description: 'Role for invited members. Default: member.',
    }),
  ),
  max_uses: Type.Optional(
    Type.Integer({
      description:
        'Maximum number of times the invite can be used. Default: 1.',
      minimum: 1,
    }),
  ),
  expires_in_hours: Type.Optional(
    Type.Integer({
      description: 'Invite expiry in hours (1-720). Default: server default.',
      minimum: 1,
      maximum: 720,
    }),
  ),
});
export type TeamsInviteCreateInput = {
  team_id: string;
  role?: 'member' | 'manager';
  max_uses?: number;
  expires_in_hours?: number;
};

export const TeamsInviteListSchema = Type.Object({
  team_id: Type.String({
    description: 'Team ID (UUID) to list invites for.',
  }),
});
export type TeamsInviteListInput = {
  team_id: string;
};

export const TeamsInviteDeleteSchema = Type.Object({
  team_id: Type.String({
    description: 'Team ID (UUID) the invite belongs to.',
  }),
  invite_id: Type.String({
    description: 'Invite ID (UUID) to delete.',
  }),
});
export type TeamsInviteDeleteInput = {
  team_id: string;
  invite_id: string;
};

export const TeamsMemberRemoveSchema = Type.Object({
  team_id: Type.String({
    description: 'Team ID (UUID) to remove the member from.',
  }),
  subject_id: Type.String({
    description: 'Subject ID (UUID) of the member to remove.',
  }),
});
export type TeamsMemberRemoveInput = {
  team_id: string;
  subject_id: string;
};
