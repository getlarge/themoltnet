/**
 * Desktop Run Center view model.
 *
 * Everything the Agent Server owns is **derived** from
 * `@moltnet/agent-daemon-api-client`, which is generated from the daemon's
 * OpenAPI. Re-declaring those shapes here is how fields silently drift out of
 * the contract, so the only types written by hand are the ones the desktop
 * genuinely owns: local presets, and the join between a run and the names the
 * app can resolve for it.
 */
import type {
  AgentServerAgent,
  AgentServerCatalogue,
  AgentServerCatalogueProfile,
  AgentServerCatalogueTeam,
  AgentServerProjectLocation,
  AgentServerProvider,
  AgentServerRun,
  AgentServerStatus,
  AgentServerSubscription,
  AgentServerSubscriptionLogin,
  CreateAgentServerAgentResponses,
  EnrollAgentServerTeamData,
  EnrollAgentServerTeamResponses,
  ListAgentServerOperatorTeamsResponses,
  ListNativeProjectLocationsResponse,
  SaveNativeProjectLocationData,
  StartAgentServerRunData,
} from '@moltnet/agent-daemon-api-client';

import type { DesktopStatus, LifecycleState } from '../bridge.js';

export type {
  AgentServerAgent,
  AgentServerCatalogue,
  AgentServerCatalogueProfile,
  AgentServerCatalogueTeam,
  AgentServerProvider,
  AgentServerRun,
  AgentServerStatus,
  AgentServerSubscription,
  AgentServerSubscriptionLogin,
  DesktopStatus,
  LifecycleState,
};

/** A profile blocker, as the server derives it for this machine. */
export type ProfileBlocker = AgentServerCatalogueProfile['blockers'][number];

/** New runs poll by default; Run again can replay a previous drain run. */
export type RunMode = AgentServerRun['mode'];

/**
 * A run plus the names only the app can resolve: the preset it was launched
 * from (local) and the team's display name (joined from the catalogue). The
 * run itself is the server's type, unmodified.
 */
export interface DesktopRun extends AgentServerRun {
  presetName: string | null;
  teamName: string | null;
}

/**
 * A named run configuration, saved on this machine.
 *
 * Owned by the desktop, not the server: presets are per-machine UI state that
 * never auto-starts and that nothing but this app reads.
 */
export interface RunPreset {
  /** Version 2 stores explicit choices; null diary uses current defaults. */
  version?: 2;
  id: string;
  name: string;
  agent: string;
  teamId: string;
  diaryId: string | null;
  projectId?: string | null;
  /** A saved location by name. */
  location?: string;
  source?: string;
  strategy?: StartRunInput['strategy'];
  /** Ordered: primary first, then fallbacks. */
  profileIds: string[];
  taskTypes: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

/** What the composer sends to start a run. Mirrors the server's start body. */
export type StartRunInput = Omit<
  NonNullable<StartAgentServerRunData['body']>,
  'mode' | 'taskTypes'
> & { mode: RunMode; taskTypes: string[] };

export interface SavePresetInput extends Omit<
  RunPreset,
  'id' | 'createdAt' | 'lastUsedAt'
> {
  id: string | null;
}

/**
 * Every side effect the renderer can ask for.
 *
 * Server lifecycle (install, trust, start, stop, updates) already has a
 * contract — `desktopBridge` in `../bridge.ts` — and is used directly by the
 * shipped Server panel. Nothing here duplicates it.
 */
export interface RunCenterActions {
  projects?: ProjectActions;
  signInOperator?: () => Promise<void>;
  operatorTeams?: () => Promise<ListAgentServerOperatorTeamsResponses[200]>;
  cancelOperatorApproval?: () => Promise<void>;
  enrollTeam?: (
    identity: string,
    request: EnrollAgentServerTeamData['body'],
  ) => Promise<EnrollAgentServerTeamResponses[200]>;
  listEnrollmentRecoveries?: (identity: string) => Promise<{
    items: {
      recoveryId: string;
      secretCaptured: boolean;
      teamId?: string;
      keyId?: string;
      operation?: string;
      createdAt: string;
    }[];
  }>;
  restoreEnrollment?: (
    identity: string,
    recoveryId: string,
  ) => Promise<{ state: 'persisted'; teamId: string; keyId: string }>;
  createManagedAgent?: (
    name: string,
    enrollmentToken: string,
  ) => Promise<CreateAgentServerAgentResponses[201]>;
  refresh?: () => Promise<void>;
  /** Teams, diaries and profiles the selected identity can serve. */
  catalogue: (identity: string) => Promise<AgentServerCatalogue>;
  startRun: (input: StartRunInput) => Promise<AgentServerRun>;
  stopRun: (runId: string) => Promise<void>;
  savePreset: (input: SavePresetInput) => Promise<RunPreset>;
  deletePreset: (presetId: string) => Promise<void>;
  /** Follows a bounded run log tail. Returns an unsubscribe function. */
  subscribeRunLogs: (
    runId: string,
    onLines: (lines: string[]) => void,
  ) => () => void;
}

/**
 * Provider credential operations. Separate from `RunCenterActions` because
 * this is machine setup rather than run composition, and because a surface
 * that writes secrets deserves its own, small contract.
 */
export type { ProviderActions } from '@moltnet/task-ui/local-providers';

export type ProjectLocation = AgentServerProjectLocation;
/** The location name addresses the record; the rest is its saved body. */
export type SaveProjectLocationInput = SaveNativeProjectLocationData['body'] &
  SaveNativeProjectLocationData['path'];

/** Local folder registrations; native code owns the grant and the folder picker. */
export interface ProjectActions {
  list: () => Promise<ListNativeProjectLocationsResponse>;
  /** Drop the shared Desktop snapshot before retrying a native read. */
  invalidate?: () => void;
  save: (input: SaveProjectLocationInput) => Promise<ProjectLocation>;
  remove: (name: string) => Promise<void>;
  chooseFolder: () => Promise<string | null>;
}

/**
 * Signing in to an existing LLM subscription, as an alternative to pasting an
 * API key. This is the wider door: a subscription the operator already has is
 * far more reachable than obtaining and handling a key.
 */
export interface SubscriptionActions {
  startLogin(providerId: string): Promise<AgentServerSubscriptionLogin>;
  loginStatus(providerId: string): Promise<AgentServerSubscriptionLogin>;
  cancelLogin(providerId: string): Promise<void>;
  /** Opens the provider page natively; only https is accepted. */
  openSignIn(url: string): Promise<void>;
}

/** Everything the shell renders. */
export interface RunCenterData {
  operatorConfigured?: boolean;
  operatorEmail?: string | null;
  server: DesktopStatus;
  status: AgentServerStatus | null;
  runs: DesktopRun[];
  presets: RunPreset[];
  providers: Record<string, AgentServerProvider>;
  subscriptions: AgentServerSubscription[];
}
