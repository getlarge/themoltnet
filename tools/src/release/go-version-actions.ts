import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import { type ProjectGraph, type Tree, visitNotIgnoredFiles } from '@nx/devkit';
import { VersionActions } from 'nx/release';

type TreeLike = Pick<Tree, 'read' | 'write'>;
type VisitTree = Pick<Tree, 'children' | 'exists' | 'isFile' | 'read' | 'root'>;
type CurrentVersionResolverMetadata =
  | {
      registry?: unknown;
    }
  | undefined;
type AfterVersionOptions = {
  dryRun?: boolean;
  verbose?: boolean;
};
type GoAfterVersionOptions = {
  goReleaseValidationGroups?: unknown;
  goReleaseValidationProjects?: unknown;
  goReleaseValidationRoots?: unknown;
  goReleaseGoproxy?: unknown;
  selectedReleaseGroups?: unknown;
  selectedProjects?: unknown;
  skipGoReleaseValidation?: unknown;
};
type FetchLike = typeof fetch;
type GoProxyLookupOptions = {
  fetchImpl?: FetchLike;
  retryDelaysMs?: number[];
};
type GoWorkspaceModule = {
  modulePath: string;
  root: string;
};
type GoLocalReplace = {
  modulePath: string;
  replacementPath: string;
};

export function readText(tree: Pick<Tree, 'read'>, path: string) {
  return tree.read(path, 'utf-8') ?? null;
}

export function readGoModulePath(
  tree: Pick<Tree, 'read'>,
  projectRoot: string,
) {
  const goModPath = join(projectRoot, 'go.mod');
  const goMod = readText(tree, goModPath);
  const match = goMod?.match(/^module\s+(\S+)/m);
  if (!match) {
    throw new Error(`Unable to read Go module path from ${goModPath}`);
  }
  return match[1];
}

async function readGoModulePathFromFile(goModPath: string) {
  const goMod = await readFile(goModPath, 'utf-8');
  const match = goMod.match(/^module\s+(\S+)/m);
  return match?.[1] ?? null;
}

function parseRequireLine(line: string) {
  const match = line.match(/^(\s*)(\S+)(\s+)(v\S+)(.*)$/);
  if (!match) {
    return null;
  }
  return {
    indent: match[1],
    modulePath: match[2],
    separator: match[3],
    version: match[4],
    suffix: match[5],
  };
}

export function findGoRequireVersion(goMod: string, modulePath: string) {
  let inRequireBlock = false;

  for (const line of goMod.split('\n')) {
    if (/^\s*require\s*\(\s*$/.test(line)) {
      inRequireBlock = true;
      continue;
    }
    if (inRequireBlock && /^\s*\)\s*$/.test(line)) {
      inRequireBlock = false;
      continue;
    }

    if (inRequireBlock) {
      const parsed = parseRequireLine(line);
      if (parsed?.modulePath === modulePath) {
        return parsed.version;
      }
      continue;
    }

    const singleRequireMatch = line.match(
      /^(\s*)require\s+(\S+)(\s+)(v\S+)(.*)$/,
    );
    if (singleRequireMatch?.[2] === modulePath) {
      return singleRequireMatch[4];
    }
  }

  return null;
}

export function updateGoRequireVersions(
  goMod: string,
  dependenciesToUpdate: Record<string, string>,
) {
  const updatedModules: string[] = [];
  let inRequireBlock = false;

  const lines = goMod.split('\n').map((line) => {
    if (/^\s*require\s*\(\s*$/.test(line)) {
      inRequireBlock = true;
      return line;
    }
    if (inRequireBlock && /^\s*\)\s*$/.test(line)) {
      inRequireBlock = false;
      return line;
    }

    if (inRequireBlock) {
      const parsed = parseRequireLine(line);
      if (!parsed) {
        return line;
      }
      const version = dependenciesToUpdate[parsed.modulePath];
      if (!version) {
        return line;
      }
      const nextVersion = version.startsWith('v') ? version : `v${version}`;
      updatedModules.push(`${parsed.modulePath}@${nextVersion}`);
      return `${parsed.indent}${parsed.modulePath}${parsed.separator}${nextVersion}${parsed.suffix}`;
    }

    const singleRequireMatch = line.match(
      /^(\s*)require\s+(\S+)(\s+)(v\S+)(.*)$/,
    );
    if (!singleRequireMatch) {
      return line;
    }

    const version = dependenciesToUpdate[singleRequireMatch[2]];
    if (!version) {
      return line;
    }
    const nextVersion = version.startsWith('v') ? version : `v${version}`;
    updatedModules.push(`${singleRequireMatch[2]}@${nextVersion}`);
    return `${singleRequireMatch[1]}require ${singleRequireMatch[2]}${singleRequireMatch[3]}${nextVersion}${singleRequireMatch[5]}`;
  });

  return {
    goMod: lines.join('\n'),
    updatedModules,
  };
}

