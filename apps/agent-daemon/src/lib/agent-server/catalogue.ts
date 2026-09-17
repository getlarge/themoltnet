/**
 * The team/profile catalogue the desktop Run Center composes runs from.
 *
 * Scoped to the *selected agent identity*, never a human session: the daemon
 * already reads runtime profiles with agent credentials on every run, so this
 * reads the same data with the same authority, earlier. An agent-scoped list is
 * also authoritative about what can actually run, which a human-scoped list is
 * not — Console needs a "this agent cannot poll that team" error precisely
 * because it offers teams the agent cannot serve.
 *
 * Team and diary travel together here for the same reason `RunSpec` pairs
 * them: the CLI's context store refuses one without the other, and a diary
 * that drifts from its team means entries land in the wrong place.
 */
import type { Agent } from '@themoltnet/sdk';

import {
  deriveProfileReadiness,
  type MachineCapabilities,
  type ProfileBlocker,
} from './readiness.js';

/**
 * Record shapes are *derived* from the SDK namespaces rather than re-declared,
 * so the catalogue cannot drift from what the API actually returns. An earlier
 * version hand-wrote these and quietly narrowed away the policy fields the
 * composer renders.
 */
type ListItems<T> =
  Awaited<T> extends { items: readonly (infer Item)[] } ? Item : never;

type SdkTeam = ListItems<ReturnType<Agent['teams']['list']>>;
type SdkDiary = ListItems<ReturnType<Agent['diaries']['list']>>;
type SdkProfile = ListItems<ReturnType<Agent['runtimeProfiles']['list']>>;

export type CatalogueTeamRecord = Pick<SdkTeam, 'id' | 'name'>;
export type CatalogueDiaryRecord = Pick<SdkDiary, 'id' | 'name' | 'teamId'>;

/**
 * Exactly the fields the composer renders, each typed by the canonical
 * profile — so `toolEnforcement` keeps its union rather than degrading to
 * `string`, and a field that changes upstream fails here.
 */
export type CatalogueProfileRecord = Pick<
  SdkProfile,
  | 'id'
  | 'name'
  | 'teamId'
  | 'description'
  | 'provider'
  | 'model'
  | 'runtimeKind'
  | 'toolEnforcement'
  | 'defaultWorkspaceMode'
  | 'maxTurns'
  | 'revision'
  | 'definitionCid'
  | 'requiredEnv'
  | 'requiredTools'
  | 'requiredExecutables'
>;

/**
 * The slice of an authenticated agent the catalogue reads. Kept as a narrow
 * port so the unit runs without a credential, but every shape in it comes from
 * the SDK.
 */
export interface CatalogueAgentPort {
  listTeams(): Promise<CatalogueTeamRecord[]>;
  listDiaries(): Promise<CatalogueDiaryRecord[]>;
  listProfiles(teamId: string): Promise<CatalogueProfileRecord[]>;
}

export interface CatalogueTeam {
  teamId: string;
  teamName: string;
  diaries: { id: string; name: string }[];
  /**
   * Non-null only when exactly one diary is known for the team, or the
   * identity binding names one that belongs to it. Null otherwise — which
   * covers both several diaries and none — and the operator chooses.
   */
  defaultDiaryId: string | null;
}

export interface CatalogueProfile extends CatalogueProfileRecord {
  ready: boolean;
  blockers: ProfileBlocker[];
}

export interface Catalogue {
  teams: CatalogueTeam[];
  defaultTeamId: string | null;
  profiles: CatalogueProfile[];
}

/** The identity-wide binding from `<agentDir>/env`, when it has one. */
export interface IdentityDefaultBinding {
  teamId?: string;
  diaryId?: string;
}

export async function buildCatalogue(options: {
  agent: CatalogueAgentPort;
  machine: MachineCapabilities;
  identityDefault: IdentityDefaultBinding;
}): Promise<Catalogue> {
  const { agent, machine, identityDefault } = options;
  const [teamRecords, diaryRecords] = await Promise.all([
    agent.listTeams(),
    agent.listDiaries(),
  ]);

  const teams: CatalogueTeam[] = teamRecords.map((team) => {
    const diaries = diaryRecords
      .filter((diary) => diary.teamId === team.id)
      .map((diary) => ({ id: diary.id, name: diary.name }));
    return {
      teamId: team.id,
      teamName: team.name,
      diaries,
      defaultDiaryId: resolveDefaultDiary(team.id, diaries, identityDefault),
    };
  });

  // A binding pointing at a team this identity cannot serve is stale; falling
  // back to the first team beats presenting an unusable default.
  const boundTeam = teams.find(
    (team) => team.teamId === identityDefault.teamId,
  );
  const defaultTeamId = boundTeam?.teamId ?? teams[0]?.teamId ?? null;

  const profileLists = await Promise.all(
    teams.map((team) => agent.listProfiles(team.teamId)),
  );
  const profiles = profileLists.flat().map((profile) => ({
    ...profile,
    ...deriveProfileReadiness(profile, machine),
  }));

  return { teams, defaultTeamId, profiles };
}

function resolveDefaultDiary(
  teamId: string,
  diaries: { id: string }[],
  identityDefault: IdentityDefaultBinding,
): string | null {
  const bound = diaries.find((diary) => diary.id === identityDefault.diaryId);
  if (bound && identityDefault.teamId === teamId) return bound.id;
  return diaries.length === 1 ? (diaries[0]?.id ?? null) : null;
}
