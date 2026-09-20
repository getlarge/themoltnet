import AxeBuilder from '@axe-core/webdriverio';
import type { DesktopStatus } from '@moltnet/agent-desktop/bridge';
import type {
  AgentServerCatalogue,
  AgentServerStatus,
  RunPreset,
} from '@moltnet/agent-desktop/run-types';
import { browser, expect } from '@wdio/globals';

export const running: DesktopStatus = {
  state: 'running',
  installedVersion: '1.0.0',
  availableVersion: null,
  message: 'Fixture server running.',
  logs: [],
};
export const catalogue: AgentServerCatalogue = {
  projects: [],
  projectErrors: [],
  defaultTeamId: 'team',
  teams: [
    {
      teamId: 'team',
      teamName: 'Research',
      available: true,
      blockers: [],
      defaultDiaryId: 'diary',
      diaries: [{ id: 'diary', name: 'Research diary' }],
    },
  ],
  profiles: ['careful', 'quick'].map((id) => ({
    id,
    name: id === 'careful' ? 'Careful review' : 'Quick review',
    teamId: 'team',
    defaultWorkspaceMode: 'none',
    definitionCid: 'fixture-cid',
    description: null,
    maxTurns: 10,
    model: 'fixture-model',
    provider: 'fixture',
    requiredEnv: [],
    requiredExecutables: [],
    requiredTools: [],
    revision: 1,
    runtimeKind: 'fixture',
    toolEnforcement: 'enforce',
    blockers: [],
    ready: true,
  })),
};
export const status: AgentServerStatus = {
  agents: ['first-agent', 'previous-agent'].map((agentName) => ({
    agentName,
    subjectId: agentName,
    kind: 'managed',
    createdAt: '2026-09-01T00:00:00Z',
    hasAgentKey: true,
    hasPrivateKey: true,
  })),
  selectedIdentity: 'first-agent',
  identities: [],
  platform: 'darwin',
  providers: {},
  subscriptions: [],
  version: 'fixture',
  runtimeSettings: { heartbeatIntervalMs: 1000, warmRetentionSec: 10 },
  runs: [
    {
      id: 'previous-run',
      agent: 'previous-agent',
      teamId: 'team',
      diaryId: 'diary',
      profiles: ['quick', 'careful'],
      taskTypes: ['pr_review'],
      mode: 'poll',
      active: false,
      status: 'stopped',
      startedAt: '2026-09-01T00:00:00Z',
      endedAt: '2026-09-01T01:00:00Z',
    },
  ],
};
export const preset: RunPreset = {
  id: 'saved-worker',
  name: 'Saved worker',
  agent: 'first-agent',
  teamId: 'team',
  diaryId: 'diary',
  profileIds: ['careful'],
  taskTypes: ['freeform'],
  createdAt: '2026-09-01T00:00:00Z',
  lastUsedAt: null,
};

export const WINDOW_SIZES = [
  [820, 720],
  [640, 560],
] as const;
export const PRESETS_KEY = 'moltnet.run-presets.v1';
export function readSavedPresets(): Promise<RunPreset[]> {
  return browser.execute(
    (key) => JSON.parse(localStorage.getItem(key) ?? '[]') as RunPreset[],
    PRESETS_KEY,
  );
}
export async function expectNoAxeViolations(native = false): Promise<void> {
  const builder = new AxeBuilder({ client: browser });
  if (native) builder.setLegacyMode();
  const audit = await builder
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    audit.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}
