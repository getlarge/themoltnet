/**
 * Local Nx plugin: infers a cached `secretlint` target for every project,
 * including a root project that owns the files outside every other project.
 *
 * Every target runs the Secretlint CLI from the workspace root and selects
 * files with a glob. Secretlint applies `.gitignore` files from its cwd
 * downwards, so running from a project directory would skip the root
 * `.gitignore`.
 *
 * Config: `{projectRoot}/.secretlintrc.json` when present (it replaces the
 * root config), otherwise the workspace-root `.secretlintrc.json`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

import {
  type CreateNodes,
  createNodesFromFiles,
  type TargetConfiguration,
} from '@nx/devkit';
import ignore from 'ignore';
import JSON5 from 'json5';

export interface SecretlintPluginOptions {
  targetName?: string;
}

const CONFIG_FILE = '.secretlintrc.json';
const WORKSPACE_ROOT = '.';

/**
 * Packages whose version changes what a scan finds: the CLI plus every
 * top-level rule package in the config. Parsed as JSON5, as Secretlint does,
 * so a comment in the config does not break the project graph. Rule ids that
 * are file paths are not packages; they are returned as files to hash.
 */
export function ruleDependencies(
  configPath: string,
  workspaceRoot: string,
): { packages: string[]; files: string[] } {
  const fail = (reason: string): never => {
    throw new Error(
      `secretlint plugin: cannot read ${posix.relative(workspaceRoot, configPath)}: ${reason}`,
    );
  };
  let config: unknown;
  try {
    config = JSON5.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    fail((error as Error).message);
  }
  const rules = (config as { rules?: unknown } | null)?.rules ?? [];
  if (!Array.isArray(rules)) fail('"rules" must be an array');
  const ids = (rules as unknown[]).map((rule) =>
    typeof rule === 'object' && rule !== null
      ? (rule as { id?: unknown }).id
      : undefined,
  );
  if (ids.some((id) => typeof id !== 'string')) {
    fail('every rule needs a string "id"');
  }
  const isPath = (id: string) => id.startsWith('.') || id.startsWith('/');
  return {
    packages: ['secretlint', ...(ids as string[]).filter((id) => !isPath(id))],
    files: (ids as string[])
      .filter(isPath)
      .map((id) =>
        posix.relative(workspaceRoot, posix.resolve(dirname(configPath), id)),
      ),
  };
}

// Picomatch and Nx would read these as glob syntax in a directory name.
const GLOB_SYNTAX = /[*?[\]{}()!]/;

function assertLiteralPath(path: string): string {
  if (GLOB_SYNTAX.test(path)) {
    throw new Error(
      `secretlint plugin: "${path}" contains glob syntax and cannot be scanned literally; rename it`,
    );
  }
  return path;
}

/**
 * Globs covering every file outside the given project roots: the files
 * directly inside each ancestor of a project root, and every sibling
 * directory that contains no project. Positive globs only, because the
 * Secretlint CLI cannot exclude a subdirectory from a glob.
 */
export function orphanGlobs(
  projectRoots: readonly string[],
  workspaceRoot: string,
): string[] {
  const roots = new Set(projectRoots);
  const belongsToProject = (dir: string) =>
    projectRoots.some((root) => dir === root || dir.startsWith(`${root}/`));
  // Directories that hold project roots but belong to no project themselves.
  const ancestors = new Set([WORKSPACE_ROOT]);
  for (const root of projectRoots) {
    for (let dir = posix.dirname(root); dir !== WORKSPACE_ROOT;) {
      if (!belongsToProject(dir)) ancestors.add(dir);
      dir = posix.dirname(dir);
    }
  }
  const gitignore = join(workspaceRoot, '.gitignore');
  // `.git` is never in .gitignore, but it must never be scanned or hashed.
  const ignored = ignore()
    .add('.git')
    .add(existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : '');

  const globs: string[] = [];
  for (const dir of ancestors) {
    let hasFiles = false;
    for (const entry of readdirSync(join(workspaceRoot, dir), {
      withFileTypes: true,
    })) {
      const path = posix.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (roots.has(path) || ancestors.has(path)) continue;
        if (ignored.ignores(`${path}/`)) continue;
        globs.push(`${assertLiteralPath(path)}/**/*`);
      } else if (!ignored.ignores(path)) {
        hasFiles = true;
      }
    }
    if (hasFiles) {
      globs.push(dir === WORKSPACE_ROOT ? '*' : `${assertLiteralPath(dir)}/*`);
    }
  }
  // readdir order is filesystem-dependent; a stable command keeps the target stable.
  return globs.sort();
}