export function escapeGoProxyPath(modulePath: string) {
  return modulePath.replace(/[A-Z]/g, (match) => `!${match.toLowerCase()}`);
}

export function normalizeGoModuleVersion(version: string) {
  return version.startsWith('v') ? version.slice(1) : version;
}

function sleep(ms: number) {
  return ms > 0
    ? new Promise((resolve) => {
        setTimeout(resolve, ms);
      })
    : null;
}

export function resolveGoProxyUrl(metadata: CurrentVersionResolverMetadata) {
  const configuredRegistry =
    typeof metadata?.registry === 'string' ? metadata.registry : null;
  const goProxy = configuredRegistry ?? process.env.GOPROXY;
  if (!goProxy) {
    return 'https://proxy.golang.org';
  }

  for (const candidate of goProxy.split(/[,|]/)) {
    const proxy = candidate.trim();
    if (!proxy || proxy === 'direct' || proxy === 'off') {
      continue;
    }
    return proxy.replace(/\/+$/, '');
  }

  return null;
}

export function resolveGoReleaseValidationRoots(
  _cwd: string,
  options: GoAfterVersionOptions = {},
) {
  if (Array.isArray(options.goReleaseValidationRoots)) {
    return options.goReleaseValidationRoots.filter(
      (root): root is string => typeof root === 'string' && root.length > 0,
    );
  }

  return [];
}

function unquoteGoPath(value: string) {
  return value.replace(/^"|"$/g, '');
}

export function parseGoWorkUseDirs(goWork: string) {
  const dirs: string[] = [];
  let inUseBlock = false;

  for (const rawLine of goWork.split('\n')) {
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    if (!line) {
      continue;
    }

    if (line === 'use (') {
      inUseBlock = true;
      continue;
    }
    if (inUseBlock && line === ')') {
      inUseBlock = false;
      continue;
    }
    if (inUseBlock) {
      dirs.push(unquoteGoPath(line));
      continue;
    }

    const singleUse = line.match(/^use\s+(.+)$/);
    if (singleUse) {
      dirs.push(unquoteGoPath(singleUse[1].trim()));
    }
  }

  return dirs;
}

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function createFileSystemVisitTree(root: string): VisitTree {
  const read = ((path: string, encoding?: BufferEncoding) => {
    const file = resolve(root, path);
    if (!existsSync(file)) {
      return null;
    }
    const content = readFileSync(file);
    return encoding ? content.toString(encoding) : content;
  }) as VisitTree['read'];

  return {
    root,
    children(path) {
      const dir = resolve(root, path);
      return existsSync(dir) ? readdirSync(dir) : [];
    },
    exists(path) {
      return existsSync(resolve(root, path));
    },
    isFile(path) {
      return statSync(resolve(root, path)).isFile();
    },
    read,
  };
}

function discoverGoModDirs(cwd: string, tree?: VisitTree) {
  const dirs = new Set<string>();
  const visitTree = tree ?? createFileSystemVisitTree(cwd);

  visitNotIgnoredFiles(visitTree as Tree, '.', (path) => {
    if (path.split(/[\\/]/).at(-1) === 'go.mod') {
      dirs.add(resolve(visitTree.root, dirname(path)));
    }
  });

  return Array.from(dirs).sort((a, b) =>
    relative(cwd, a).localeCompare(relative(cwd, b)),
  );
}

