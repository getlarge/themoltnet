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
  AgentServerProvider,
  AgentServerRun,
  AgentServerStatus,
  AgentServerSubscription,
  AgentServerSubscriptionLogin,
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
  /** Teams, diaries and profiles the selected identity can serve. */
  catalogue(identity: string): Promise<AgentServerCatalogue>;
  startRun(input: StartRunInput): Promise<AgentServerRun>;
  stopRun(runId: string): Promise<void>;
  savePreset(input: SavePresetInput): Promise<void>;
  deletePreset(presetId: string): Promise<void>;
  /** Streams a run's log lines. Returns an unsubscribe function. */
  subscribeRunLogs(runId: string, onLine: (line: string) => void): () => void;
}

/**
 * Provider credential operations. Separate from `RunCenterActions` because
 * this is machine setup rather than run composition, and because a surface
 * that writes secrets deserves its own, small contract.
 */
export interface ProviderActions {
  putProvider(
    providerId: string,
    config: {
      api: string;
      baseUrl: string;
      envName: string;
      models: AgentServerProvider['models'];
      /** Write-only: the server never echoes it back. */
      apiKey?: string;
    },
  ): Promise<AgentServerProvider>;
  deleteProvider(providerId: string): Promise<void>;
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
  server: DesktopStatus;
  status: AgentServerStatus | null;
  runs: DesktopRun[];
  presets: RunPreset[];
  catalogue: AgentServerCatalogue | null;
  providers: Record<string, AgentServerProvider>;
  subscriptions: AgentServerSubscription[];
}
