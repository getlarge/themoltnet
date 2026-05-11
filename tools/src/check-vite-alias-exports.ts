/* eslint-disable no-console */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

type WorkspacePackage = {
  name: string;
  exportSubpaths: string[];
};

const workspaceRoot = process.cwd();
const packageRoots = ['apps', 'docs', 'libs', 'packages', 'tools'];
const ignoredDirs = new Set([
  '.agents',
  '.git',
  '.nx',
  '.turbo',
  '.worktrees',
  'coverage',
  'dist',
  'node_modules',
  'out-tsc',
]);

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function listWorkspacePackages(): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];

  for (const root of packageRoots) {
    const absoluteRoot = join(workspaceRoot, root);

    try {
      for (const entry of readdirSync(absoluteRoot)) {
        const packageJsonPath = join(absoluteRoot, entry, 'package.json');

        try {
          const packageJson = readJson(packageJsonPath) as {
            name?: unknown;
            exports?: unknown;
          };

          if (typeof packageJson.name !== 'string') {
            continue;
          }

          packages.push({
            name: packageJson.name,
            exportSubpaths: getExportSubpaths(packageJson.exports),
          });
        } catch {
          // Not every directory under a workspace root is a package.
        }
      }
    } catch {
      // Workspace root does not exist in every checkout.
    }
  }

  return packages;
}

function getExportSubpaths(exportsField: unknown): string[] {
  if (!exportsField || typeof exportsField !== 'object') {
    return [];
  }

  return Object.keys(exportsField)
    .filter((key) => key !== '.' && key.startsWith('./'))
    .map((key) => key.slice(2))
    .sort();
}

function listViteConfigs(dir: string): string[] {
  const configs: string[] = [];

  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) {
      continue;
    }

    const path = join(dir, entry);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      configs.push(...listViteConfigs(path));
      continue;
    }

    if (entry === 'vite.config.ts' || entry === 'vitest.config.ts') {
      configs.push(path);
    }
  }

  return configs;
}

function extractAliasBlocks(source: string): string[] {
  const blocks: string[] = [];
  const aliasStart = /alias\s*:\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = aliasStart.exec(source))) {
    const blockStart = match.index + match[0].length;
    let depth = 1;
    let index = blockStart;

    while (index < source.length && depth > 0) {
      const char = source[index];
      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
      }
      index += 1;
    }

    blocks.push(source.slice(blockStart, index - 1));
  }

  return blocks;
}

function hasAlias(aliasBlocks: string[], specifier: string): boolean {
  const quotedSpecifier = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const aliasPattern = new RegExp(String.raw`['"]${quotedSpecifier}['"]\s*:`);

  return aliasBlocks.some((block) => aliasPattern.test(block));
}

const packages = listWorkspacePackages().filter(
  (pkg) => pkg.exportSubpaths.length > 0,
);
const configs = listViteConfigs(workspaceRoot);
const failures: string[] = [];

for (const config of configs) {
  const source = readFileSync(config, 'utf8');
  const aliasBlocks = extractAliasBlocks(source);

  if (aliasBlocks.length === 0) {
    continue;
  }

  for (const pkg of packages) {
    if (!hasAlias(aliasBlocks, pkg.name)) {
      continue;
    }

    for (const subpath of pkg.exportSubpaths) {
      const subpathAlias = `${pkg.name}/${subpath}`;

      if (!hasAlias(aliasBlocks, subpathAlias)) {
        failures.push(
          `${relative(workspaceRoot, config)} aliases ${pkg.name} but misses ${subpathAlias}`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Vite/Vitest package aliases are missing exported subpaths:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error(
    'Add explicit aliases for exported subpaths when aliasing a package root.',
  );
  process.exit(1);
}

console.log('Vite/Vitest package aliases cover exported subpaths.');
