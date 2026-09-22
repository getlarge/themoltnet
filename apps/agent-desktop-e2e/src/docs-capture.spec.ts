import type { DesktopStatus } from '@moltnet/agent-desktop/bridge';
import type {
  AgentServerCatalogue,
  AgentServerStatus,
} from '@moltnet/agent-desktop/run-types';
import { $, browser, expect } from '@wdio/globals';

import { field } from './journey-helpers.js';

/**
 * Screenshots for docs/use/projects-and-workspaces.md, taken from the real
 * renderer with mocked native commands. The data is chosen to read well in the
 * guide, not to exercise edge cases.
 */
const SHOTS = '../../docs/public/screenshots';

const server: DesktopStatus = {
  state: 'running',
  installedVersion: '1.0.0',
  availableVersion: null,
  message: 'Agent Server running.',
  logs: [],
};
const project = {
  id: 'project',
  teamId: 'team',
  name: 'Research workspace',
  description: 'Shared research project',
  defaultDiaryId: 'diary',
  archived: false,
};
const catalogue: AgentServerCatalogue = {
  projects: [project],
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
  profiles: [
    {
      id: 'careful',
      name: 'Careful review',
      teamId: 'team',
      defaultWorkspaceMode: 'none',
      definitionCid: 'docs-cid',
      description: null,
      maxTurns: 10,
      model: 'claude-sonnet-4-5',
      provider: 'anthropic',
      requiredEnv: [],
      requiredExecutables: [],
      requiredTools: [],
      revision: 1,
      runtimeKind: 'pi',
      toolEnforcement: 'enforce',
      blockers: [],
      ready: true,
    },
  ],
};
const workspace = {
  projectId: 'project',
  location: 'Laptop',
  diaryId: 'diary',
  source: '/Users/you/research',
  strategy: 'existing' as const,
};
const status: AgentServerStatus = {
  agents: [
    {
      agentName: 'research-bot',
      subjectId: 'research-bot',
      kind: 'managed',
      createdAt: '2026-09-01T00:00:00Z',
      hasAgentKey: true,
      hasPrivateKey: true,
    },
  ],
  selectedIdentity: 'research-bot',
  identities: [],
  platform: 'darwin',
  providers: {},
  subscriptions: [],
  version: '1.0.0',
  runtimeSettings: { heartbeatIntervalMs: 1000, warmRetentionSec: 10 },
  runs: [
    {
      id: 'previous-run',
      agent: 'research-bot',
      teamId: 'team',
      projectId: 'project',
      location: 'Laptop',
      profiles: ['careful'],
      taskTypes: ['pr_review'],
      mode: 'poll',
      active: false,
      status: 'stopped',
      startedAt: new Date(Date.now() - 95 * 60_000).toISOString(),
      endedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      exitCode: 0,
      credential: {
        keyId: 'research-key',
        expiresAt: new Date(Date.now() + 20 * 86_400_000).toISOString(),
        verifiedAt: new Date(Date.now() - 95 * 60_000).toISOString(),
        scopes: ['team:read', 'tasks:claim'],
      },
      workspace,
    },
  ],
};
const location = {
  name: 'Laptop',
  teamId: 'team',
  projectId: 'project',
  apiUrl: 'https://api.themolt.net',
  source: '/Users/you/research',
  effectiveSource: '/Users/you/research',
  strategy: 'existing',
  default: true,
  readiness: { ready: true },
};

describe('Documentation screenshots', () => {
  before(async () => {
    await browser.tauri.restoreAllMocks();
    for (const [command, value] of Object.entries({
      desktop_status: server,
      desktop_control_status: status,
      desktop_operator_configured: true,
      desktop_catalogue: catalogue,
      desktop_preset_storage_scope: { storageScope: '' },
      desktop_providers: {},
      desktop_subscriptions: [],
      desktop_project_locations: { locations: [location] },
      desktop_console_available: true,
      desktop_run_logs: { lines: [] },
    }))
      await (await browser.tauri.mock(command)).mockResolvedValue(value);
    await browser.execute(() => {
      localStorage.clear();
      window.dispatchEvent(new Event('desktop-e2e:mount'));
    });
    await expect($('button=New run')).toBeEnabled();
  });

  it('captures the Projects screen', async () => {
    await $('a=Projects').click();
    await expect($('h3=Laptop')).toBeDisplayed();
    // The saved location sits below the shared project.
    await $('h2=On this computer').scrollIntoView();
    await browser.saveScreenshot(`${SHOTS}/desktop-projects.png`);
  });

  it('captures the effective run settings', async () => {
    await $('a=Runs').click();
    await $('button=New run').click();
    await field('Runtime profile').selectByAttribute('value', 'careful');
    await field('Project').selectByAttribute('value', 'project');
    await expect(field('Local location')).toHaveValue('Laptop');
    await $('h2=Effective run settings').scrollIntoView();
    await browser.saveScreenshot(`${SHOTS}/desktop-run-composer.png`);
    await $('button=Cancel').click();
  });

  it('captures the captured workspace of a finished run', async () => {
    await $('a=Runs').click();
    await $('button=Logs').click();
    await expect($('h2=Captured workspace')).toBeDisplayed();
    await browser.saveScreenshot(`${SHOTS}/desktop-run-workspace.png`);
  });
});
