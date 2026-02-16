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
 * Usage: tsx scripts/check-pack.ts
 */

import { execSync } from 'node:child_process';
import type { Dirent } from 'node:fs';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const scanDirs = [join(root, 'libs'), join(root, 'packages')];

interface PackEntry {
  path: string;
  size: number;
}

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
    const pkgPath = join(scanDir, dirEntry.name, 'package.json');
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    } catch {
      continue;
    }

    // Only check publishable packages (have "files" field, not private)
    if (pkg.private || !Array.isArray(pkg.files)) continue;

    const pkgName = pkg.name as string;
    const pkgDir = join(scanDir, dirEntry.name);

    console.log(`\nChecking ${pkgName}...`);
    checked++;

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
      failures++;
      continue;
    }

    const paths = packEntries.map((e) => e.path);

    // Must include dist/index.js
    if (!paths.includes('dist/index.js')) {
      console.error('  FAIL: dist/index.js missing from tarball');
      failures++;
      continue;
    }

    // Must include dist/index.d.ts
    if (!paths.includes('dist/index.d.ts')) {
      console.error('  FAIL: dist/index.d.ts missing from tarball');
      failures++;
      continue;
    }

    // No src/ files should leak
    const leaked = paths.filter((p) => p.startsWith('src/'));
    if (leaked.length > 0) {
      console.error(
        `  FAIL: source files leaked into tarball: ${leaked.join(', ')}`,
      );
      failures++;
      continue;
    }

    console.log(`  OK (${paths.length} files)`);
  }
}

if (checked === 0) {
  console.log('\nNo publishable packages found.');
  process.exit(0);
}

console.log(`\n${checked} package(s) checked, ${failures} failure(s).`);
process.exit(failures > 0 ? 1 : 0);
