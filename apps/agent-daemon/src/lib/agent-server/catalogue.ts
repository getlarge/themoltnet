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
import { type Agent, MoltNetError } from '@themoltnet/sdk';
import type { FastifyBaseLogger } from 'fastify';

import { safeErrorContext } from '../safe-error-context.js';
import type { HoldAbandonedWork } from './catalogue-cache.js';
import { ProjectPaginationError } from './catalogue-project-reader.js';
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
type SdkProject = ListItems<ReturnType<Agent['projects']['list']>>;

export type CatalogueProject = Pick<
  SdkProject,
  'id' | 'teamId' | 'name' | 'description' | 'defaultDiaryId' | 'archived'
>;

export interface CatalogueProjectPage {
  items: CatalogueProject[];
  /** More projects exist than one discovery pass reads. */
  truncated: boolean;
}

/**
 * Coarse and additive: `forbidden` needs access changes, `unreachable` is worth
 * a retry, `invalid_response` is a server fault, `truncated` is informational.
 */
export type ProjectErrorCode =
  | 'forbidden'
  | 'unreachable'
  | 'invalid_response'
  | 'truncated';

export interface ProjectError {
  teamId: string;
  code: ProjectErrorCode;
  message: string;
}

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
  /** Called only after readTeam verifies this team's credential. */
  readProjects(
    teamId: string,
    signal?: AbortSignal,
  ): Promise<CatalogueProjectPage>;
  /** Called only after readTeam verifies this team's credential; null when not visible. */
  readProject(
    teamId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<CatalogueProject | null>;
  /** `signal` stops credential verification and any later step once aborted. */
  readTeam(
    teamId: string,
    signal?: AbortSignal,
  ): Promise<{
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
  projects: CatalogueProject[];
  projectErrors: ProjectError[];
}

/** The identity-wide binding from `<agentDir>/env`, when it has one. */
export interface IdentityDefaultBinding {
  teamId?: string;
  diaryId?: string;
}

/**
 * One team's budget for credential verification, resources and projects. It
 * must fit inside Desktop's 15 s control timeout with room to spare: a slow
 * team degrades to a blocker instead of failing the whole catalogue.
 */
export const CATALOGUE_TEAM_BUDGET_MS = 8_000;

/** What the network said about one team, before this machine's view is applied. */
export type CatalogueTeamSource =
  | {
      teamId: string;
      available: true;
      team: CatalogueTeamRecord;
      diaries: CatalogueDiaryRecord[];
      profiles: CatalogueProfileRecord[];
      credential: CredentialMetadata;
      projects: CatalogueProject[];
      projectErrors: ProjectError[];
    }
  | { teamId: string; available: false; blocker: CredentialBlocker };

const TEAM_TIMEOUT_BLOCKER: CredentialBlocker = {
  code: 'agent_key_unavailable',
  message: 'Verifying this team credential took too long.',
  remedy:
    'The catalogue retries automatically. Check connectivity if it persists.',
};

/**
 * The remote half of the catalogue: every team read with its own credential,
 * each bounded by its own budget so one slow team cannot hold the others.
 */
export async function readCatalogueSources(
  agent: CatalogueAgentPort,
  options: {
    signal?: AbortSignal;
    teamBudgetMs?: number;
    logger?: Pick<FastifyBaseLogger, 'warn'>;
    /**
     * Lets a caller share or reuse each team's read. Per team, so one degraded
     * team never forces the healthy ones to be verified again.
     */
    share?: (
      teamId: string,
      load: (hold: HoldAbandonedWork) => Promise<CatalogueTeamSource>,
    ) => Promise<CatalogueTeamSource>;
  } = {},
): Promise<CatalogueTeamSource[]> {
  const { signal, logger, share } = options;
  const budgetMs = options.teamBudgetMs ?? CATALOGUE_TEAM_BUDGET_MS;
  return Promise.all(
    agent.teamIds.map((teamId) => {
      const load = (hold: HoldAbandonedWork) =>
        readTeamSource(agent, teamId, { signal, budgetMs, logger, hold });
      return share ? share(teamId, load) : load(() => undefined);
    }),
  );
}

/**
 * Settles when `work` does or when `signal` aborts, whichever is first. Not
 * every step honours a signal (a secret-provider lookup may not), so the
 * budget is enforced here, a late result is discarded, and work still running
 * at the deadline is handed to `hold` so no one starts more of it meanwhile.
 */
function withinBudget<T>(
  work: Promise<T>,
  signal: AbortSignal,
  hold: HoldAbandonedWork,
): Promise<T> {
  if (signal.aborted) {
    hold(work);
    return Promise.reject(abortError(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      hold(work);
      reject(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error
    ? reason
    : new DOMException('The operation was aborted.', 'AbortError');
}

async function readTeamSource(
  agent: CatalogueAgentPort,
  teamId: string,
  options: {
    signal?: AbortSignal;
    budgetMs: number;
    logger?: Pick<FastifyBaseLogger, 'warn'>;
    hold: HoldAbandonedWork;
  },
): Promise<CatalogueTeamSource> {
  const { signal, logger, hold } = options;
  const budget = AbortSignal.timeout(options.budgetMs);
  const teamSignal = signal ? AbortSignal.any([signal, budget]) : budget;
  let result: Awaited<ReturnType<CatalogueAgentPort['readTeam']>>;
  try {
    result = await withinBudget(
      agent.readTeam(teamId, teamSignal),
      teamSignal,
      hold,
    );
    if (result.team.id !== teamId) throw new Error('Team response mismatch');
  } catch (error) {
    const timedOut = budget.aborted && !signal?.aborted;
    const blocker = timedOut ? TEAM_TIMEOUT_BLOCKER : credentialBlocker(error);
    // The catalogue answers 200 either way; without this line an
    // unavailable team leaves no trace of why.
    logger?.warn(
      {
        ...safeErrorContext(error),
        teamId,
        blocker: blocker.code,
        timedOut,
        code: 'agent_server_team_unavailable',
      },
      'AgentServer team credential unavailable',
    );
    return { teamId, available: false, blocker };
  }
  const verified = {
    teamId,
    available: true as const,
    team: result.team,
    diaries: result.diaries,
    profiles: result.profiles,
    credential: result.credential,
  };
  try {
    const page = await withinBudget(
      agent.readProjects(teamId, teamSignal),
      teamSignal,
      hold,
    );
    return {
      ...verified,
      projects: page.items,
      projectErrors: page.truncated
        ? [
            {
              teamId,
              code: 'truncated',
              message:
                'Only the first projects are listed. Archive unused projects to see the rest.',
            },
          ]
        : [],
    };
  } catch (error) {
    // Project discovery does not invalidate the credential just verified
    // above. General work and team/profile recovery remain available.
    logger?.warn(
      {
        ...safeErrorContext(error),
        teamId,
        timedOut: budget.aborted && !signal?.aborted,
        code: 'agent_server_project_discovery_failed',
      },
      'AgentServer project discovery failed',
    );
    return {
      ...verified,
      projects: [],
      projectErrors: [projectError(teamId, error)],
    };
  }
}

/**
 * Whether a team's read may be reused. Anything degraded is re-read on the
 * next request: a transient failure must never outlive its cause.
 */
export function isCatalogueSourceReusable(
  source: CatalogueTeamSource,
): boolean {
  return (
    source.available &&
    source.projectErrors.every((error) => error.code === 'truncated')
  );
}

/** The local half: this machine's readiness and the identity binding, always fresh. */
export function assembleCatalogue(
  sources: readonly CatalogueTeamSource[],
  options: {
    machine: MachineCapabilities;
    identityDefault: IdentityDefaultBinding;
    lastVerified: CatalogueAgentPort['lastVerified'];
  },
): Catalogue {
  const { machine, identityDefault, lastVerified } = options;
  const entries = sources.map((source) => {
    const { teamId } = source;
    if (!source.available) {
      const team: CatalogueTeam = {
        teamId,
        teamName: teamId,
        available: false,
        blockers: [source.blocker],
        credential: lastVerified(teamId),
        diaries: [],
        defaultDiaryId: null,
      };
      return { team, profiles: [], projects: [], projectErrors: [] };
    }
    const diaries = source.diaries
      .filter((diary) => diary.teamId === teamId)
      .map(({ id, name }) => ({ id, name }));
    const team: CatalogueTeam = {
      teamId,
      teamName: source.team.name,
      available: true,
      blockers: [],
      credential: source.credential,
      diaries,
      defaultDiaryId: resolveDefaultDiary(teamId, diaries, identityDefault),
    };
    const profiles = source.profiles
      .filter((profile) => profile.teamId === teamId)
      .map((profile) => ({
        ...profile,
        ...deriveProfileReadiness(profile, machine),
      }));
    const projects = source.projects.filter(
      (project) => project.teamId === teamId && !project.archived,
    );
    return { team, profiles, projects, projectErrors: source.projectErrors };
  });
  const teams = entries.map(({ team }) => team);
  const available = teams.filter((team) => team.available);
  const defaultTeamId =
    available.find((team) => team.teamId === identityDefault.teamId)?.teamId ??
    available[0]?.teamId ??
    null;

  return {
    teams,
    defaultTeamId,
    profiles: entries.flatMap((entry) => entry.profiles),
    projects: entries.flatMap((entry) => entry.projects),
    projectErrors: entries.flatMap((entry) => entry.projectErrors),
  };
}

export async function buildCatalogue(options: {
  agent: CatalogueAgentPort;
  machine: MachineCapabilities;
  identityDefault: IdentityDefaultBinding;
  logger?: Pick<FastifyBaseLogger, 'warn'>;
  signal?: AbortSignal;
  teamBudgetMs?: number;
}): Promise<Catalogue> {
  const { agent, machine, identityDefault } = options;
  return assembleCatalogue(await readCatalogueSources(agent, options), {
    machine,
    identityDefault,
    lastVerified: (teamId) => agent.lastVerified(teamId),
  });
}

function projectError(teamId: string, error: unknown): ProjectError {
  if (
    error instanceof MoltNetError &&
    (error.statusCode === 401 || error.statusCode === 403)
  )
    return {
      teamId,
      code: 'forbidden',
      message:
        'This team credential cannot list projects. Renew it with project access.',
    };
  if (error instanceof ProjectPaginationError)
    return {
      teamId,
      code: 'invalid_response',
      message: 'The server returned an unreadable project list.',
    };
  return {
    teamId,
    code: 'unreachable',
    message: 'Projects could not be loaded. Retry project discovery.',
  };
}

/** The one default-diary rule, shared with General run start. */
export function resolveDefaultDiary(
  teamId: string,
  diaries: { id: string }[],
  identityDefault: IdentityDefaultBinding,
): string | null {
  const bound = diaries.find((diary) => diary.id === identityDefault.diaryId);
  if (bound && identityDefault.teamId === teamId) return bound.id;
  return diaries.length === 1 ? (diaries[0]?.id ?? null) : null;
}
