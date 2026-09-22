import type { AgentServerCatalogueTeam } from './types.js';

export function credentialLabel(
  team: AgentServerCatalogueTeam,
  now: number,
): string {
  const expiresAt = team.credential?.expiresAt;
  const expiry = expiresAt ? Date.parse(expiresAt) : NaN;
  if (expiry <= now) return 'Expired';
  if (!team.available) return 'Unavailable';
  if (expiry <= now + 7 * 86400000) return 'Expires within seven days';
  if (expiresAt === null || Number.isFinite(expiry)) return 'Healthy';
  return 'Expiry unknown';
}
export function expiryLabel(expiresAt: string | null | undefined): string {
  if (expiresAt === null) return 'No scheduled expiry';
  if (!expiresAt || !Number.isFinite(Date.parse(expiresAt)))
    return 'Expiry unknown';
  return `Expires ${new Date(expiresAt).toLocaleString()}`;
}

export function verificationUnavailable(
  teams: readonly AgentServerCatalogueTeam[],
): boolean {
  return teams.some((team) =>
    team.blockers.some((blocker) => blocker.code === 'agent_key_unavailable'),
  );
}
