import { posix as path } from 'node:path';

import type { Tree } from '@nx/devkit';
import {
  formatFiles,
  getProjects,
  joinPathFragments,
  logger,
  readJson,
  updateJson,
  writeJson,
} from '@nx/devkit';

import type { SplitTsconfigsGeneratorSchema } from './schema';

type Json = Record<string, unknown>;

type TsConfig = {
  compilerOptions?: Json;
  exclude?: string[];
  extends?: string;
  files?: string[];
  include?: string[];
  references?: Array<{ path: string }>;
};

const TEST_PATTERNS = [
  'vitest.config.ts',
  'vitest.config.mts',
  'playwright.config.ts',
  'src/**/*.test.ts',
  'src/**/*.spec.ts',
  'src/**/*.test.tsx',
  'src/**/*.spec.tsx',
  'src/**/*.test.js',
  'src/**/*.spec.js',
  'src/**/*.d.ts',
];

const SOURCE_TEST_EXCLUDES = [
  'src/**/*.test.ts',
  'src/**/*.spec.ts',
  'src/**/*.test.tsx',
  'src/**/*.spec.tsx',
  'src/**/*.test.js',
  'src/**/*.spec.js',
  '__tests__',
  'e2e',
];

export default async function splitTsconfigsGenerator(
  tree: Tree,
  options: SplitTsconfigsGeneratorSchema,
) {
  if (!options.all && !options.project) {
    throw new Error('Pass --project=<name> or --all.');
  }

  const projects = getProjects(tree);
  const selected = [...projects.entries()]
    .filter(([name]) => options.all || name === options.project)
    .sort((a, b) => a[1].root.localeCompare(b[1].root));

  if (selected.length === 0) {
    throw new Error(`Project not found: ${options.project}`);
  }

  let migrated = 0;
  for (const [name, project] of selected) {
    const result = migrateProject(tree, {
      name,
      root: project.root,
      force: options.force ?? false,
    });
    if (result) {
      migrated++;
      logger.info(`split-tsconfigs: migrated ${name}`);
    }
  }

  logger.info(`split-tsconfigs: migrated ${migrated} project(s)`);

  if (!options.skipFormat) {
    await formatFiles(tree);
  }
}

function migrateProject(
  tree: Tree,
  options: { force: boolean; name: string; root: string },
): boolean {
  const rootTsconfigPath = joinPathFragments(options.root, 'tsconfig.json');
  if (!tree.exists(rootTsconfigPath)) {
    return false;
  }

  const libTsconfigPath = joinPathFragments(options.root, 'tsconfig.lib.json');
  const specTsconfigPath = joinPathFragments(
    options.root,
    'tsconfig.spec.json',
  );
  const testTsconfigPath = joinPathFragments(
    options.root,
    'tsconfig.test.json',
  );

  if (!options.force && tree.exists(libTsconfigPath)) {
    return false;
  }

  const root = readJson<TsConfig>(tree, rootTsconfigPath);
  const existingLib = tree.exists(libTsconfigPath)
    ? readJson<TsConfig>(tree, libTsconfigPath)
    : undefined;
  const existingSpec = tree.exists(specTsconfigPath)
    ? readJson<TsConfig>(tree, specTsconfigPath)
    : undefined;
  const source =
    options.force && existingLib ? mergeTsconfig(root, existingLib) : root;
  const hasProjectTests = existingSpec !== undefined;
  const hasTestTsconfig = tree.exists(testTsconfigPath);
  const e2eOnly = isE2eOnlyProject(options.name, options.root);
  const projectPackageJson = readProjectPackageJson(tree, options.root);
  const preserveDistOutDir = isTscBuildProject(projectPackageJson);

  if (e2eOnly) {
    const specSource = options.force && existingSpec ? existingSpec : root;
    writeJson(
      tree,
      rootTsconfigPath,
      solutionTsconfig(root.extends, [{ path: './tsconfig.spec.json' }]),
    );
    writeJson(tree, specTsconfigPath, {
      compilerOptions: {
        ...(specSource.compilerOptions ?? {}),
        composite: true,
        tsBuildInfoFile: './out-tsc/tsconfig.spec.tsbuildinfo',
      },
      extends: './tsconfig.json',
      include: specSource.include ?? specIncludes(tree, options.root),
      references: normalizeReferences(
        tree,
        options.root,
        specSource.references ?? [],
      ),
    });
    return true;
  }

  const references = [{ path: './tsconfig.lib.json' }];
  if (hasProjectTests) {
    references.push({ path: './tsconfig.spec.json' });
  }

  writeJson(tree, rootTsconfigPath, solutionTsconfig(root.extends, references));
  writeJson(
    tree,
    libTsconfigPath,
    sourceTsconfig(source, {
      packageJson: projectPackageJson,
      preserveDistOutDir,
    }),
  );

  if (hasProjectTests) {
    writeJson(
      tree,
      specTsconfigPath,
      specTsconfig(tree, source, options.root, existingSpec),
    );
  }

  if (hasTestTsconfig) {
    updateJson<TsConfig>(tree, testTsconfigPath, (json) => {
      json.references = [{ path: './tsconfig.lib.json' }];
      return json;
    });
  }

  return true;
}

