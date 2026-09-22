import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readProjectConfig, updateProjectConfig } from '@themoltnet/sdk/node';
import { afterEach, describe, expect, it } from 'vitest';

import { LocalProjectBindings } from './project-bindings.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'desktop-bindings-'));
  roots.push(root);
  const source = join(root, 'checkout');
  await mkdir(source);
  return {
    root,
    source,
    bindings: new LocalProjectBindings(root, 'https://api.themolt.net/'),
  };
}
const binding = (source: string, name = 'Laptop') => ({
  name,
  source,
  apiUrl: 'https://api.themolt.net',
  teamId: 'team',
  projectId: 'project',
  strategy: 'existing' as const,
});

describe('native local project locations', () => {
  it('filters by endpoint and refuses to overwrite a foreign registration', async () => {
    const { root, source, bindings } = await fixture();
    const foreign = { ...binding(source), apiUrl: 'http://127.0.0.1:8080' };
    await updateProjectConfig(join(root, 'projects.json'), (config) => {
      config.bindings.push(foreign);
    });

    expect(await bindings.list()).toEqual([]);
    await expect(bindings.save(binding(source))).rejects.toThrow(
      'another endpoint',
    );
    await expect(bindings.remove('Laptop')).rejects.toThrow('not found');
    expect(
      (await readProjectConfig(join(root, 'projects.json'))).bindings,
    ).toEqual([foreign]);
  });

  it('serializes concurrent saves and selects one explicit project default', async () => {
    const { root, source, bindings } = await fixture();
    await Promise.all([
      bindings.save({ ...binding(source, 'One'), default: true }),
      bindings.save({ ...binding(source, 'Two'), default: true }),
    ]);

    const stored = await readProjectConfig(join(root, 'projects.json'));
    expect(stored.bindings).toHaveLength(2);
    expect(stored.bindings.filter((entry) => entry.default)).toHaveLength(1);
  });

  it('removes only the registration and leaves source files intact', async () => {
    const { source, bindings } = await fixture();
    await writeFile(join(source, 'keep.txt'), 'keep');
    await bindings.save(binding(source));

    await bindings.remove('Laptop');

    expect(await bindings.list()).toEqual([]);
    expect(await readFile(join(source, 'keep.txt'), 'utf8')).toBe('keep');
    expect((await stat(source)).isDirectory()).toBe(true);
  });

  it('reports a disappeared folder without losing its registration', async () => {
    const { source, bindings } = await fixture();
    await bindings.save(binding(source));
    await rm(source, { recursive: true });

    const [location] = await bindings.list();

    expect(location?.name).toBe('Laptop');
    expect(location?.readiness).toMatchObject({
      ready: false,
      code: 'folder_missing',
    });
  });

  it('keeps unsupported saved strategies visible with an actionable reason', async () => {
    const { root, source, bindings } = await fixture();
    await updateProjectConfig(join(root, 'projects.json'), (config) => {
      config.bindings.push({
        ...binding(source),
        strategy: 'isolated-directory',
      });
    });

    const readiness = (await bindings.list())[0]?.readiness;
    expect(readiness).toMatchObject({
      ready: false,
      code: 'unsupported_strategy',
    });
    expect(readiness?.message).toContain('Work here');
  });

  it('does not silently discard existing preparation hooks when editing a location', async () => {
    const { root, source, bindings } = await fixture();
    const original = {
      ...binding(source),
      hooks: {
        beforeRun: { command: 'echo', args: ['prepare'], timeoutMs: 1000 },
      },
    };
    await updateProjectConfig(join(root, 'projects.json'), (config) => {
      config.bindings.push(original);
    });

    await expect(bindings.save(binding(source))).rejects.toThrow('hooks');
    expect(
      (await readProjectConfig(join(root, 'projects.json'))).bindings,
    ).toEqual([original]);
  });

  it('reports stored command hooks as unavailable', async () => {
    const { root, source, bindings } = await fixture();
    await updateProjectConfig(join(root, 'projects.json'), (config) => {
      config.bindings.push({
        ...binding(source),
        hooks: {
          afterCreate: { command: 'echo', args: [], timeoutMs: 1000 },
        },
      });
    });

    expect((await bindings.list())[0]?.readiness).toMatchObject({
      ready: false,
      code: 'hooks_unavailable',
    });
  });

  it('treats an empty hooks object as ready, as worker startup does', async () => {
    const { root, source, bindings } = await fixture();
    await updateProjectConfig(join(root, 'projects.json'), (config) => {
      config.bindings.push({ ...binding(source), hooks: {} });
    });

    expect((await bindings.list())[0]?.readiness).toEqual({ ready: true });
    await expect(bindings.save(binding(source))).resolves.toMatchObject({
      readiness: { ready: true },
    });
  });

  it('refuses a Git worktree location over a plain folder', async () => {
    const { root, source, bindings } = await fixture();
    const worktree = { ...binding(source), strategy: 'git-worktree' as const };

    await expect(bindings.save(worktree)).rejects.toMatchObject({
      statusCode: 400,
      code: 'git_unavailable',
    });
    await updateProjectConfig(join(root, 'projects.json'), (config) => {
      config.bindings.push(worktree);
    });
    expect((await bindings.list())[0]?.readiness).toMatchObject({
      ready: false,
      code: 'git_unavailable',
    });
  });

  it("keeps another project's default when setting this project's default", async () => {
    const { root, source, bindings } = await fixture();
    await bindings.save({
      ...binding(source, 'Other'),
      projectId: 'other-project',
      default: true,
    });
    await bindings.save({ ...binding(source, 'Mine'), default: true });

    const stored = await readProjectConfig(join(root, 'projects.json'));
    expect(
      stored.bindings.map(({ name, default: isDefault }) => [name, isDefault]),
    ).toEqual([
      ['Other', true],
      ['Mine', true],
    ]);
  });

  it('reports an unknown name as not found', async () => {
    const { bindings } = await fixture();

    await expect(bindings.remove('Missing')).rejects.toMatchObject({
      statusCode: 404,
      code: 'location_not_found',
    });
  });

  it('rejects an unsupported server endpoint with a coded error', () => {
    let error: unknown;
    try {
      new LocalProjectBindings(tmpdir(), 'http://lan.example:8080');
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: 'endpoint_unsupported' });
  });

  it('writes nothing once the save is aborted', async () => {
    const { root, source, bindings } = await fixture();
    const controller = new AbortController();
    controller.abort();

    await expect(
      bindings.save(binding(source), { signal: controller.signal }),
    ).rejects.toThrow();
    await expect(stat(join(root, 'projects.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
