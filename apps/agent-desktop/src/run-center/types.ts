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
  AgentServerRun,
  AgentServerStatus,
  EnrollAgentServerTeamData,
  EnrollAgentServerTeamResponses,
} from '@moltnet/agent-daemon-api-client';

import type { DesktopStatus, LifecycleState } from '../bridge.js';

export type {
  AgentServerAgent,
  AgentServerCatalogue,
  AgentServerCatalogueProfile,
  AgentServerCatalogueTeam,
  AgentServerRun,
  AgentServerStatus,
  DesktopStatus,
  LifecycleState,
};

/** A profile blocker, as the server derives it for this machine. */
export type ProfileBlocker = AgentServerCatalogueProfile['blockers'][number];

/** v1 is polling only; the server also accepts `drain`. */
export type RunMode = Extract<AgentServerRun['mode'], 'poll'>;

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
  id: string;
  name: string;
  agent: string;
  teamId: string;
  diaryId: string | null;
  /** Ordered: primary first, then fallbacks. */
  profileIds: string[];
  taskTypes: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

/** What the composer sends to start a run. Mirrors the server's start body. */
export interface StartRunInput {
  agent: string;
  teamId: string;
  diaryId?: string;
  profiles: string[];
  taskTypes: string[];
  mode: RunMode;
}

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
  enrollTeam?: (
    identity: string,
    request: EnrollAgentServerTeamData['body'],
  ) => Promise<EnrollAgentServerTeamResponses[200]>;
  createIdentity?: (name: string, invitation: string) => Promise<void>;
  openTeamInvites?: (teamId?: string) => Promise<void>;
  refresh?: () => Promise<void>;
  /** Teams, diaries and profiles the selected identity can serve. */
  catalogue: (identity: string) => Promise<AgentServerCatalogue>;
  startRun: (input: StartRunInput) => Promise<AgentServerRun>;
  stopRun: (runId: string) => Promise<void>;
  savePreset: (input: SavePresetInput) => Promise<void>;
  deletePreset: (presetId: string) => Promise<void>;
  /** Streams a run's log lines. Returns an unsubscribe function. */
  subscribeRunLogs: (
    runId: string,
    onLine: (line: string) => void,
  ) => () => void;
}

/** Everything the shell renders. */
export interface RunCenterData {
  server: DesktopStatus;
  status: AgentServerStatus | null;
  runs: DesktopRun[];
  presets: RunPreset[];
  catalogue: AgentServerCatalogue | null;
}
