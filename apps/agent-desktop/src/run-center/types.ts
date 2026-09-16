/**
 * Desktop Run Center view model.
 *
 * These types are the shape the renderer needs. They are deliberately written
 * before the transport exists: PR 1 (Agent Server desktop-control contract)
 * has to produce them, PR 2 (native Rust HTTP client) has to carry them across
 * the bridge without the process-scoped token ever entering the WebView, and
 * PR 3 (custom runtime registration) owns `RuntimeEntry`.
 *
 * Nothing here calls Tauri. Every view is a pure function of these values plus
 * a `RunCenterActions` implementation, so the fixture harness and the native
 * bridge are interchangeable.
 */

export type RunStatus = 'running' | 'exited' | 'stopped' | 'failed';

/**
 * The shipped lifecycle contract (#2288/#2306) is reused as-is: the Run
 * Center adds views around it, it does not restate it.
 */
import type { DesktopStatus, LifecycleState } from '../bridge.js';

export type { DesktopStatus, LifecycleState };

/** v1 is polling only. `drain` stays in the server protocol, not the desktop. */
export type RunMode = 'poll';

/** An error the user can act on, as opposed to a stack trace. */
export interface ActionableError {
  /** Stable machine code, e.g. `profile_env_missing`. */
  code: string;
  /** What went wrong, in the user's terms. */
  message: string;
  /** What to do about it. Omitted when there is no user-side remedy. */
  remedy?: string;
  /** Deep link that performs the remedy, when one exists. */
  remedyAction?: { label: string; target: 'console' | 'runtimes' | 'logs' };
}

export interface DesktopRun {
  id: string;
  /** Set when the run was started from a saved preset. */
  presetName: string | null;
  agent: string;
  teamId: string;
  teamName: string;
  /**
   * Ordered. `profiles[0]` is the primary; the rest are fallbacks the daemon
   * tries in order. Names, not ids — the server resolves them for display.
   */
  profiles: string[];
  taskTypes: string[];
  mode: RunMode;
  status: RunStatus;
  pid: number | null;
  exitCode: number | null;
  startedAt: string;
  endedAt: string | null;
  /** Tasks this run has claimed since it started. */
  tasksClaimed: number;
  /** Last time the run claimed or completed a task. */
  lastActivityAt: string | null;
  lastError: ActionableError | null;
}

export interface ProfileReadinessBlocker {
  code: 'env_missing' | 'executable_missing' | 'runtime_unregistered';
  message: string;
  remedy: string;
}

/**
 * Profile catalogue entry. Read-only by design: authoring stays in Console.
 * `readiness` is computed by the Agent Server against *this machine* — the
 * provider keys it holds and the runtime kinds registered on it.
 */
export interface ProfileSummary {
  id: string;
  name: string;
  description: string | null;
  provider: string;
  model: string;
  runtimeKind: string;
  toolEnforcement: 'off' | 'watch' | 'enforce';
  defaultWorkspaceMode: 'none' | 'shared_mount' | 'dedicated_worktree' | null;
  maxTurns: number;
  requiredEnv: string[];
  requiredExecutables: string[];
  revision: number;
  definitionCid: string;
  updatedAt: string;
  ready: boolean;
  blockers: ProfileReadinessBlocker[];
}

export interface TeamSummary {
  id: string;
  name: string;
}

export interface AgentSummary {
  agentName: string;
  kind: 'managed' | 'external';
  /** Managed agents are key-bound to one team and cannot poll another. */
  boundTeamId: string | null;
  fingerprint: string | null;
}

export interface TaskTypeSummary {
  type: string;
  title: string;
  summary: string;
}

/** What this Agent Server build can do. Lets the desktop stay version-tolerant. */
export interface DesktopCapabilities {
  taskTypes: TaskTypeSummary[];
  modes: RunMode[];
  /** Runtime kinds this machine can execute right now. */
  runtimeKinds: string[];
  supportsCustomRuntimes: boolean;
}

/** Saved locally, on this machine. Never auto-started. */
export interface RunPreset {
  id: string;
  name: string;
  agent: string;
  teamId: string;
  /** Ordered: primary first. Profile ids, resolved for display at read time. */
  profileIds: string[];
  taskTypes: string[];
  mode: RunMode;
  createdAt: string;
  lastUsedAt: string | null;
}

export type RuntimeSource = 'builtin' | 'file' | 'package';

/**
 * Drift is the reason a registration exists at all: the registry pins a
 * fingerprint so a module that changed under the operator's feet refuses to
 * run instead of silently executing new code.
 */
export type RuntimeDrift =
  | 'none'
  | 'entry_changed'
  | 'lockfile_changed'
  | 'missing';

export interface RuntimeEntry {
  kind: string;
  source: RuntimeSource;
  /** Absolute file path, or package name. Empty for the built-in runtime. */
  label: string;
  /** Project directory a package registration resolves against. */
  projectDir: string | null;
  /** sha256 of the resolved entry module. */
  entryHash: string | null;
  lockfilePath: string | null;
  registeredAt: string | null;
  drift: RuntimeDrift;
  /** Profile names in the catalogue that name this kind. */
  usedByProfiles: string[];
}

/** What the register dialog shows before the operator consents. */
export interface RuntimeCandidate {
  source: Exclude<RuntimeSource, 'builtin'>;
  label: string;
  projectDir: string | null;
  /** Derived from the module's own `runtimeKind`, never typed by the user. */
  kind: string;
  entryHash: string;
  lockfilePath: string | null;
  /** Set when validation failed; the dialog then offers no Register action. */
  error: ActionableError | null;
}

export interface RunCenterData {
  server: DesktopStatus;
  runs: DesktopRun[];
  presets: RunPreset[];
  profiles: ProfileSummary[];
  teams: TeamSummary[];
  agents: AgentSummary[];
  capabilities: DesktopCapabilities;
  runtimes: RuntimeEntry[];
}

export interface StartRunInput {
  agent: string;
  teamId: string;
  /** Ordered: primary first, then fallbacks. */
  profileIds: string[];
  taskTypes: string[];
  mode: RunMode;
  presetName: string | null;
}

export interface SavePresetInput {
  id: string | null;
  name: string;
  agent: string;
  teamId: string;
  profileIds: string[];
  taskTypes: string[];
  mode: RunMode;
}

/**
 * Side effects the *Run Center* adds. Server install/trust/start/stop already
 * have a contract — `desktopBridge` in `../bridge.ts` — and it is used
 * directly by the shipped server panel. Nothing here duplicates it.
 */
export interface RunCenterActions {
  startRun(input: StartRunInput): Promise<void>;
  stopRun(runId: string): Promise<void>;
  savePreset(input: SavePresetInput): Promise<void>;
  deletePreset(presetId: string): Promise<void>;
  /** Opens the native file picker. Resolves null when the user cancels. */
  pickRuntimeFile(): Promise<RuntimeCandidate | null>;
  /** Opens the native directory picker, then validates the package there. */
  pickRuntimePackage(
    packageName: string,
    projectDir: string,
  ): Promise<RuntimeCandidate>;
  pickDirectory(): Promise<string | null>;
  registerRuntime(candidate: RuntimeCandidate): Promise<void>;
  unregisterRuntime(kind: string): Promise<void>;
  openLogs(): Promise<void>;
  /** Streams a run's log lines. Returns an unsubscribe function. */
  subscribeRunLogs(runId: string, onLine: (line: string) => void): () => void;
}
