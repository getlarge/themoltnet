import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { MoltNetError } from '@themoltnet/sdk';
import { readProjectConfig, updateProjectConfig } from '@themoltnet/sdk/node';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveManagedProjectSelection } from './managed-project-selection.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'managed-project-')),
  );
  roots.push(root);
  const source = join(root, 'checkout');
  const cwd = join(root, 'run');
  await mkdir(source);
  await mkdir(cwd);
  const binding = {
    name: 'Laptop',
    apiUrl: 'https://api.example',
    teamId: 'team',
    projectId: 'project',
    diaryId: 'location-diary',
    source,
    strategy: 'existing' as const,
    default: true,
  };
  await updateProjectConfig(join(root, 'projects.json'), (config) => {
    config.bindings.push(binding);
  });
  const project = vi.fn(async () => ({
    id: 'project',
    teamId: 'team',
    name: 'Project',
    description: null,
    archived: false,
    defaultDiaryId: 'project-diary',
  }));
  const diary = vi.fn(async (id: string) => ({ id, teamId: 'team' }));
  return {
    root,
    source,
    cwd,
    binding,
    project,
    diary,
    store: join(root, 'store'),
    options: {
      root,
      cwd,
      apiUrl: binding.apiUrl,
      client: { projects: { get: project }, diaries: { get: diary } },
      protectedRoots: [join(root, 'store')],
      signal: new AbortController().signal,
    },
  };
}
const spec = {
  agent: 'worker',
  teamId: 'team',
  profiles: ['profile'],
  taskTypes: ['freeform'],
  mode: 'poll' as const,
};

