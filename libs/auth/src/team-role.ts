import { TeamRelation } from './keto-constants.js';

export const TEAM_ROLE = {
  Owner: 'owner',
  Manager: 'manager',
  Member: 'member',
} as const;

export type TeamRole = (typeof TEAM_ROLE)[keyof typeof TEAM_ROLE];
export type TeamInviteRole = Exclude<TeamRole, 'owner'>;

const TEAM_ROLE_RANK: Record<TeamRole, number> = {
  [TEAM_ROLE.Owner]: 3,
  [TEAM_ROLE.Manager]: 2,
  [TEAM_ROLE.Member]: 1,
};

export function teamRoleRank(role: TeamRole): number {
  return TEAM_ROLE_RANK[role];
}

export function teamRelationToRole(relation: TeamRelation): TeamRole {
  switch (relation) {
    case TeamRelation.Owners:
      return TEAM_ROLE.Owner;
    case TeamRelation.Managers:
      return TEAM_ROLE.Manager;
    case TeamRelation.Members:
      return TEAM_ROLE.Member;
  }
}

export function teamRoleToRelation(role: TeamRole): TeamRelation {
  switch (role) {
    case TEAM_ROLE.Owner:
      return TeamRelation.Owners;
    case TEAM_ROLE.Manager:
      return TeamRelation.Managers;
    case TEAM_ROLE.Member:
      return TeamRelation.Members;
  }
}

export function normalizeTeamRelation(relation: string): TeamRelation | null {
  switch (relation) {
    case 'owners':
      return TeamRelation.Owners;
    case 'managers':
      return TeamRelation.Managers;
    case 'members':
      return TeamRelation.Members;
    default:
      return null;
  }
}

export function highestTeamRole(roles: readonly TeamRole[]): TeamRole | null {
  return roles.reduce<TeamRole | null>((best, role) => {
    if (!best || teamRoleRank(role) > teamRoleRank(best)) return role;
    return best;
  }, null);
}