export async function discoverGoWorkspaceModules(
  cwd: string,
  tree?: VisitTree,
): Promise<GoWorkspaceModule[]> {
  const goWorkPath = join(cwd, 'go.work');
  const dirs = (await pathExists(goWorkPath))
    ? parseGoWorkUseDirs(await readFile(goWorkPath, 'utf-8')).map((dir) =>
        resolve(cwd, dir),
      )
    : discoverGoModDirs(cwd, tree);

  const modules = await Promise.all(
    dirs.map(async (root) => {
      const modulePath = await readGoModulePathFromFile(join(root, 'go.mod'));
      return { modulePath, root };
    }),
  );

  return modules.flatMap(({ modulePath, root }) => {
    return modulePath ? [{ modulePath, root }] : [];
  });
}

function hasReplaceDirective(goMod: string, modulePath: string) {
  let inReplaceBlock = false;
  const replacePattern = new RegExp(
    `^${modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s+v\\S+)?\\s+=>`,
  );

  for (const line of goMod.split('\n')) {
    const trimmed = line.trim();

    if (/^replace\s*\(\s*$/.test(trimmed)) {
      inReplaceBlock = true;
      continue;
    }
    if (inReplaceBlock && trimmed === ')') {
      inReplaceBlock = false;
      continue;
    }

    if (inReplaceBlock) {
      if (replacePattern.test(trimmed)) {
        return true;
      }
      continue;
    }

    if (
      trimmed.startsWith('replace ') &&
      replacePattern.test(trimmed.slice(8))
    ) {
      return true;
    }
  }

  return false;
}

export async function createGoReleaseValidationLocalReplaces(
  cwd: string,
  root: string,
) {
  const rootDir = resolve(cwd, root);
  const goModPath = join(rootDir, 'go.mod');
  const goMod = await readFile(goModPath, 'utf-8');
  const localReplaces: GoLocalReplace[] = [];

  for (const module of await discoverGoWorkspaceModules(cwd)) {
    if (
      module.root === rootDir ||
      !goMod.includes(module.modulePath) ||
      hasReplaceDirective(goMod, module.modulePath)
    ) {
      continue;
    }

    const replacementPath = relative(rootDir, module.root);
    localReplaces.push({
      modulePath: module.modulePath,
      replacementPath: replacementPath.startsWith('.')
        ? replacementPath
        : `./${replacementPath}`,
    });
  }

  return localReplaces;
}

function parseOptionList(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string => typeof item === 'string' && item.length > 0,
    );
  }
  if (typeof value !== 'string') {
    return [];
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readCliOptionList(argv: string[], optionNames: string[]) {
  const values: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    for (const optionName of optionNames) {
      if (arg === optionName) {
        values.push(...parseOptionList(argv[index + 1]));
        continue;
      }
      if (arg.startsWith(`${optionName}=`)) {
        values.push(...parseOptionList(arg.slice(optionName.length + 1)));
      }
    }
  }

  return values;
}

export function shouldRunGoReleaseValidation(
  options: GoAfterVersionOptions = {},
  argv = process.argv,
) {
  if (options.skipGoReleaseValidation === true) {
    return false;
  }

  if (resolveGoReleaseValidationRoots('', options).length === 0) {
    return false;
  }

  const selectedGroups = [
    ...parseOptionList(options.selectedReleaseGroups),
    ...readCliOptionList(argv, ['--groups', '-g']),
  ];
  const selectedProjects = [
    ...parseOptionList(options.selectedProjects),
    ...readCliOptionList(argv, ['--projects', '-p']),
  ];

  const goGroups = parseOptionList(options.goReleaseValidationGroups);

  const goProjects = parseOptionList(options.goReleaseValidationProjects);

  if (selectedGroups.length > 0 && goGroups.length > 0) {
    return selectedGroups.some((group) => goGroups.includes(group));
  }

  if (selectedProjects.length > 0 && goProjects.length > 0) {
    return selectedProjects.some((project) => goProjects.includes(project));
  }

  return true;
}