function solutionTsconfig(
  extendsPath: string | undefined,
  references: Array<{ path: string }>,
): TsConfig {
  return {
    extends: extendsPath,
    files: [],
    include: [],
    references,
  };
}

function mergeTsconfig(root: TsConfig, child: TsConfig): TsConfig {
  return {
    ...child,
    compilerOptions: {
      ...(root.compilerOptions ?? {}),
      ...(child.compilerOptions ?? {}),
    },
  };
}

function normalizeReferences(
  tree: Tree,
  projectRoot: string,
  references: Array<{ path: string }>,
): Array<{ path: string }> {
  return references.map((reference) => {
    if (reference.path.endsWith('.json')) {
      return reference;
    }

    const libTsconfigPath = path.normalize(
      path.join(projectRoot, reference.path, 'tsconfig.lib.json'),
    );
    if (!tree.exists(libTsconfigPath)) {
      return reference;
    }

    return { path: `${reference.path}/tsconfig.lib.json` };
  });
}

function sourceTsconfig(
  root: TsConfig,
  options: { packageJson: Json; preserveDistOutDir: boolean },
): TsConfig {
  const compilerOptions: Json = {
    ...(root.compilerOptions ?? {}),
    composite: true,
  };

  if (hasLocalGenerators(options.packageJson)) {
    compilerOptions.rootDir = '.';
  }

  if (options.preserveDistOutDir) {
    compilerOptions.outDir = './dist';
    compilerOptions.tsBuildInfoFile = './dist/tsconfig.tsbuildinfo';
  } else if (isDistOutDir(compilerOptions.outDir)) {
    compilerOptions.outDir = './out-tsc';
    compilerOptions.tsBuildInfoFile = './out-tsc/tsconfig.tsbuildinfo';
  }

  return {
    compilerOptions,
    exclude: unique([...(root.exclude ?? []), ...SOURCE_TEST_EXCLUDES]),
    extends: './tsconfig.json',
    include: unique([
      ...(root.include ?? sourceIncludes()),
      ...generatorIncludes(options.packageJson),
    ]),
    references: root.references ?? [],
  };
}

function readProjectPackageJson(tree: Tree, projectRoot: string): Json {
  const packageJsonPath = joinPathFragments(projectRoot, 'package.json');
  return tree.exists(packageJsonPath)
    ? readJson<Json>(tree, packageJsonPath)
    : {};
}

function isTscBuildProject(packageJson: Json): boolean {
  const scripts = isJson(packageJson.scripts) ? packageJson.scripts : {};
  const nx = isJson(packageJson.nx) ? packageJson.nx : {};
  const nxTargets = isJson(nx.targets) ? nx.targets : {};
  const typecheckTarget = isJson(nxTargets.typecheck)
    ? nxTargets.typecheck
    : {};

  return (
    isTscBuildScript(scripts.build) || typecheckTarget.executor === 'nx:noop'
  );
}

function isDistOutDir(value: unknown): boolean {
  return value === 'dist' || value === './dist';
}

function isTscBuildScript(value: unknown): boolean {
  return (
    typeof value === 'string' && /^tsc\s+(?:-b|--build)(?:\s|$)/.test(value)
  );
}

function hasLocalGenerators(packageJson: Json): boolean {
  return (
    typeof packageJson.generators === 'string' ||
    typeof packageJson.schematics === 'string'
  );
}

function specTsconfig(
  tree: Tree,
  root: TsConfig,
  projectRoot: string,
  existingSpec: TsConfig | undefined,
): TsConfig {
  const specSource = existingSpec ?? root;
  const rootCompilerOptions = specSource.compilerOptions ?? {};
  return {
    compilerOptions: {
      ...pick(rootCompilerOptions, [
        'allowJs',
        'jsx',
        'lib',
        'module',
        'moduleResolution',
        'sourceMap',
        'types',
      ]),
      composite: true,
      outDir: './out-tsc/spec',
      rootDir: '.',
      tsBuildInfoFile: './out-tsc/tsconfig.spec.tsbuildinfo',
      types: unique([
        ...arrayValue(rootCompilerOptions.types),
        'vitest/globals',
        'vitest',
        'node',
      ]),
    },
    extends: './tsconfig.json',
    include: specSource.include ?? specIncludes(tree, projectRoot),
    references: [{ path: './tsconfig.lib.json' }],
  };
}

function sourceIncludes(): string[] {
  return ['src/**/*.ts'];
}

function generatorIncludes(packageJson: Json): string[] {
  return hasLocalGenerators(packageJson) ? ['generators/**/*.ts'] : [];
}

function specIncludes(tree: Tree, projectRoot: string): string[] {
  const includes = [...TEST_PATTERNS];
  if (tree.exists(joinPathFragments(projectRoot, '__tests__'))) {
    includes.push('__tests__/**/*.ts', '__tests__/**/*.tsx');
  }
  if (tree.exists(joinPathFragments(projectRoot, 'e2e'))) {
    includes.push('e2e/**/*.ts');
  }
  return includes;
}

function isE2eOnlyProject(projectName: string, projectRoot: string): boolean {
  return projectName.endsWith('-e2e') || projectRoot.endsWith('-e2e');
}

function pick(source: Json, keys: string[]): Json {
  return Object.fromEntries(
    keys
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]),
  );
}

function arrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isString) : [];
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
