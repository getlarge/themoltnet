import type { DesktopStatus } from '@moltnet/agent-desktop/bridge';
import type {
  AgentServerCatalogue,
  AgentServerStatus,
  RunPreset,
} from '@moltnet/agent-desktop/run-types';

export const running: DesktopStatus = {
  state: 'running',
  installedVersion: '1.0.0',
  availableVersion: null,
  message: 'Fixture server running.',
  logs: [],
};
export const catalogue: AgentServerCatalogue = {
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