export function createGoReleaseValidationCommands(
  cwd: string,
  options: GoAfterVersionOptions = {},
  argv = process.argv,
) {
  if (!shouldRunGoReleaseValidation(options, argv)) {
    return [];
  }

  const goProxy =
    typeof options.goReleaseGoproxy === 'string'
      ? options.goReleaseGoproxy
      : null;

  return resolveGoReleaseValidationRoots(cwd, options).flatMap((root) => [
    {
      root,
      command: 'go',
      args: ['mod', 'tidy'],
      env: {
        GOWORK: 'off',
        ...(goProxy ? { GOPROXY: goProxy } : {}),
      },
      changedFiles: [join(root, 'go.mod'), join(root, 'go.sum')],
    },
    {
      root,
      command: 'go',
      args: ['build', './...'],
      env: {
        GOWORK: 'off',
        ...(goProxy ? { GOPROXY: goProxy } : {}),
      },
      changedFiles: [],
    },
  ]);
}

function shouldRetryGoProxyResponse(status: number) {
  return status === 429 || status >= 500;
}

async function waitForGoProxyRetry(delays: number[], attempt: number) {
  const delay = delays[attempt];
  if (delay === undefined) {
    return;
  }
  await sleep(delay);
}

function createGoProxyLookupError(
  modulePath: string,
  response: Pick<Response, 'status' | 'statusText'>,
) {
  return new Error(
    `Go proxy lookup failed for ${modulePath}: ${response.status} ${response.statusText}`,
  );
}

export async function readLatestVersionFromGoProxy(
  modulePath: string,
  proxyUrl: string,
  options: GoProxyLookupOptions = {},
) {
  const url = `${proxyUrl}/${escapeGoProxyPath(modulePath)}/@latest`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const retryDelaysMs = options.retryDelaysMs ?? [250, 1_000];
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(url);
    } catch (error) {
      lastError = error;
      await waitForGoProxyRetry(retryDelaysMs, attempt);
      continue;
    }

    if (response.status === 404 || response.status === 410) {
      return null;
    }
    if (!response.ok) {
      const error = createGoProxyLookupError(modulePath, response);
      if (!shouldRetryGoProxyResponse(response.status)) {
        throw error;
      }
      lastError = error;
      await waitForGoProxyRetry(retryDelaysMs, attempt);
      continue;
    }

    const payload = (await response.json()) as { Version?: string };
    return payload.Version ? normalizeGoModuleVersion(payload.Version) : null;
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error(`Go proxy lookup failed for ${modulePath}: no response`);
}

export async function afterAllProjectsVersioned(
  cwd: string,
  {
    dryRun,
    verbose,
    rootVersionActionsOptions,
  }: AfterVersionOptions & {
    rootVersionActionsOptions?: GoAfterVersionOptions;
  },
) {
  if (!shouldRunGoReleaseValidation(rootVersionActionsOptions)) {
    if (verbose) {
      console.log(
        '\nSkipped Go release validation for this release selection.',
      );
    }
    return { changedFiles: [], deletedFiles: [] };
  }

  const commands = createGoReleaseValidationCommands(
    cwd,
    rootVersionActionsOptions,
  );

  if (commands.length === 0) {
    if (verbose) {
      console.log(
        '\nSkipped Go release validation; no configured roots found.',
      );
    }
    return { changedFiles: [], deletedFiles: [] };
  }

  const changedFiles = new Set<string>();
  const commandsByRoot = new Map<string, typeof commands>();
  for (const command of commands) {
    const rootCommands = commandsByRoot.get(command.root) ?? [];
    rootCommands.push(command);
    commandsByRoot.set(command.root, rootCommands);
  }

  for (const [root, rootCommands] of commandsByRoot) {
    const rootDir = join(cwd, root);
    const localReplaces = dryRun
      ? []
      : await createGoReleaseValidationLocalReplaces(cwd, root);

    try {
      for (const localReplace of localReplaces) {
        if (verbose) {
          console.log(
            `Temporarily replacing ${localReplace.modulePath} => ${localReplace.replacementPath} for Go release validation in ${root}`,
          );
        }
        execFileSync(
          'go',
          [
            'mod',
            'edit',
            `-replace=${localReplace.modulePath}=${localReplace.replacementPath}`,
          ],
          {
            cwd: rootDir,
            stdio: verbose ? 'inherit' : 'ignore',
            windowsHide: true,
          },
        );
      }

      for (const command of rootCommands) {
        const displayCommand = `${Object.entries(command.env)
          .map(([key, value]) => `${key}=${value}`)
          .join(' ')} ${command.command} ${command.args.join(' ')}`;

        if (dryRun) {
          if (verbose) {
            console.log(
              `Would run Go release validation in ${command.root}, but --dry-run was set:`,
            );
            console.log(displayCommand);
          }
          continue;
        }

        if (verbose) {
          console.log(`Running Go release validation in ${command.root}:`);
          console.log(displayCommand);
        }

        execFileSync(command.command, command.args, {
          cwd: rootDir,
          env: {
            ...process.env,
            ...command.env,
          },
          stdio: 'inherit',
          windowsHide: true,
        });

        for (const file of command.changedFiles) {
          changedFiles.add(file);
        }
      }
    } finally {
      for (const localReplace of localReplaces) {
        execFileSync(
          'go',
          ['mod', 'edit', `-dropreplace=${localReplace.modulePath}`],
          {
            cwd: rootDir,
            stdio: verbose ? 'inherit' : 'ignore',
            windowsHide: true,
          },
        );
      }
    }
  }

  return {
    changedFiles: Array.from(changedFiles),
    deletedFiles: [],
  };
}

