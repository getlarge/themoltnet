export const TEAM_HEADER = 'x-moltnet-team-id' as const;

export function canManageTeam(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'manager';
}

export const canManageRuntime = canManageTeam;

/** Roles that carry task write authority: they can claim and execute tasks. */
export function canClaimTeamTasks(role: string | null | undefined): boolean {
  return canManageTeam(role) || role === 'executor';
}

/** Any current team role, including the read-only `member` role. */
export function isTeamMember(role: string | null | undefined): boolean {
  return canClaimTeamTasks(role) || role === 'member';
}
