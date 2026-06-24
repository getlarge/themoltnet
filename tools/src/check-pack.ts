#!/usr/bin/env tsx
/**
 * Verify publishable packages produce valid tarballs.
 *
 * For each non-private workspace that has a "files" field, runs
 * `npm pack --dry-run --json` and checks that:
 *   1. dist/index.js is included
 *   2. dist/index.d.ts is included
 *   3. no source files (src/) leak into the tarball
 *   4. no @moltnet/* workspace packages in published dependencies
 *
 * The individual checks are exported as pure functions (each returns an array
 * of error strings, empty = pass) so project-specific scripts can compose them
 * with their own assertions — e.g. the Node-RED package replaces the
 * `dist/index` entry check with a `node-red.nodes`-path check.
 *
 * Usage:
 *   tsx tools/src/check-pack.ts                       # scan libs/ and packages/
 *   tsx tools/src/check-pack.ts --package ./libs/sdk   # check a single package
 */

import { execSync } from 'node:child_process';
import type { Dirent } from 'node:fs';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');

interface PackEntry {
  path: string;
  size: number;
}

/**
 * Run `npm pack --dry-run --json` in `pkgDir` and return the tarball entry
 * paths. Throws if npm pack fails.
 */
export function getTarballEntries(pkgDir: string): string[] {
  const output = execSync('npm pack --dry-run --json 2>/dev/null', {
    cwd: pkgDir,
    encoding: 'utf-8',
  });
  const parsed = JSON.parse(output) as { files: PackEntry[] }[];
  return (parsed[0]?.files ?? []).map((e) => e.path);
}

/**
 * Assert `dist/index.js` + `dist/index.d.ts` ship, plus every subpath export
 * declared in publishConfig.exports/exports that targets `./dist/`. Returns an
 * array of error strings (empty = pass).
 */
