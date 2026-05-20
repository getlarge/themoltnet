import { TeamRelation } from './keto-constants.js';

export const TeamRole = {
  Owner: 'owner',
  Manager: 'manager',
  Member: 'member',
} as const;

export type TeamRole = (typeof TeamRole)[keyof typeof TeamRole];
export type TeamInviteRole = Exclude<TeamRole, 'owner'>;

const TEAM_ROLE_RANK: Record<TeamRole, number> = {
  [TeamRole.Owner]: 3,
  [TeamRole.Manager]: 2,
  [TeamRole.Member]: 1,
};

export function teamRoleRank(role: TeamRole): number {
  return TEAM_ROLE_RANK[role];
}

export function teamRelationToRole(relation: TeamRelation): TeamRole {
  switch (relation) {
    case TeamRelation.Owners:
      return TeamRole.Owner;
    case TeamRelation.Managers:
      return TeamRole.Manager;
    case TeamRelation.Members:
      return TeamRole.Member;
  }
}

export function teamRoleToRelation(role: TeamRole): TeamRelation {
  switch (role) {
    case TeamRole.Owner:
      return TeamRelation.Owners;
    case TeamRole.Manager:
      return TeamRelation.Managers;
    case TeamRole.Member:
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
