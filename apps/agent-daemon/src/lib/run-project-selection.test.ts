import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyProjectWorkspacePolicy,
  resolveRunProjectSelection,
} from './run-project-selection.js';

const roots: string[] = [];
afterEach(async () => {
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
    expect(selected.stateRootDir).not.toBe(root);
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
    await expect(resolveRunProjectSelection(options)).resolves.toMatchObject({
      source,
      strategy: 'git-worktree',
      projectId: 'project',
    });
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