export function checkDistIndexEntry(
  pkg: Record<string, unknown>,
  paths: string[],
): string[] {
  const errors: string[] = [];

  // Binary-only packages (bin field, no src/) don't produce dist/ — skip.
  const isBinaryOnly =
    typeof pkg.bin !== 'undefined' && !paths.some((p) => p.startsWith('src/'));
  if (isBinaryOnly) return errors;

  if (!paths.includes('dist/index.js')) {
    errors.push('dist/index.js missing from tarball');
  }
  if (!paths.includes('dist/index.d.ts')) {
    errors.push('dist/index.d.ts missing from tarball');
  }

  // Validate all subpath exports declared in publishConfig.exports (or exports).
  // publishConfig.exports is what pnpm writes into the published package.json,
  // so those are the paths npm consumers will actually resolve.
  const publishExports =
    (pkg.publishConfig as Record<string, unknown> | undefined)?.exports ??
    pkg.exports;
  if (publishExports && typeof publishExports === 'object') {
    for (const [subpath, conditions] of Object.entries(
      publishExports as Record<string, Record<string, string>>,
    )) {
      if (subpath === '.') continue; // already checked above
      if (!conditions || typeof conditions !== 'object') continue;
      for (const [condition, target] of Object.entries(conditions)) {
        if (typeof target !== 'string' || !target.startsWith('./dist/'))
          continue;
        const stripped = target.replace(/^\.\//, '');
        if (!paths.includes(stripped)) {
          errors.push(
            `export "${subpath}" (${condition}) points to ${target} but ${stripped} is missing from tarball`,
          );
        }
      }
    }
  }
  return errors;
}

/** Assert no `src/` files leaked into the tarball. */
export function checkNoSrcLeak(paths: string[]): string[] {
  const leaked = paths.filter((p) => p.startsWith('src/'));
  return leaked.length > 0
    ? [`source files leaked into tarball: ${leaked.join(', ')}`]
    : [];
}

/**
 * Assert no published `.d.ts` file imports a private `@moltnet/*` workspace
 * package. Such packages are not published, so any reference breaks consumers'
 * type-checking. Only real module specifiers count — substring matches inside
 * JSDoc/comments are stripped first (dts bundlers preserve comments verbatim).
 */
export function checkNoWorkspaceDtsLeak(
  pkgDir: string,
  paths: string[],
): string[] {
  const dtsFiles = paths.filter((p) => p.endsWith('.d.ts'));
  if (dtsFiles.length === 0) return [];

  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const importRe =
    /(?:from|import|require)\s*\(?\s*['"]@moltnet\/[^'"]+['"]|<reference\s+types=['"]@moltnet\/[^'"]+['"]/g;

  const dtsLeaks: string[] = [];
  for (const dtsPath of dtsFiles) {
    const fullPath = join(pkgDir, dtsPath);
    let content: string;
    try {
      content = readFileSync(fullPath, 'utf-8');
    } catch {
      // file listed in tarball manifest but not on disk — skip
      continue;
    }
    const matches = stripComments(content).match(importRe);
    if (matches && matches.length > 0) {
      dtsLeaks.push(
        `  ${dtsPath}: ${matches.length} workspace import(s) — e.g. ${matches[0]}`,
      );
    }
  }
  return dtsLeaks.length > 0
    ? [
        `@moltnet/ workspace imports found in .d.ts files:\n${dtsLeaks.join('\n')}`,
      ]
    : [];
}

/** Assert no private `@moltnet/*` workspace package is in `dependencies`. */
export function checkNoPrivateWorkspaceDeps(
  pkg: Record<string, unknown>,
): string[] {
  const deps = (pkg.dependencies ?? {}) as Record<string, string>;
  const privateWorkspaceDeps = Object.keys(deps).filter((d) =>
    d.startsWith('@moltnet/'),
  );
  return privateWorkspaceDeps.length > 0
    ? [
        `private workspace packages in dependencies (move to devDependencies if bundled): ${privateWorkspaceDeps.join(', ')}`,
      ]
    : [];
}

function checkPackage(pkgDir: string): boolean {
  const pkgPath = join(pkgDir, 'package.json');
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  } catch {
    console.error(`  FAIL: could not read ${pkgPath}`);
    return false;
  }

  if (pkg.private || !Array.isArray(pkg.files)) {
    console.log(`  Skipped (private or no files field)`);
    return true;
  }

  // Node-RED packages own a project-level check:pack (their entry is not
  // dist/index.js but a set of dist/nodes/*.js declared in node-red.nodes).
  if (pkg['node-red']) {
    console.log(
      `  Skipped ${pkg.name as string} (node-red package — own check:pack)`,
    );
    return true;
  }

  const pkgName = pkg.name as string;
  console.log(`\nChecking ${pkgName}...`);

  let paths: string[];
  try {
    paths = getTarballEntries(pkgDir);
  } catch (err) {
    console.error(`  FAIL: npm pack failed — ${(err as Error).message}`);
    return false;
  }

  const errors = [
    ...checkDistIndexEntry(pkg, paths),
    ...checkNoSrcLeak(paths),
    ...checkNoWorkspaceDtsLeak(pkgDir, paths),
    ...checkNoPrivateWorkspaceDeps(pkg),
  ];

  if (errors.length > 0) {
    for (const e of errors) console.error(`  FAIL: ${e}`);
    return false;
  }

  console.log(`  OK (${paths.length} files)`);
  return true;
}

// Only run the CLI when invoked directly (not when imported by a project script).
const invokedDirectly =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  const { values } = parseArgs({
    options: {
      package: { type: 'string', short: 'p' },
    },
    strict: true,
  });

  if (values.package) {
    const pkgDir = resolve(values.package);
    const ok = checkPackage(pkgDir);
    process.exit(ok ? 0 : 1);
  }

  // Default: scan libs/ and packages/
  const scanDirs = [join(root, 'libs'), join(root, 'packages')];
  let failures = 0;
  let checked = 0;

  for (const scanDir of scanDirs) {
    let dirEntries: Dirent[];
    try {
      dirEntries = readdirSync(scanDir, { withFileTypes: true }) as Dirent[];
    } catch {
      continue;
    }

    for (const dirEntry of dirEntries) {
      if (!dirEntry.isDirectory()) continue;
      const pkgDir = join(scanDir, dirEntry.name);
      const pkgPath = join(pkgDir, 'package.json');
      let pkg: Record<string, unknown>;
      try {
        pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      } catch {
        continue;
      }

      if (pkg.private || !Array.isArray(pkg.files)) continue;
      if (pkg['node-red']) {
        console.log(
          `Skipped ${pkg.name as string} (node-red package — own check:pack)`,
        );
        continue;
      }

      checked++;
      if (!checkPackage(pkgDir)) failures++;
    }
  }

  if (checked === 0) {
    console.log('\nNo publishable packages found.');
    process.exit(0);
  }

  console.log(`\n${checked} package(s) checked, ${failures} failure(s).`);
  process.exit(failures > 0 ? 1 : 0);
}
