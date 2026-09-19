import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
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
  it('rejects unsupported versions and unknown fields', () => {
    expect(() => validateProjectConfig({ version: 2, bindings: [] })).toThrow(
      /version/,
    );
    expect(() => validateProjectConfig({ version: 1, contexts: {} })).toThrow(
      /unknown/i,
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
  expectedApiUrl?: string;
  expectedStrategy?: string;
  expectedDiaryId?: string;
  error?: boolean;
  errorKind?: string;
}>;
describe('shared Go/TypeScript fixtures', () => {
  it.each(fixtures)('$name', async (fixture) => {
    await symlink(join(root, 'source'), join(root, 'alias'));
    await mkdir(join(root, 'source-other'));
    const options = {
      ...fixture.options,
      configPath,
      cwd: join(root, fixture.options.cwd ?? '.'),
    };
    if (fixture.error) {
      await expect(
        resolveProjectBinding(fixture.config, options),
      ).rejects.toMatchObject({ kind: fixture.errorKind });
    } else {
      const selected = await resolveProjectBinding(fixture.config, options);
      expect(selected?.name ?? null).toBe(fixture.expected);
      if (fixture.expectedApiUrl)
        expect(selected?.apiUrl).toBe(fixture.expectedApiUrl);
      if (fixture.expectedDiaryId)
        expect(selected?.diaryId).toBe(fixture.expectedDiaryId);
      if (fixture.expectedStrategy)
        expect(selected?.strategy).toBe(fixture.expectedStrategy);
      if (fixture.expectedSource)
        expect(selected?.source).toBe(join(root, fixture.expectedSource));
    }
  });
});

it('rejects runtime override keys outside the contract and ignores undefined', async () => {
  for (const key of ['apiUrl', 'teamId', 'projectId', 'hooks', '__proto__']) {
    await expect(
      resolveProjectBinding(config(), {
        configPath,
        cwd: root,
        overrides: JSON.parse(`{"${key}":"other"}`),
      }),
    ).rejects.toThrow(/override/i);
  }
  const selected = await resolveProjectBinding(config(), {
    configPath,
    cwd: root,
    overrides: { source: undefined },
  });
  expect(selected?.source).toBe(join(root, 'source'));
});

describe('project config read guards', () => {
  it.each(['malformed', 'oversized', 'directory', 'symlink', 'writable'])(
    'rejects %s with the file path',
    async (kind) => {
      if (kind === 'directory') await mkdir(configPath);
      else if (kind === 'symlink') {
        await writeFile(join(root, 'target'), JSON.stringify(config()));
        await symlink(join(root, 'target'), configPath);
      } else {
        await writeFile(
          configPath,
          kind === 'malformed'
            ? '{'
            : kind === 'oversized'
              ? ' '.repeat(1_048_577)
              : JSON.stringify(config()),
          { mode: 0o600 },
        );
        if (kind === 'writable') await chmod(configPath, 0o666);
      }
      if (kind === 'writable' && process.platform === 'win32') return;
      await expect(readProjectConfig(configPath)).rejects.toThrow(configPath);
    },
  );
  it('returns an empty configuration only for a missing file', async () => {
    expect(await readProjectConfig(configPath)).toEqual({
      version: 1,
      bindings: [],
    });
  });
});

it('persists the canonical endpoint', async () => {
  await updateProjectConfig(configPath, (current) => {
    current.bindings = [
      { ...config().bindings[0], apiUrl: 'https://api.example/' },
    ];
  });
  expect((await readProjectConfig(configPath)).bindings[0].apiUrl).toBe(
    'https://api.example',
  );
});

it('ignores inherited run overrides', async () => {
  const selected = await resolveProjectBinding(config(), {
    configPath,
    cwd: root,
    overrides: Object.create({
      source: './missing',
      strategy: 'none',
      diaryId: 'inherited',
    }),
  });
  expect(selected?.source).toBe(join(root, 'source'));
  expect(selected?.strategy).toBe('existing');
  expect(selected?.diaryId).toBeUndefined();
});
it('reports unavailable registrations even among multiple candidates', async () => {
  const value = config();
  value.bindings.push({
    ...value.bindings[0],
    name: 'missing',
    source: './missing',
    default: false,
  });
  await expect(
    resolveProjectBinding(value, {
      configPath,
      cwd: join(root, 'source'),
      native: true,
    }),
  ).rejects.toThrow(/missing.*unavailable/i);
});
it('rejects malformed Unicode strings', () => {
  const value = config();
  value.bindings[0].name = String.fromCharCode(0xd800);
  expect(() => validateProjectConfig(value)).toThrow(/Unicode/i);
});
it('resolves case aliases on case-insensitive filesystems', async () => {
  await mkdir(join(root, 'CaseDir'));
  try {
    await realpath(join(root, 'casedir'));
  } catch {
    return;
  }
  const value = config();
  value.bindings[0].source = './CaseDir';
  const selected = await resolveProjectBinding(value, {
    configPath,
    cwd: join(root, 'casedir'),
    native: true,
  });
  expect(selected?.source).toBe(await realpath(join(root, 'CaseDir')));
});

it('resolves through a traverse-only ancestor', async () => {
  if (process.platform === 'win32') return;
  const source = join(root, 'source');
  await chmod(source, 0o111);
  try {
    const value = config();
    value.bindings[0].source = './source/nested';
    const result = await resolveProjectBinding(value, {
      configPath,
      cwd: join(source, 'nested'),
      native: true,
    });
    expect(result?.source).toBe(join(source, 'nested'));
  } finally {
    await chmod(source, 0o700);
  }
});
