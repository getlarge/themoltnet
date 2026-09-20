import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

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
    options: {
      root,
      cwd,
      apiUrl: binding.apiUrl,
      client: { projects: { get: project }, diaries: { get: diary } },
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
    expect(result.workspace.configPath).toBe(join(f.root, 'projects.json'));
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

  it('rejects inaccessible, archived, or wrong-team projects before launching', async () => {
    const f = await setup();
    f.project.mockRejectedValueOnce(new Error('offline'));
    await expect(
      resolveManagedProjectSelection({
        ...f.options,
        spec: { ...spec, projectId: 'project' },
      }),
    ).rejects.toThrow(/project/i);
    f.project.mockResolvedValue({
      id: 'project',
      teamId: 'foreign',
      archived: false,
      defaultDiaryId: 'project-diary',
    });
    await expect(
      resolveManagedProjectSelection({
        ...f.options,
        spec: { ...spec, projectId: 'project' },
      }),
    ).rejects.toThrow(/project/i);
    f.project.mockResolvedValue({
      id: 'project',
      teamId: 'team',
      archived: true,
      defaultDiaryId: 'project-diary',
    });
    await expect(
      resolveManagedProjectSelection({
        ...f.options,
        spec: { ...spec, projectId: 'project' },
      }),
    ).rejects.toThrow(/project/i);
  });

  it('rejects a diary belonging to another team and relative run-only folders', async () => {
    const f = await setup();
    f.diary.mockResolvedValue({ id: 'location-diary', teamId: 'foreign' });
    await expect(
      resolveManagedProjectSelection({
        ...f.options,
        spec: { ...spec, projectId: 'project' },
      }),
    ).rejects.toThrow(/diary/i);
    await expect(
      resolveManagedProjectSelection({
        ...f.options,
        spec: { ...spec, projectId: 'project', source: '../other' },
      }),
    ).rejects.toThrow(/absolute/i);
  });
});
