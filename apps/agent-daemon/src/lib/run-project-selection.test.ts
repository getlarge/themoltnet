import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createProjectOnceSource,
  createProjectPollingSource,
} from './project-task-source.js';
import {
  applyProjectWorkspacePolicy,
  resolveRunProjectSelection,
} from './run-project-selection.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'run-project-')));
  roots.push(root);
  await mkdir(join(root, 'source'));
  const configPath = join(root, 'projects.json');
  await writeFile(
    configPath,
    JSON.stringify({
      version: 1,
      bindings: [
        {
          name: 'local',
          apiUrl: 'https://api.example',
          teamId: 'team',
          projectId: 'project',
          source: './source',
          strategy: 'existing',
        },
      ],
    }),
  );
  return { root, configPath };
}
describe('run project selection', () => {
  it('resolves one pinned selection with source separate from run state', async () => {
    const { root, configPath } = await fixture();
    const selected = await resolveRunProjectSelection({
      agent: 'worker',
      cwd: root,
      'config-file': configPath,
      binding: 'local',
      'state-dir': './state',
    });
    expect(selected).toMatchObject({
      projectId: 'project',
      teamId: 'team',
      apiUrl: 'https://api.example',
      source: join(root, 'source'),
      stateRootDir: join(root, 'state'),
      strategy: 'existing',
    });
    await writeFile(configPath, JSON.stringify({ version: 1, bindings: [] }));
    expect(selected.projectId).toBe('project');
  });
  it('rejects a team override that conflicts with the binding before credentials or claims', async () => {
    const { root, configPath } = await fixture();
    await expect(
      resolveRunProjectSelection({
        agent: 'worker',
        cwd: root,
        'config-file': configPath,
        binding: 'local',
        team: 'other',
      }),
    ).rejects.toThrow(/match/);
  });
  it('applies source overrides relative to the caller without changing the file', async () => {
    const { root, configPath } = await fixture();
    await mkdir(join(root, 'override'));
    const selected = await resolveRunProjectSelection({
      agent: 'worker',
      cwd: root,
      'config-file': configPath,
      binding: 'local',
      source: './override',
    });
    expect(selected.source).toBe(join(root, 'override'));
    const saved = await resolveRunProjectSelection({
      agent: 'worker',
      cwd: root,
      'config-file': configPath,
      binding: 'local',
    });
    expect(saved.source).toBe(join(root, 'source'));
  });
  it('declares General work without reading project defaults', async () => {
    const { root } = await fixture();
    const selected = await resolveRunProjectSelection({
      agent: 'worker',
      cwd: root,
      team: 'team',
      general: true,
    });
    expect(selected.projectId).toBeNull();
    expect(selected.source).toBe(root);
    expect(selected.stateRootDir).toBeUndefined();
  });
  it('rejects conflicting General and project declarations', async () => {
    const { root } = await fixture();
    await expect(
      resolveRunProjectSelection({
        agent: 'worker',
        cwd: root,
        general: true,
        project: 'project',
      }),
    ).rejects.toThrow(/General/);
  });
  it('rejects a non-Git source before a git-worktree worker can claim tasks', async () => {
    const { root, configPath } = await fixture();
    await expect(
      resolveRunProjectSelection({
        agent: 'worker',
        cwd: root,
        'config-file': configPath,
        binding: 'local',
        'workspace-strategy': 'git-worktree',
      }),
    ).rejects.toThrow(/Git repository/);
  });
  it('requires a committed source and accepts it after the first commit', async () => {
    const { root, configPath } = await fixture();
    const source = join(root, 'source');
    execFileSync('git', ['init', '--quiet', source]);
    const options = {
      agent: 'worker',
      cwd: root,
      'config-file': configPath,
      binding: 'local',
      'workspace-strategy': 'git-worktree',
    };
    await expect(resolveRunProjectSelection(options)).rejects.toThrow(
      /committed revision/,
    );
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'core.hooksPath=/dev/null',
        'commit',
        '--allow-empty',
        '--quiet',
        '-m',
        'fixture',
      ],
      { cwd: source },
    );
    vi.stubEnv('GIT_CONFIG_COUNT', '1');
    vi.stubEnv('GIT_CONFIG_KEY_0', 'core.bare');
    vi.stubEnv('GIT_CONFIG_VALUE_0', 'true');
    await expect(resolveRunProjectSelection(options)).resolves.toMatchObject({
      source,
      strategy: 'git-worktree',
      projectId: 'project',
    });
    await mkdir(join(source, 'nested'));
    await expect(
      resolveRunProjectSelection({
        ...options,
        source: join(source, 'nested'),
      }),
    ).rejects.toThrow(/repository root/);
  });
});

