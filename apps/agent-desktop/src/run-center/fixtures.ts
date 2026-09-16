/**
 * Fixture data for the Run Center prototype.
 *
 * PROTOTYPE ONLY — this module and the `prototype/` harness that mounts it are
 * not part of the desktop app build and must not ship. The views import only
 * `types.ts`; nothing in `src/run-center/*View.tsx` imports this file.
 *
 * Every value is synthetic. Agent names, team names, profile names, hashes and
 * paths are invented; they are shaped to match real MoltNet records so the
 * layout is exercised at realistic density, not to assert that any of it
 * exists.
 */
import type {
  AgentSummary,
  DesktopCapabilities,
  DesktopRun,
  DesktopStatus,
  ProfileSummary,
  RunCenterActions,
  RunCenterData,
  RunPreset,
  RuntimeCandidate,
  RuntimeEntry,
  TeamSummary,
} from './types.js';

/** Frozen clock so screenshots are byte-stable across runs. */
export const FIXTURE_NOW = Date.parse('2026-09-16T14:32:10.000Z');

const ago = (ms: number) => new Date(FIXTURE_NOW - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export type ScenarioId =
  | 'populated'
  | 'first-run'
  | 'run-failed'
  | 'profile-blocked'
  | 'needs-trust'
  | 'runtime-drift';

const TEAMS: TeamSummary[] = [
  { id: '4f2a91c8-1d3e-4b77-9a02-6c1b8e7d5a40', name: 'MoltNet Core' },
  { id: 'b83c0d16-7e54-4a91-8f22-0d95c4e61b38', name: 'Clairon Pilot' },
];

const AGENTS: AgentSummary[] = [
  {
    agentName: 'legreffier',
    kind: 'managed',
    boundTeamId: TEAMS[0].id,
    fingerprint: 'SHA256:9c4f2a71e6b8',
  },
  {
    agentName: 'scout',
    kind: 'managed',
    boundTeamId: TEAMS[0].id,
    fingerprint: 'SHA256:2e17b9d0c4a3',
  },
  {
    agentName: 'clairon-worker',
    kind: 'managed',
    boundTeamId: TEAMS[1].id,
    fingerprint: 'SHA256:77d1e0ab935c',
  },
];

function profile(
  overrides: Partial<ProfileSummary> & Pick<ProfileSummary, 'id' | 'name'>,
): ProfileSummary {
  return {
    description: null,
    provider: 'anthropic',
    model: 'claude-opus-5',
    runtimeKind: 'gondolin_pi',
    toolEnforcement: 'enforce',
    defaultWorkspaceMode: 'dedicated_worktree',
    maxTurns: 40,
    requiredEnv: ['ANTHROPIC_API_KEY'],
    requiredExecutables: ['git'],
    revision: 3,
    definitionCid: 'bafyreih5k2qz7x4m9wnd3tvu6ge8sc1prbjyloa',
    updatedAt: ago(6 * 24 * HOUR),
    ready: true,
    blockers: [],
    ...overrides,
  };
}

const PROFILES: ProfileSummary[] = [
  profile({
    id: 'a1d4e7f2-3b6c-4d81-9e05-7c2a8b4f1d63',
    name: 'opus-review',
    description:
      'Deep code review with a dedicated worktree and enforced tool policy.',
    revision: 7,
    updatedAt: ago(2 * 24 * HOUR),
  }),
  profile({
    id: 'c9b2f408-5a71-4e36-8d90-1f4e6a2c7b58',
    name: 'sonnet-fallback',
    description: 'Cheaper second pass when the primary profile cannot run.',
    model: 'claude-sonnet-5',
    maxTurns: 25,
    revision: 4,
    definitionCid: 'bafyreic3n8pw1vfk5rjdz2ougm7bt4xlqyeahs0',
  }),
  profile({
    id: 'e5a83c17-9d24-4f60-b1c8-3e07d592a4f1',
    name: 'nightly-digest',
    description: 'Reads the team diary and writes the morning digest.',
    runtimeKind: 'gondolin_pi',
    defaultWorkspaceMode: 'none',
    toolEnforcement: 'watch',
    maxTurns: 12,
    requiredExecutables: [],
    revision: 2,
    definitionCid: 'bafyreidq6l0zt8ecx3nvug74mbhpr9yasfkwoi5',
  }),
  profile({
    id: '7d1f6b92-4c08-4a53-9e27-5b8d0a3f6c14',
    name: 'acme-pipeline',
    description: 'Runs the Acme adapter against the customer sandbox.',
    provider: 'openai',
    model: 'gpt-5.2',
    runtimeKind: 'acme_runtime',
    requiredEnv: ['OPENAI_API_KEY', 'ACME_WORKSPACE_TOKEN'],
    revision: 1,
    definitionCid: 'bafyreifg2m8xkr0vn5wdc7pysoq3lb1theuaz9j',
    ready: false,
    blockers: [
      {
        code: 'env_missing',
        message: 'ACME_WORKSPACE_TOKEN is not configured on this machine.',
        remedy: 'Add the key under Providers in Console, then reopen this run.',
      },
      {
        code: 'runtime_unregistered',
        message: 'Runtime kind acme_runtime has drifted since registration.',
        remedy: 'Re-register the runtime under Runtimes.',
      },
    ],
  }),
];

const TASK_TYPES: DesktopCapabilities['taskTypes'] = [
  {
    type: 'freeform',
    title: 'Freeform',
    summary: 'Any instruction with a prompt and a text or file result.',
  },
  {
    type: 'pr_review',
    title: 'PR review',
    summary: 'Reviews a pull request and returns structured findings.',
  },
  {
    type: 'fulfill_brief',
    title: 'Fulfill brief',
    summary: 'Completes a brief against its stated success criteria.',
  },
  {
    type: 'assess_brief',
    title: 'Assess brief',
    summary: 'Scores a brief before it is dispatched.',
  },
  {
    type: 'curate_pack',
    title: 'Curate pack',
    summary: 'Selects diary entries for a context pack.',
  },
  {
    type: 'render_pack',
    title: 'Render pack',
    summary: 'Renders a curated pack into runtime context.',
  },
  {
    type: 'run_eval',
    title: 'Run eval',
    summary: 'Executes one eval scenario and records the attempt.',
  },
  {
    type: 'judge_pack',
    title: 'Judge pack',
    summary: 'Scores a rendered pack against its rubric.',
  },
];

const RUNTIMES: RuntimeEntry[] = [
  {
    kind: 'gondolin_pi',
    source: 'builtin',
    label: '',
    projectDir: null,
    entryHash: null,
    lockfilePath: null,
    registeredAt: null,
    drift: 'none',
    usedByProfiles: ['opus-review', 'sonnet-fallback', 'nightly-digest'],
  },
  {
    kind: 'acme_runtime',
    source: 'package',
    label: '@acme/moltnet-runtime',
    projectDir: '/Users/you/dev/acme-adapter',
    entryHash:
      '4f9c1b7e2a05d38641cbe9f07a2d5c83b16e4097fa2d8b5c31e07a94d62f8a12',
    lockfilePath: '/Users/you/dev/acme-adapter/pnpm-lock.yaml',
    registeredAt: ago(11 * 24 * HOUR),
    drift: 'none',
    usedByProfiles: ['acme-pipeline'],
  },
  {
    kind: 'lab_runtime',
    source: 'file',
    label: '/Users/you/dev/lab-runtime/dist/adapter.js',
    projectDir: null,
    entryHash:
      'b72e0a4c91d6f38052ae7c14b90d6fe3a58c2071d94b6e8305fa1c7d2b40e96f',
    lockfilePath: null,
    registeredAt: ago(3 * 24 * HOUR),
    drift: 'none',
    usedByProfiles: [],
  },
];

const PRESETS: RunPreset[] = [
  {
    id: 'preset-nightly',
    name: 'Nightly digest',
    agent: 'scout',
    teamId: TEAMS[0].id,
    profileIds: [PROFILES[2].id],
    taskTypes: ['freeform'],
    mode: 'poll',
    createdAt: ago(20 * 24 * HOUR),
    lastUsedAt: ago(14 * HOUR),
  },
  {
    id: 'preset-review',
    name: 'PR review',
    agent: 'legreffier',
    teamId: TEAMS[0].id,
    profileIds: [PROFILES[0].id, PROFILES[1].id],
    taskTypes: ['pr_review', 'freeform'],
    mode: 'poll',
    createdAt: ago(9 * 24 * HOUR),
    lastUsedAt: ago(12 * MINUTE),
  },
  {
    id: 'preset-evals',
    name: 'Eval sweep',
    agent: 'scout',
    teamId: TEAMS[0].id,
    profileIds: [PROFILES[1].id],
    taskTypes: ['run_eval', 'judge_pack'],
    mode: 'poll',
    createdAt: ago(31 * 24 * HOUR),
    lastUsedAt: null,
  },
];

const RUNNING: DesktopRun = {
  id: 'run_01k6ydm4v8e2rtq7',
  presetName: 'PR review',
  agent: 'legreffier',
  teamId: TEAMS[0].id,
  teamName: 'MoltNet Core',
  profiles: ['opus-review', 'sonnet-fallback'],
  taskTypes: ['pr_review', 'freeform'],
  mode: 'poll',
  status: 'running',
  pid: 48211,
  exitCode: null,
  startedAt: ago(12 * MINUTE + 4000),
  endedAt: null,
  tasksClaimed: 3,
  lastActivityAt: ago(2 * MINUTE),
  lastError: null,
};

const RECENT: DesktopRun[] = [
  {
    id: 'run_01k6y8p0c3n9wbla',
    presetName: 'Nightly digest',
    agent: 'scout',
    teamId: TEAMS[0].id,
    teamName: 'MoltNet Core',
    profiles: ['nightly-digest'],
    taskTypes: ['freeform'],
    mode: 'poll',
    status: 'stopped',
    pid: null,
    exitCode: 0,
    startedAt: ago(14 * HOUR),
    endedAt: ago(13 * HOUR),
    tasksClaimed: 1,
    lastActivityAt: ago(13 * HOUR + 20 * MINUTE),
    lastError: null,
  },
  {
    id: 'run_01k6xr72jd5h0vte',
    presetName: null,
    agent: 'clairon-worker',
    teamId: TEAMS[1].id,
    teamName: 'Clairon Pilot',
    profiles: ['acme-pipeline'],
    taskTypes: ['fulfill_brief'],
    mode: 'poll',
    status: 'failed',
    pid: null,
    exitCode: 1,
    startedAt: ago(2 * 24 * HOUR),
    endedAt: ago(2 * 24 * HOUR - 40_000),
    tasksClaimed: 0,
    lastActivityAt: null,
    lastError: {
      code: 'profile_env_missing',
      message:
        'acme-pipeline needs ACME_WORKSPACE_TOKEN, which this machine does not have.',
      remedy:
        'Add the key under Providers in Console, then start the run again.',
      remedyAction: { label: 'Open Console', target: 'console' },
    },
  },
];

const SERVER_RUNNING: DesktopStatus = {
  state: 'running',
  installedVersion: '0.41.2',
  availableVersion: null,
  trustFingerprint: 'A4:1F:9C:20:7B:E8:03:D5',
  trusted: true,
  message:
    'Serving the local control API on 127.0.0.1:17374. Runs keep going while the window is closed.',
  logs: [
    '14:19:58  agent-server  listening on 127.0.0.1:17374 (local TLS)',
    '14:20:01  agent-server  native client attached (process-scoped grant)',
    '14:20:06  agent-server  catalogue refreshed: 2 teams, 4 profiles',
    '14:20:06  agent-server  runtime registry: gondolin_pi, acme_runtime, lab_runtime',
  ],
};

const RUN_LOG_LINES = [
  '14:20:06  poll  worker ready · profiles opus-review → sonnet-fallback',
  '14:20:06  poll  filter task_types=pr_review,freeform team=MoltNet Core',
  '14:21:44  poll  claimed task tsk_01k6ydn2 (pr_review) lease 15m',
  '14:21:45  run   runtime gondolin_pi · workspace dedicated_worktree',
  '14:21:45  run   tool policy enforce · 128 tools allowed',
  '14:26:12  run   attempt 1 finished · output accepted',
  '14:26:12  poll  released lease for tsk_01k6ydn2',
  '14:28:03  poll  claimed task tsk_01k6ydq7 (freeform) lease 15m',
  '14:28:04  run   runtime gondolin_pi · workspace dedicated_worktree',
  '14:30:10  run   attempt 1 finished · output accepted',
  '14:30:11  poll  claimed task tsk_01k6ydr1 (pr_review) lease 15m',
  '14:30:12  run   runtime gondolin_pi · workspace dedicated_worktree',
  '14:32:08  poll  heartbeat ok · 3 claimed this run',
];

function baseData(): RunCenterData {
  return {
    server: { ...SERVER_RUNNING },
    runs: [RUNNING, ...RECENT],
    presets: PRESETS,
    profiles: PROFILES,
    teams: TEAMS,
    agents: AGENTS,
    capabilities: {
      taskTypes: TASK_TYPES,
      modes: ['poll'],
      runtimeKinds: ['gondolin_pi', 'acme_runtime', 'lab_runtime'],
      supportsCustomRuntimes: true,
    },
    runtimes: RUNTIMES,
  };
}

export function scenarioData(scenario: ScenarioId): RunCenterData {
  const data = baseData();
  switch (scenario) {
    case 'populated':
      return data;
    case 'first-run':
      return {
        ...data,
        runs: [],
        presets: [],
        runtimes: [RUNTIMES[0]],
        capabilities: { ...data.capabilities, runtimeKinds: ['gondolin_pi'] },
      };
    case 'run-failed':
      return { ...data, runs: [RECENT[1], RECENT[0]] };
    case 'profile-blocked':
      return { ...data, runs: [] };
    case 'needs-trust':
      return {
        ...data,
        runs: [],
        server: {
          ...data.server,
          state: 'needs_trust',
          trusted: false,
          message:
            'Console and this app reach the Agent Server over local HTTPS. macOS needs your approval once.',
          logs: [],
        },
      };
    case 'runtime-drift':
      return {
        ...data,
        runtimes: [
          RUNTIMES[0],
          { ...RUNTIMES[1], drift: 'entry_changed' },
          { ...RUNTIMES[2], drift: 'missing' },
        ],
      };
  }
}

export const FIXTURE_RUN_LOGS: Record<string, string[]> = {
  [RUNNING.id]: RUN_LOG_LINES,
  [RECENT[0].id]: [
    '00:12:41  poll  worker ready · profile nightly-digest',
    '00:19:02  poll  claimed task tsk_01k6y8q4 (freeform) lease 15m',
    '00:41:55  run   attempt 1 finished · output accepted',
    '01:31:20  poll  stop requested · draining',
    '01:31:21  poll  worker exited cleanly (0)',
  ],
  [RECENT[1].id]: [
    '11:04:12  poll  worker ready · profile acme-pipeline',
    '11:04:12  run   resolving runtime kind acme_runtime',
    '11:04:12  run   ERROR profile acme-pipeline requires ACME_WORKSPACE_TOKEN',
    '11:04:12  poll  worker exited (1)',
  ],
};

/** The candidate a fixture native file-picker "returns". */
export const FIXTURE_FILE_CANDIDATE: RuntimeCandidate = {
  source: 'file',
  label: '/Users/you/dev/lab-runtime/dist/adapter.js',
  projectDir: null,
  kind: 'lab_runtime',
  entryHash:
    'b72e0a4c91d6f38052ae7c14b90d6fe3a58c2071d94b6e8305fa1c7d2b40e96f',
  lockfilePath: null,
  error: null,
};

export const FIXTURE_PACKAGE_CANDIDATE: RuntimeCandidate = {
  source: 'package',
  label: '@acme/moltnet-runtime',
  projectDir: '/Users/you/dev/acme-adapter',
  kind: 'acme_runtime',
  entryHash:
    '4f9c1b7e2a05d38641cbe9f07a2d5c83b16e4097fa2d8b5c31e07a94d62f8a12',
  lockfilePath: '/Users/you/dev/acme-adapter/pnpm-lock.yaml',
  error: null,
};

export const FIXTURE_INVALID_CANDIDATE: RuntimeCandidate = {
  source: 'package',
  label: '@acme/moltnet-runtime',
  projectDir: '/Users/you/dev/acme-adapter',
  kind: '',
  entryHash: '',
  lockfilePath: null,
  error: {
    code: 'runtime_not_installed',
    message:
      '@acme/moltnet-runtime is not installed in /Users/you/dev/acme-adapter.',
    remedy:
      'Install it there with your own package manager, then register it again. MoltNet never installs packages for you.',
  },
};

/** In-memory `RunCenterActions` for the prototype harness. */
export function createFixtureActions(
  getData: () => RunCenterData,
  setData: (next: RunCenterData) => void,
  options: { packageCandidate?: RuntimeCandidate } = {},
): RunCenterActions {
  const settle = <T,>(value: T, ms = 320) =>
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(value), ms);
    });

  return {
    async startRun(input) {
      await settle(null);
      const data = getData();
      const names = input.profileIds.map(
        (id) => data.profiles.find((p) => p.id === id)?.name ?? id,
      );
      const run: DesktopRun = {
        id: `run_${Math.random().toString(36).slice(2, 18)}`,
        presetName: input.presetName,
        agent: input.agent,
        teamId: input.teamId,
        teamName:
          data.teams.find((t) => t.id === input.teamId)?.name ?? 'Unknown team',
        profiles: names,
        taskTypes: input.taskTypes,
        mode: input.mode,
        status: 'running',
        pid: 40000 + Math.floor(Math.random() * 9999),
        exitCode: null,
        startedAt: new Date().toISOString(),
        endedAt: null,
        tasksClaimed: 0,
        lastActivityAt: null,
        lastError: null,
      };
      setData({ ...data, runs: [run, ...data.runs] });
    },
    async stopRun(runId) {
      await settle(null);
      const data = getData();
      setData({
        ...data,
        runs: data.runs.map((run) =>
          run.id === runId
            ? {
                ...run,
                status: 'stopped',
                pid: null,
                exitCode: 0,
                endedAt: new Date().toISOString(),
              }
            : run,
        ),
      });
    },
    async savePreset(input) {
      await settle(null);
      const data = getData();
      const existing = input.id
        ? data.presets.find((preset) => preset.id === input.id)
        : undefined;
      const preset: RunPreset = {
        id: existing?.id ?? `preset-${Date.now()}`,
        name: input.name,
        agent: input.agent,
        teamId: input.teamId,
        profileIds: input.profileIds,
        taskTypes: input.taskTypes,
        mode: input.mode,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        lastUsedAt: existing?.lastUsedAt ?? null,
      };
      setData({
        ...data,
        presets: existing
          ? data.presets.map((p) => (p.id === preset.id ? preset : p))
          : [...data.presets, preset],
      });
    },
    async deletePreset(presetId) {
      await settle(null);
      const data = getData();
      setData({
        ...data,
        presets: data.presets.filter((preset) => preset.id !== presetId),
      });
    },
    async pickRuntimeFile() {
      return settle(FIXTURE_FILE_CANDIDATE, 400);
    },
    async pickRuntimePackage() {
      return settle(options.packageCandidate ?? FIXTURE_PACKAGE_CANDIDATE, 400);
    },
    async pickDirectory() {
      return settle('/Users/you/dev/acme-adapter', 300);
    },
    async registerRuntime(candidate) {
      await settle(null);
      const data = getData();
      const entry: RuntimeEntry = {
        kind: candidate.kind,
        source: candidate.source,
        label: candidate.label,
        projectDir: candidate.projectDir,
        entryHash: candidate.entryHash,
        lockfilePath: candidate.lockfilePath,
        registeredAt: new Date().toISOString(),
        drift: 'none',
        usedByProfiles: data.profiles
          .filter((p) => p.runtimeKind === candidate.kind)
          .map((p) => p.name),
      };
      setData({
        ...data,
        runtimes: [
          ...data.runtimes.filter((r) => r.kind !== entry.kind),
          entry,
        ].sort((a, b) =>
          a.source === 'builtin' ? -1 : a.kind.localeCompare(b.kind),
        ),
      });
    },
    async unregisterRuntime(kind) {
      await settle(null);
      const data = getData();
      setData({
        ...data,
        runtimes: data.runtimes.filter((runtime) => runtime.kind !== kind),
      });
    },
    async openLogs() {
      await settle(null);
    },
    subscribeRunLogs(runId, onLine) {
      const lines = FIXTURE_RUN_LOGS[runId] ?? [];
      for (const line of lines) onLine(line);
      return () => undefined;
    },
  };
}
