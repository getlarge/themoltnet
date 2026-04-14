/**
 * Team MCP tool input schemas.
 *
 * Covers read-only: teams_list, team_members_list.
 * Covers mutations: teams_create/join/delete, teams_invite_create/list/delete,
 * teams_member_remove.
 */

import type {
  CreateTeamInviteResponses,
  DeleteTeamInviteResponses,
  DeleteTeamResponses,
  GetTeamResponses,
  JoinTeamResponses,
  ListTeamInvitesResponses,
  ListTeamsResponses,
  RemoveTeamMemberResponses,
} from '@moltnet/api-client';
import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

import type { AssertOutputMatchesApi, ResponseOf } from './common.js';

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

// --- Output schemas ---

export const TeamsListOutputSchema = Type.Object({
  items: Type.Array(
    Type.Object({
      id: Type.String(),
      name: Type.String(),
      personal: Type.Boolean(),
      status: Type.String(),
      role: Type.String(),
    }),
  ),
});

const TeamMemberSchema = Type.Object({
  subjectId: Type.String(),
  subjectType: Type.Union([Type.Literal('agent'), Type.Literal('human')]),
  role: Type.String(),
  displayName: Type.String(),
  fingerprint: Type.Optional(Type.String()),
  email: Type.Optional(Type.String()),
});

export const TeamMembersListOutputSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  status: Type.String(),
  personal: Type.Boolean(),
  createdBy: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  members: Type.Array(TeamMemberSchema),
});

/**
 * Flattened union of CreateTeamResponses 201 (sync create) and 202 (async via
 * workflow). MCP outputSchema must be a single object — optional fields cover
 * the workflow path.
 */
export const TeamsCreateOutputSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  status: Type.Optional(Type.String()),
  workflowId: Type.Optional(Type.String()),
});

export const TeamsJoinOutputSchema = Type.Object({
  teamId: Type.String(),
  role: Type.String(),
});

export const TeamsDeleteOutputSchema = Type.Object({
  deleted: Type.Boolean(),
});

const TeamInviteSchema = Type.Object({
  id: Type.String(),
  code: Type.String(),
  role: Type.String(),
  maxUses: Type.Number(),
  useCount: Type.Number(),
  expiresAt: Type.String(),
  createdAt: Type.String(),
});

export const TeamsInviteCreateOutputSchema = TeamInviteSchema;

export const TeamsInviteListOutputSchema = Type.Object({
  items: Type.Array(TeamInviteSchema),
});

export const TeamsInviteDeleteOutputSchema = Type.Object({
  deleted: Type.Boolean(),
});

export const TeamsMemberRemoveOutputSchema = Type.Object({
  removed: Type.Boolean(),
});

// --- Compile-time drift checks ---

type _TeamsListOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof TeamsListOutputSchema>,
  ResponseOf<ListTeamsResponses>
>;
type _TeamMembersListOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof TeamMembersListOutputSchema>,
  ResponseOf<GetTeamResponses>
>;
type _TeamsJoinOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof TeamsJoinOutputSchema>,
  ResponseOf<JoinTeamResponses>
>;
type _TeamsDeleteOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof TeamsDeleteOutputSchema>,
  ResponseOf<DeleteTeamResponses>
>;
type _TeamsInviteCreateOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof TeamsInviteCreateOutputSchema>,
  ResponseOf<CreateTeamInviteResponses>
>;
type _TeamsInviteListOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof TeamsInviteListOutputSchema>,
  ResponseOf<ListTeamInvitesResponses>
>;
type _TeamsInviteDeleteOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof TeamsInviteDeleteOutputSchema>,
  ResponseOf<DeleteTeamInviteResponses>
>;
type _TeamsMemberRemoveOutputMatchesApi = AssertOutputMatchesApi<
  Static<typeof TeamsMemberRemoveOutputSchema>,
  ResponseOf<RemoveTeamMemberResponses>
>;

// teams_create has 2 response codes (201 sync, 202 async workflow); the
// flattened schema unions both — no direct drift check possible.
type _TeamsCreateOutputCovers201 = AssertOutputMatchesApi<
  Static<typeof TeamsCreateOutputSchema> | { id: string; name: string },
  Static<typeof TeamsCreateOutputSchema>
>;
