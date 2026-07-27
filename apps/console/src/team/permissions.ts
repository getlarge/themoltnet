export const TEAM_HEADER = 'x-moltnet-team-id' as const;

export function canManageTeam(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'manager';
}

export const canManageRuntime = canManageTeam;
