import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ProjectSelectionOptions } from '../src/project-bindings.js';
import {
  type ProjectConfig,
  readProjectConfig,
  resolveProjectBinding,
  updateProjectConfig,
  validateProjectConfig,
} from '../src/project-bindings.js';

let root: string;
let configPath: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'project-bindings-')));
  configPath = join(root, 'projects.json');
  await mkdir(join(root, 'source', 'nested'), { recursive: true });
});
afterEach(async () => rm(root, { recursive: true, force: true }));

function config(): ProjectConfig {
  return {
    version: 1,
    bindings: [
      {
        name: 'local',
        apiUrl: 'https://api.themolt.net',
        teamId: 'team',
        projectId: 'project',
        source: './source',
        strategy: 'existing',
        default: true,
      },
    ],
  };
}

describe('project binding contract', () => {
  it('rejects unsupported versions, legacy contexts, and unknown fields', () => {
    expect(() => validateProjectConfig({ version: 2, bindings: [] })).toThrow(
      /version/,
    );
    expect(() => validateProjectConfig({ version: 1, contexts: {} })).toThrow(
      /migrat/i,
    );
    expect(() =>
      validateProjectConfig({ ...config(), credential: 'secret' }),
    ).toThrow(/unknown/i);
  });
  it('requires an explicit strategy and a unique default per project and endpoint', () => {
    const value = config();
    expect(() =>
      validateProjectConfig({
        version: 1,
        bindings: [{ ...value.bindings[0], strategy: undefined }],
      }),
    ).toThrow(/strategy/);
    value.bindings.push({ ...value.bindings[0], name: 'other' });
    expect(() => validateProjectConfig(value)).toThrow(/default/);
  });
  it('resolves configured relative paths against the config and overrides against caller CWD', async () => {
    const value = config();
    const selected = await resolveProjectBinding(value, {
      configPath,
      binding: 'local',
      cwd: join(root, 'source'),
      overrides: { source: './nested', strategy: 'isolated-directory' },
    });
    expect(selected?.source).toBe(join(root, 'source', 'nested'));
    expect(selected?.strategy).toBe('isolated-directory');
    expect(value.bindings[0].source).toBe('./source');
    expect(value.bindings[0].strategy).toBe('existing');
  });
  it('chooses the most specific registered ancestor without matching path prefixes', async () => {
    const value = config();
    value.bindings.push({
      ...value.bindings[0],
      name: 'nested',
      source: './source/nested',
      projectId: 'nested-project',
    });
    expect(
      (
        await resolveProjectBinding(value, {
          configPath,
          cwd: join(root, 'source', 'nested'),
          native: true,
        })
      )?.name,
    ).toBe('nested');
    await mkdir(join(root, 'source-other'));
    expect(
      await resolveProjectBinding(value, {
        configPath,
        cwd: join(root, 'source-other'),
        native: true,
      }),
    ).toBeNull();
  });
  it('rejects canonical aliases instead of guessing between registered ancestors', async () => {
    await symlink(join(root, 'source'), join(root, 'alias'));
    const value = config();
    value.bindings.push({
      ...value.bindings[0],
      name: 'alias',
      source: './alias',
      default: false,
    });
    await expect(
      resolveProjectBinding(value, {
        configPath,
        cwd: join(root, 'source'),
        native: true,
      }),
    ).rejects.toThrow(/ambiguous/i);
  });
  it('requires a choice among bindings without a default', async () => {
    const value = config();
    value.bindings[0].default = false;
    value.bindings.push({ ...value.bindings[0], name: 'other' });
    await expect(
      resolveProjectBinding(value, {
        configPath,
        cwd: root,
        projectId: 'project',
      }),
    ).rejects.toThrow(/ambiguous/i);
  });
  it('does not use a binding from a different endpoint or team', async () => {
    await expect(
      resolveProjectBinding(config(), {
        configPath,
        cwd: root,
        binding: 'local',
        teamId: 'other',
      }),
    ).rejects.toThrow(/match/i);
    await expect(
      resolveProjectBinding(config(), {
        configPath,
        cwd: root,
        binding: 'local',
        apiUrl: 'https://other.example',
      }),
    ).rejects.toThrow(/match/i);
  });
  it('requires a usable folder, except for no-workspace bindings', async () => {
    const value = config();
    value.bindings[0].source = './missing';
    await expect(
      resolveProjectBinding(value, { configPath, cwd: root, binding: 'local' }),
    ).rejects.toThrow();
    value.bindings[0].strategy = 'none';
    delete value.bindings[0].source;
    expect(
      (
        await resolveProjectBinding(value, {
          configPath,
          cwd: root,
          binding: 'local',
        })
      )?.source,
    ).toBeUndefined();
  });
  it('validates trusted hook commands and bounded timeouts', () => {
    const value = config();
    value.bindings[0].hooks = {
      beforeRun: { command: 'node', args: ['check.js'], timeoutMs: 1000 },
    };
    expect(() => validateProjectConfig(value)).not.toThrow();
    value.bindings[0].hooks.beforeRun!.timeoutMs = 0;
    expect(() => validateProjectConfig(value)).toThrow(/timeout/);
  });
  it('serializes concurrent read-modify-write updates without dropping bindings', async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        updateProjectConfig(configPath, (current) => {
          current.bindings.push({
            ...config().bindings[0],
            name: `binding-${index}`,
            default: false,
          });
        }),
      ),
    );
    expect((await readProjectConfig(configPath)).bindings).toHaveLength(8);
    expect(JSON.parse(await readFile(configPath, 'utf8')).version).toBe(1);
  });
  it('leaves a valid store intact when an update fails validation', async () => {
    await updateProjectConfig(configPath, (current) => {
      current.bindings = config().bindings;
    });
    await expect(
      updateProjectConfig(configPath, (current) => {
        current.version = 2 as 1;
      }),
    ).rejects.toThrow(/version/);
    expect((await readProjectConfig(configPath)).version).toBe(1);
  });
});

const fixtures = JSON.parse(
  await readFile(
    new URL('./fixtures/project-bindings.json', import.meta.url),
    'utf8',
  ),
) as Array<{
  name: string;
  config: ProjectConfig;
  options: Omit<ProjectSelectionOptions, 'cwd'> & { cwd?: string };
  expected?: string | null;
  expectedSource?: string;
  error?: boolean;
}>;
describe('shared Go/TypeScript fixtures', () => {
  it.each(fixtures)('$name', async (fixture) => {
    await symlink(join(root, 'source'), join(root, 'alias'));
    const options = {
      ...fixture.options,
      configPath,
      cwd: join(root, fixture.options.cwd ?? '.'),
    };
    if (fixture.error) {
      await expect(
        resolveProjectBinding(fixture.config, options),
      ).rejects.toThrow();
    } else {
      const selected = await resolveProjectBinding(fixture.config, options);
      expect(selected?.name ?? null).toBe(fixture.expected);
      if (fixture.expectedSource)
        expect(selected?.source).toBe(join(root, fixture.expectedSource));
    }
  });
});
