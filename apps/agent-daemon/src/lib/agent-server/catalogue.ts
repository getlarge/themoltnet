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
import {
  type CredentialBlocker,
  credentialBlocker,
  type CredentialMetadata,
} from './team-credentials.js';

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
  /** Local indexed slots, not a cross-team API query. */
  teamIds: string[];
  lastVerified(teamId: string): CredentialMetadata | undefined;
  readTeam(teamId: string): Promise<{
    team: CatalogueTeamRecord;
    diaries: CatalogueDiaryRecord[];
    profiles: CatalogueProfileRecord[];
    credential: CredentialMetadata;
  }>;
}

export interface CatalogueTeam {
  teamId: string;
  teamName: string;
  available: boolean;
  blockers: CredentialBlocker[];
  credential?: CredentialMetadata;
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
  const entries = await Promise.all(
    agent.teamIds.map(async (teamId) => {
      try {
        const result = await agent.readTeam(teamId);
        if (result.team.id !== teamId)
          throw new Error('Team response mismatch');
        const diaries = result.diaries
          .filter((diary) => diary.teamId === teamId)
          .map(({ id, name }) => ({ id, name }));
        const team: CatalogueTeam = {
          teamId,
          teamName: result.team.name,
          available: true,
          blockers: [],
          credential: result.credential,
          diaries,
          defaultDiaryId: resolveDefaultDiary(teamId, diaries, identityDefault),
        };
        const profiles = result.profiles
          .filter((profile) => profile.teamId === teamId)
          .map((profile) => ({
            ...profile,
            ...deriveProfileReadiness(profile, machine),
          }));
        return { team, profiles };
      } catch (error) {
        const team: CatalogueTeam = {
          teamId,
          teamName: teamId,
          available: false,
          blockers: [credentialBlocker(error)],
          credential: agent.lastVerified(teamId),
          diaries: [],
          defaultDiaryId: null,
        };
        return { team, profiles: [] };
      }
    }),
  );
  const teams = entries.map(({ team }) => team);
  const available = teams.filter((team) => team.available);
  const defaultTeamId =
    available.find((team) => team.teamId === identityDefault.teamId)?.teamId ??
    available[0]?.teamId ??
    null;
  const profiles = entries.flatMap((entry) => entry.profiles);

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
