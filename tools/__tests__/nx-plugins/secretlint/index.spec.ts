import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { CreateNodesContextV2, ProjectConfiguration } from '@nx/devkit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createNodesV2,
  orphanGlobs,
  ruleDependencies,
} from '../../../nx-plugins/secretlint/index';

const ROOT_CONFIG = `{
  // Comments are valid: Secretlint parses its config as JSON5.
  "rules": [
    { "id": "@secretlint/secretlint-rule-preset-recommend" },
    { "id": "@secretlint/secretlint-rule-pattern" },
  ],
}`;
const ROOT_PACKAGES = [
  'secretlint',
  '@secretlint/secretlint-rule-preset-recommend',
  '@secretlint/secretlint-rule-pattern',
];
const IGNORE_FILES = '{workspaceRoot}/**/.secretlintignore';

describe('secretlint plugin', () => {
  let workspaceRoot: string;
  let context: CreateNodesContextV2;

  const touch = (path: string, content = '') => {
    mkdirSync(dirname(join(workspaceRoot, path)), { recursive: true });
    writeFileSync(join(workspaceRoot, path), content);
  };

  /**
   * Every project entry the plugin emits, keeping duplicates visible. The root
   * package.json is included unless a test is about its absence.
   */
  const run = async (files: string[], options = {}, withRoot = true) => {
    const [, createNodes] = createNodesV2;
    const manifests =
      withRoot && !files.includes('package.json')
        ? ['package.json', ...files]
        : files;
    const results = await createNodes(manifests, options, context);
    return results.flatMap(([, result]) =>
      Object.entries(result.projects ?? {}),
    ) as Array<[string, Partial<ProjectConfiguration>]>;
  };

  const byRoot = (entries: Array<[string, Partial<ProjectConfiguration>]>) =>
    Object.fromEntries(entries);

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'secretlint-plugin-'));
    context = { workspaceRoot, nxJsonConfiguration: {} };
    touch('.secretlintrc.json', ROOT_CONFIG);
    touch('.gitignore', 'node_modules\ndist\n*.local\n');
    touch('package.json', JSON.stringify({ name: 'moltnet' }));
    touch('README.md');
    touch('.github/workflows/ci.yml');
    touch('node_modules/x/index.js');
    touch('infra/README.md');
    touch('infra/ory/kratos.yaml');
    touch('infra/absurd/project.json');
    touch('libs/a/package.json');
    touch('libs/a/project.json');
    touch('libs/settings.local');
    touch('packages/cli/package.json');
    touch('packages/cli/npm/x64/package.json');
    touch('tools/package.json');
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it('infers one target per project, run from the workspace root', async () => {
    // Act
    const entries = await run([
      'package.json',
      'libs/a/package.json',
      'libs/a/project.json',
      'tools/package.json',
    ]);

    // Assert
    expect(entries.map(([root]) => root).sort()).toEqual([
      '.',
      'libs/a',
      'tools',
    ]);
    const target = byRoot(entries)['libs/a'].targets?.secretlint;
    expect(target?.command).toBe(
      "secretlint 'libs/a/**/*' --secretlintrc '.secretlintrc.json'",
    );
    expect(target?.cache).toBe(true);
    expect(target?.inputs).toEqual([
      '{workspaceRoot}/libs/a/**/*',
      '{workspaceRoot}/.secretlintrc.json',
      IGNORE_FILES,
      { externalDependencies: ROOT_PACKAGES },
    ]);
  });

  it('uses a project config when one exists', async () => {
    // Arrange
    touch('libs/a/.secretlintrc.json', '{ "rules": [{ "id": "./rule.js" }] }');

    // Act
    const entries = await run(['libs/a/package.json', 'tools/package.json']);

    // Assert
    const target = byRoot(entries)['libs/a'].targets?.secretlint;
    expect(target?.command).toContain(
      "--secretlintrc 'libs/a/.secretlintrc.json'",
    );
    expect(target?.inputs).toContain('{workspaceRoot}/libs/a/rule.js');
    expect(target?.inputs).toContainEqual({
      externalDependencies: ['secretlint'],
    });
  });

  it('quotes paths so shell syntax stays literal', async () => {
    // Arrange
    touch("libs/it's $HOME/package.json");

    // Act
    const entries = await run([
      "libs/it's $HOME/package.json",
      'tools/package.json',
    ]);

    // Assert
    expect(
      byRoot(entries)["libs/it's $HOME"].targets?.secretlint?.command,
    ).toBe(
      "secretlint 'libs/it'\\''s $HOME/**/*' --secretlintrc '.secretlintrc.json'",
    );
  });

  it('rejects a project root containing glob syntax', async () => {
    // Act / Assert
    await expect(
      run(['libs/[id]/package.json', 'tools/package.json']),
    ).rejects.toThrow(/"libs\/\[id\]" contains glob syntax/);
  });

  it('gives the root project a target over the orphan globs and the root config', async () => {
    // Act
    const entries = await run(
      [
        'infra/absurd/project.json',
        'libs/a/package.json',
        'packages/cli/package.json',
        'packages/cli/npm/x64/package.json',
        'tools/package.json',
      ],
      { targetName: 'scan' },
    );

    // Assert
    const projects = byRoot(entries);
    expect(Object.keys(projects['libs/a'].targets ?? {})).toEqual(['scan']);
    expect(Object.keys(projects.tools.targets ?? {})).toEqual(['scan']);
    expect(projects['.'].name).toBe('moltnet');
    expect(Object.keys(projects['.'].targets ?? {})).toEqual(['scan']);
    const target = projects['.'].targets?.scan;
    expect(target?.command).toBe(
      "secretlint '*' '.github/**/*' 'infra/*' 'infra/ory/**/*' --secretlintrc '.secretlintrc.json'",
    );
    expect(target?.inputs).toEqual([
      '{workspaceRoot}/*',
      '{workspaceRoot}/.github/**/*',
      '{workspaceRoot}/infra/*',
      '{workspaceRoot}/infra/ory/**/*',
      '{workspaceRoot}/.secretlintrc.json',
      IGNORE_FILES,
      { externalDependencies: ROOT_PACKAGES },
    ]);
  });

  it.each([
    [['libs/a/package.json', 'libs/a/project.json']],
    [['libs/a/project.json', 'libs/a/package.json']],
  ])('emits a directory with two manifests once (%j)', async (manifests) => {
    // Act
    const entries = await run([...manifests, 'tools/package.json']);

    // Assert
    expect(entries.filter(([root]) => root === 'libs/a')).toHaveLength(1);
  });

  it('fails without a root package.json to host the root project', async () => {
    // Act / Assert
    await expect(run(['libs/a/package.json'], {}, false)).rejects.toThrow(
      /no root package.json/,
    );
  });

  it('names a malformed project config while building the graph', async () => {
    // Arrange
    touch('libs/a/.secretlintrc.json', '{ "rules": {} }');

    // Act
    const error = await run(['libs/a/package.json', 'tools/package.json']).then(
      () => undefined,
      (caught: unknown) => caught as { errors?: Array<[string, Error]> },
    );

    // Assert: Nx reports each per-file error with its manifest.
    expect(error?.errors).toEqual([
      [
        'libs/a/package.json',
        expect.objectContaining({
          message: expect.stringMatching(
            /cannot read libs\/a\/\.secretlintrc\.json: "rules" must be an array/,
          ),
        }),
      ],
    ]);
  });

  it('skips gitignored files and directories when computing orphan globs', () => {
    // Act: libs/ holds only a gitignored file besides its project.
    const globs = orphanGlobs(['libs/a', 'tools'], workspaceRoot);

    // Assert
    expect(globs).toEqual(['*', '.github/**/*', 'infra/**/*', 'packages/**/*']);
  });

  it('rejects an orphan directory containing glob syntax', () => {
    // Arrange
    touch('docs-[draft]/notes.md');

    // Act / Assert
    expect(() => orphanGlobs(['libs/a', 'tools'], workspaceRoot)).toThrow(
      /"docs-\[draft\]" contains glob syntax/,
    );
  });

  it('computes orphan globs without a .gitignore', () => {
    // Arrange
    rmSync(join(workspaceRoot, '.gitignore'));

    // Act
    const globs = orphanGlobs(['libs/a', 'tools'], workspaceRoot);

    // Assert
    expect(globs).toContain('libs/*');
    expect(globs).toContain('node_modules/**/*');
  });

  describe('ruleDependencies', () => {
    const read = () =>
      ruleDependencies(join(workspaceRoot, 'rc.json'), workspaceRoot);

    it('splits rule packages from local rule files', () => {
      // Arrange
      touch('rc.json', '{ "rules": [{ "id": "a" }, { "id": "./local.js" }] }');

      // Act / Assert
      expect(read()).toEqual({
        packages: ['secretlint', 'a'],
        files: ['local.js'],
      });
    });

    it('accepts a config without rules', () => {
      // Arrange
      touch('rc.json', '{}');

      // Act / Assert
      expect(read()).toEqual({ packages: ['secretlint'], files: [] });
    });

    it.each([
      ['{ "rules": [', /cannot read rc\.json/],
      ['{ "rules": {} }', /"rules" must be an array/],
      ['{ "rules": [null] }', /every rule needs a string "id"/],
      ['{ "rules": [{ "id": 1 }] }', /every rule needs a string "id"/],
    ])('names the config file when %s is invalid', (content, message) => {
      // Arrange
      touch('rc.json', content);

      // Act / Assert
      expect(read).toThrow(message);
    });
  });
});