/** Single-quotes a shell word, so `$`, backticks and globs stay literal. */
const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

function buildTarget(
  globs: readonly string[],
  config: string,
  dependencies: { packages: string[]; files: string[] },
  description: string,
): TargetConfiguration {
  return {
    command: `secretlint ${globs.map(shellQuote).join(' ')} --secretlintrc ${shellQuote(config)}`,
    cache: true,
    inputs: [
      ...globs.map((glob) => `{workspaceRoot}/${glob}`),
      `{workspaceRoot}/${config}`,
      ...dependencies.files.map((file) => `{workspaceRoot}/${file}`),
      // The CLI reads .secretlintignore in every directory it walks,
      // including ancestors of a project; any of them can hide files.
      '{workspaceRoot}/**/.secretlintignore',
      { externalDependencies: dependencies.packages },
    ],
    outputs: [],
    metadata: { description, technologies: ['secretlint'] },
  };
}

export const createNodesV2: CreateNodes<SecretlintPluginOptions> = [
  '**/{project.json,package.json}',
  async (configFiles, options, context) => {
    const targetName = options?.targetName ?? 'secretlint';
    const rootManifest = 'package.json';
    if (!configFiles.includes(rootManifest)) {
      // Without it there is no root project, and files outside every project
      // would go unscanned without a word.
      throw new Error(
        'secretlint plugin: the workspace has no root package.json to host the root project',
      );
    }

    const projectRoots = [
      ...new Set(
        configFiles
          .map((file) => dirname(file))
          .filter((root) => root !== WORKSPACE_ROOT)
          .map(assertLiteralPath),
      ),
    ];

    // Each config is parsed once per graph build, not once per project.
    const dependenciesByConfig = new Map<
      string,
      ReturnType<typeof ruleDependencies>
    >();
    const dependenciesFor = (config: string) => {
      let dependencies = dependenciesByConfig.get(config);
      if (!dependencies) {
        dependencies = ruleDependencies(
          join(context.workspaceRoot, config),
          context.workspaceRoot,
        );
        dependenciesByConfig.set(config, dependencies);
      }
      return dependencies;
    };

    // A directory with both project.json and package.json matches twice;
    // attach targets through the first file only.
    const firstFileByRoot = new Map<string, string>();
    for (const file of configFiles) {
      const root = dirname(file);
      if (!firstFileByRoot.has(root)) firstFileByRoot.set(root, file);
    }

    return createNodesFromFiles(
      (file) => {
        const root = dirname(file);
        if (firstFileByRoot.get(root) !== file) return {};
        if (root === WORKSPACE_ROOT) {
          // The root project owns the files outside every other project,
          // which is also how Nx attributes them when computing affected.
          const { name } = JSON.parse(
            readFileSync(join(context.workspaceRoot, rootManifest), 'utf8'),
          ) as { name?: string };
          return {
            projects: {
              [WORKSPACE_ROOT]: {
                name,
                targets: {
                  [targetName]: buildTarget(
                    orphanGlobs(projectRoots, context.workspaceRoot),
                    CONFIG_FILE,
                    dependenciesFor(CONFIG_FILE),
                    'Scan files outside every project for committed secrets',
                  ),
                },
              },
            },
          };
        }
        const ownConfig = `${root}/${CONFIG_FILE}`;
        const config = existsSync(join(context.workspaceRoot, ownConfig))
          ? ownConfig
          : CONFIG_FILE;
        return {
          projects: {
            [root]: {
              targets: {
                [targetName]: buildTarget(
                  [`${root}/**/*`],
                  config,
                  dependenciesFor(config),
                  'Scan project files for committed secrets',
                ),
              },
            },
          },
        };
      },
      configFiles,
      options,
      context,
    );
  },
];