export default class GoVersionActions extends VersionActions {
  validManifestFilenames = ['go.mod'];

  // Go module versions are resolved from VCS tags by Nx. go.mod has the module
  // path and dependency requirements, but no source-of-truth project version.
  async readCurrentVersionFromSourceManifest() {
    return null;
  }

  async readCurrentVersionFromRegistry(
    tree: Tree,
    currentVersionResolverMetadata: CurrentVersionResolverMetadata,
  ) {
    const modulePath = readGoModulePath(tree, this.projectGraphNode.data.root);
    const proxyUrl = resolveGoProxyUrl(currentVersionResolverMetadata);
    if (!proxyUrl) {
      return {
        currentVersion: null,
        logText:
          'GOPROXY resolves to direct/off only; use git-tag resolution for private direct modules',
      };
    }

    return {
      currentVersion: await readLatestVersionFromGoProxy(modulePath, proxyUrl),
      logText: `from Go proxy ${proxyUrl}`,
    };
  }

  async readCurrentVersionOfDependency(
    tree: Tree,
    projectGraph: ProjectGraph,
    dependencyProjectName: string,
  ) {
    const goModPath = join(this.projectGraphNode.data.root, 'go.mod');
    const goMod = readText(tree, goModPath);
    if (!goMod) {
      return { currentVersion: null, dependencyCollection: null };
    }

    const dependencyRoot = projectGraph.nodes[dependencyProjectName]?.data.root;
    if (!dependencyRoot) {
      return { currentVersion: null, dependencyCollection: null };
    }

    const modulePath = readGoModulePath(tree, dependencyRoot);
    const currentVersion = findGoRequireVersion(goMod, modulePath);

    return {
      currentVersion,
      dependencyCollection: currentVersion ? 'require' : null,
    };
  }

  async updateProjectVersion() {
    return [
      `Go module ${this.projectGraphNode.name} is versioned by git tags; go.mod has no project version field.`,
    ];
  }

  async updateProjectDependencies(
    tree: TreeLike,
    projectGraph: ProjectGraph,
    dependenciesToUpdate: Record<string, string>,
  ) {
    const entries = Object.entries(dependenciesToUpdate);
    if (entries.length === 0) {
      return [];
    }

    const goModPath = join(this.projectGraphNode.data.root, 'go.mod');
    const goMod = readText(tree, goModPath);
    if (!goMod) {
      return [];
    }

    const moduleVersions: Record<string, string> = {};
    for (const [dependencyProjectName, rawVersion] of entries) {
      const dependencyRoot =
        projectGraph.nodes[dependencyProjectName]?.data.root;
      if (!dependencyRoot) {
        continue;
      }
      moduleVersions[readGoModulePath(tree, dependencyRoot)] = rawVersion;
    }

    const result = updateGoRequireVersions(goMod, moduleVersions);
    if (result.updatedModules.length === 0) {
      return [];
    }

    tree.write(goModPath, result.goMod);
    return [`Updated ${result.updatedModules.join(', ')} in ${goModPath}`];
  }
}