it('rejects a binding strategy excluded by the profile instead of downgrading it', async () => {
  const { root, configPath } = await fixture();
  const selected = await resolveRunProjectSelection({
    agent: 'worker',
    cwd: root,
    'config-file': configPath,
    binding: 'local',
  });
  expect(() =>
    applyProjectWorkspacePolicy(
      { name: 'restricted', allowedWorkspaceModes: ['shared_mount'] } as never,
      { ...selected, strategy: 'git-worktree' },
    ),
  ).toThrow(/not allowed/);
});
it('fixes the selected strategy for the run while preserving the saved profile', async () => {
  const { root, configPath } = await fixture();
  const selected = await resolveRunProjectSelection({
    agent: 'worker',
    cwd: root,
    'config-file': configPath,
    binding: 'local',
  });
  const profile = {
    name: 'worker',
    allowedWorkspaceModes: ['shared_mount', 'dedicated_worktree'],
    mountPath: '/old',
  };
  const effective = applyProjectWorkspacePolicy(profile as never, selected);
  expect(effective).toMatchObject({
    mountPath: join(root, 'source'),
    defaultWorkspaceMode: 'shared_mount',
    allowedWorkspaceModes: ['shared_mount'],
  });
  expect(profile.allowedWorkspaceModes).toHaveLength(2);
});

it('selects the most specific registered ancestor without a binding flag', async () => {
  const { root, configPath } = await fixture();
  await mkdir(join(root, 'source', 'child'));
  const selection = await resolveRunProjectSelection({
    agent: 'worker',
    cwd: join(root, 'source', 'child'),
    'config-file': configPath,
    apiUrl: 'https://api.example',
  });
  expect(selection.projectId).toBe('project');
});
it.each(['isolated-directory', 'hooks'])(
  'rejects unsupported %s during selection',
  async (kind) => {
    const { root, configPath } = await fixture();
    await writeFile(
      configPath,
      JSON.stringify({
        version: 1,
        bindings: [
          {
            name: 'local',
            apiUrl: 'https://api.example',
            teamId: 'team',
            projectId: 'project',
            source: './source',
            strategy: kind === 'hooks' ? 'existing' : kind,
            ...(kind === 'hooks'
              ? {
                  hooks: {
                    beforeRun: { command: 'echo', args: [], timeoutMs: 1000 },
                  },
                }
              : {}),
          },
        ],
      }),
    );
    await expect(
      resolveRunProjectSelection({
        agent: 'worker',
        cwd: root,
        binding: 'local',
        'config-file': configPath,
      }),
    ).rejects.toThrow(/support/);
  },
);

it('inherits activated selection only for the matching identity and resets it for explicit configuration', async () => {
  const { root, configPath } = await fixture();
  vi.stubEnv('MOLTNET_ACTIVE_IDENTITY', 'worker');
  vi.stubEnv('MOLTNET_PROJECT_CONFIG', configPath);
  vi.stubEnv('MOLTNET_PROJECT_BINDING', 'local');
  vi.stubEnv('MOLTNET_PROJECT_ID', 'project');
  expect(
    await resolveRunProjectSelection({ agent: 'worker', cwd: root }),
  ).toMatchObject({ projectId: 'project', selectedBy: 'activation' });
  expect(
    await resolveRunProjectSelection({
      agent: 'worker',
      cwd: root,
      'config-file': configPath,
    }),
  ).toMatchObject({ projectId: null, selectedBy: 'general' });
  expect(
    await resolveRunProjectSelection({
      agent: 'other',
      cwd: root,
      'config-file': configPath,
    }),
  ).toMatchObject({ projectId: null });
  expect(
    await resolveRunProjectSelection({
      agent: 'worker',
      cwd: root,
      general: true,
    }),
  ).toMatchObject({ projectId: null });
});
it('rejects no-workspace source overrides before a worker starts', async () => {
  const { root } = await fixture();
  await expect(
    resolveRunProjectSelection({
      agent: 'worker',
      cwd: root,
      general: true,
      source: root,
      'workspace-strategy': 'none',
    }),
  ).rejects.toThrow(/cannot specify a source/);
});
it('filters a named binding against the effective endpoint', async () => {
  const { root, configPath } = await fixture();
  await expect(
    resolveRunProjectSelection({
      agent: 'worker',
      cwd: root,
      'config-file': configPath,
      binding: 'local',
      apiUrl: 'https://other.example',
    }),
  ).rejects.toThrow(/match/);
});

it.each([false, true])(
  'passes the resolved project through discovery and claims (General=%s)',
  async (general) => {
    const { root, configPath } = await fixture();
    const selection = await resolveRunProjectSelection({
      agent: 'worker',
      cwd: root,
      'config-file': configPath,
      ...(general ? { general: true, team: 'team' } : { binding: 'local' }),
    });
    const task = {
      id: 'task',
      teamId: 'team',
      projectId: selection.projectId,
      taskType: 'freeform',
      status: 'queued',
      input: {},
    };
    const claim = vi.fn().mockResolvedValue({ task, attempt: { attemptN: 1 } });
    const list = vi.fn().mockResolvedValue({ items: [task], total: 1 });
    const agent = { tasks: { claim, list } } as never;
    const once = createProjectOnceSource(selection, { agent, taskId: task.id });
    await once.claim();
    expect(claim).toHaveBeenCalledWith(task.id, {
      projectId: selection.projectId,
    });
    claim.mockClear();
    const poll = createProjectPollingSource(selection, {
      agent,
      teamId: 'team',
      stopWhenEmpty: true,
    });
    try {
      await poll.claim();
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: selection.projectId ?? 'none' }),
        expect.anything(),
      );
      expect(claim).toHaveBeenCalledWith(
        task.id,
        expect.objectContaining({ projectId: selection.projectId }),
        expect.anything(),
      );
    } finally {
      await poll.close();
    }
  },
);