describe('managed run project selection', () => {
  it('captures an absolute binding and run-only overrides without changing defaults', async () => {
    const f = await setup();
    const override = join(f.root, 'other');
    await mkdir(override);
    const result = await resolveManagedProjectSelection({
      ...f.options,
      spec: {
        ...spec,
        projectId: 'project',
        binding: 'Laptop',
        source: override,
        diaryId: 'run-diary',
      },
    });
    expect(result.workspace).toMatchObject({
      projectId: 'project',
      binding: 'Laptop',
      source: override,
      strategy: 'existing',
      diaryId: 'run-diary',
    });
    expect(result.config.bindings[0]).toMatchObject({
      source: override,
      diaryId: 'run-diary',
    });
    expect(
      (await readProjectConfig(join(f.root, 'projects.json'))).bindings,
    ).toEqual([f.binding]);
    expect(f.project).toHaveBeenCalledWith('project', { teamId: 'team' });
    expect(f.diary).toHaveBeenCalledWith('run-diary', { teamId: 'team' });
  });

  it('resolves an explicit relative store against the caller directory', async () => {
    const f = await setup();
    const result = await resolveManagedProjectSelection({
      ...f.options,
      root: relative(process.cwd(), f.root),
      spec: { ...spec, projectId: 'project' },
    });
    expect(result.selection.configPath).toBe(join(f.root, 'projects.json'));
    expect(result.workspace.source).toBe(f.source);
  });

  it('reads new defaults only for subsequent selections', async () => {
    const f = await setup();
    const input = { ...f.options, spec: { ...spec, projectId: 'project' } };
    const first = await resolveManagedProjectSelection(input);
    await updateProjectConfig(join(f.root, 'projects.json'), (config) => {
      config.bindings[0].diaryId = 'next-diary';
    });
    const next = await resolveManagedProjectSelection(input);
    expect(first.workspace.diaryId).toBe('location-diary');
    expect(first.config.bindings[0].diaryId).toBe('location-diary');
    expect(next.workspace.diaryId).toBe('next-diary');
  });

  it('keeps General work independent of an ancestor project and malformed bindings', async () => {
    const f = await setup();
    await writeFile(join(f.root, 'projects.json'), 'invalid JSON');
    const result = await resolveManagedProjectSelection({
      ...f.options,
      cwd: f.source,
      spec: { ...spec, projectId: null },
    });
    expect(result.workspace.projectId).toBeNull();
    // The profile's own workspace; no folder was chosen, so none is recorded.
    expect(result.workspace).not.toHaveProperty('source');
    expect(result.config.bindings).toEqual([]);
    expect(f.project).not.toHaveBeenCalled();
  });

  it('rejects a General run that also names a binding', async () => {
    const f = await setup();
    await expect(
      resolveManagedProjectSelection({
        ...f.options,
        spec: { ...spec, projectId: null, binding: 'Laptop' },
      }),
    ).rejects.toThrow(/General/);
  });

  it('separates an unreachable server from a project this team cannot use', async () => {
    const f = await setup();
    const input = { ...f.options, spec: { ...spec, projectId: 'project' } };
    f.project.mockRejectedValueOnce(new Error('offline'));
    await expect(resolveManagedProjectSelection(input)).rejects.toMatchObject({
      statusCode: 503,
      code: 'project_check_unavailable',
    });
    f.project.mockRejectedValueOnce(
      new MoltNetError('Forbidden', { code: 'FORBIDDEN', statusCode: 403 }),
    );
    await expect(resolveManagedProjectSelection(input)).rejects.toMatchObject({
      statusCode: 400,
      code: 'project_unavailable',
    });
    for (const change of [{ teamId: 'foreign' }, { archived: true }]) {
      f.project.mockResolvedValueOnce({
        id: 'project',
        teamId: 'team',
        name: 'Project',
        description: null,
        archived: false,
        defaultDiaryId: 'project-diary',
        ...change,
      });
      await expect(resolveManagedProjectSelection(input)).rejects.toMatchObject(
        { code: 'project_unavailable' },
      );
    }
  });

  it('stops a slow check at its deadline instead of outliving the request', async () => {
    const f = await setup();
    f.project.mockImplementationOnce(
      () =>
        new Promise<never>(() => {
          // Never settles: only the deadline ends this check.
        }),
    );
    await expect(
      resolveManagedProjectSelection({
        ...f.options,
        signal: AbortSignal.timeout(20),
        spec: { ...spec, projectId: 'project' },
      }),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'project_check_unavailable',
    });
  });

  it('rejects a location diary belonging to another team', async () => {
    const f = await setup();
    f.diary.mockResolvedValue({ id: 'location-diary', teamId: 'foreign' });
    await expect(
      resolveManagedProjectSelection({
        ...f.options,
        spec: { ...spec, projectId: 'project' },
      }),
    ).rejects.toMatchObject({ code: 'diary_unavailable' });
  });

  it('checks an explicit diary on General work, which browsers may send', async () => {
    const f = await setup();
    f.diary.mockResolvedValueOnce({ id: 'foreign-diary', teamId: 'foreign' });
    await expect(
      resolveManagedProjectSelection({
        ...f.options,
        spec: { ...spec, projectId: null, diaryId: 'foreign-diary' },
      }),
    ).rejects.toMatchObject({ code: 'diary_unavailable' });

    const accepted = await resolveManagedProjectSelection({
      ...f.options,
      spec: { ...spec, projectId: null, diaryId: 'team-diary' },
    });
    expect(accepted.workspace).toMatchObject({
      projectId: null,
      diaryId: 'team-diary',
    });
    expect(f.project).not.toHaveBeenCalled();
  });

  it('rejects relative run-only folders', async () => {
    const f = await setup();
    await expect(
      resolveManagedProjectSelection({
        ...f.options,
        spec: { ...spec, projectId: 'project', source: '../other' },
      }),
    ).rejects.toThrow(/absolute/i);
  });

  it('explains a missing run-only folder instead of failing on realpath', async () => {
    const f = await setup();
    await expect(
      resolveManagedProjectSelection({
        ...f.options,
        spec: { ...spec, projectId: null, source: join(f.root, 'gone') },
      }),
    ).rejects.toThrow(/unavailable/i);
  });

  it('refuses folders inside or containing the configuration store', async () => {
    const f = await setup();
    const inside = join(f.store, 'identities');
    await mkdir(inside, { recursive: true });
    for (const source of [inside, f.root]) {
      await expect(
        resolveManagedProjectSelection({
          ...f.options,
          spec: {
            ...spec,
            projectId: null,
            source,
            workspaceStrategy: 'existing',
          },
        }),
      ).rejects.toThrow(/outside the MoltNet configuration store/);
    }
  });

  it('refuses a protected folder before running git in it', async () => {
    const f = await setup();
    await mkdir(f.store, { recursive: true });
    await expect(
      resolveManagedProjectSelection({
        ...f.options,
        spec: {
          ...spec,
          projectId: null,
          source: f.store,
          workspaceStrategy: 'git-worktree',
        },
      }),
    ).rejects.toThrow(/outside the MoltNet configuration store/);
  });

  it('leaves the request untouched and returns resolved ids separately', async () => {
    const f = await setup();
    const request = { ...spec, binding: 'Laptop' };
    const result = await resolveManagedProjectSelection({
      ...f.options,
      spec: request,
    });
    expect(request).toEqual({ ...spec, binding: 'Laptop' });
    expect(result.effective).toMatchObject({
      projectId: 'project',
      diaryId: 'location-diary',
      binding: 'Laptop',
    });
  });
});
