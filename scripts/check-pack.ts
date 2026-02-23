#!/usr/bin/env tsx
/**
 * Verify publishable packages produce valid tarballs.
 *
 * For each non-private workspace that has a "files" field, runs
 * `npm pack --dry-run --json` and checks that:
 *   1. dist/index.js is included
 *   2. dist/index.d.ts is included
 *   3. no source files (src/) leak into the tarball
 *
 * Usage:
 *   tsx scripts/check-pack.ts                       # scan libs/ and packages/
 *   tsx scripts/check-pack.ts --package ./libs/sdk   # check a single package
 */

import { execSync } from 'node:child_process';
import type { Dirent } from 'node:fs';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

const { values } = parseArgs({
  options: {
    package: { type: 'string', short: 'p' },
  },
  strict: true,
});

interface PackEntry {
  path: string;
  size: number;
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

  const pkgName = pkg.name as string;
  console.log(`\nChecking ${pkgName}...`);

  let packEntries: PackEntry[];
  try {
    const output = execSync('npm pack --dry-run --json 2>/dev/null', {
      cwd: pkgDir,
      encoding: 'utf-8',
    });
    const parsed = JSON.parse(output) as { files: PackEntry[] }[];
    packEntries = parsed[0]?.files ?? [];
  } catch (err) {
    console.error(`  FAIL: npm pack failed — ${(err as Error).message}`);
    return false;
  }

  const paths = packEntries.map((e) => e.path);

  if (!paths.includes('dist/index.js')) {
    console.error('  FAIL: dist/index.js missing from tarball');
    return false;
  }

  if (!paths.includes('dist/index.d.ts')) {
    console.error('  FAIL: dist/index.d.ts missing from tarball');
    return false;
  }

  const leaked = paths.filter((p) => p.startsWith('src/'));
  if (leaked.length > 0) {
    console.error(
      `  FAIL: source files leaked into tarball: ${leaked.join(', ')}`,
    );
    return false;
  }

  // Check for workspace package references in .d.ts files.
  // @moltnet/* packages are private workspace packages not published to npm;
  // any reference in a published .d.ts file will cause TS errors for consumers.
  const dtsFiles = paths.filter((p) => p.endsWith('.d.ts'));
  if (dtsFiles.length > 0) {
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
      const leakLines = content
        .split('\n')
        .filter((l) => l.includes('@moltnet/'));
      if (leakLines.length > 0) {
        dtsLeaks.push(`  ${dtsPath}: ${leakLines.length} workspace import(s)`);
      }
    }
    if (dtsLeaks.length > 0) {
      console.error(
        `  FAIL: @moltnet/ workspace imports found in .d.ts files:\n${dtsLeaks.join('\n')}`,
      );
      return false;
    }
  }

  console.log(`  OK (${paths.length} files)`);
  return true;
}

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
