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
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const libsDir = join(root, 'libs');

interface PackEntry {
  path: string;
  size: number;
}

let failures = 0;
let checked = 0;

for (const name of readdirSync(libsDir, { withFileTypes: true })) {
  if (!name.isDirectory()) continue;
  const pkgPath = join(libsDir, name.name, 'package.json');
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  } catch {
    continue;
  }

  // Only check publishable packages (have "files" field, not private)
  if (pkg.private || !Array.isArray(pkg.files)) continue;

  const pkgName = pkg.name as string;
  const pkgDir = join(libsDir, name.name);

  console.log(`\nChecking ${pkgName}...`);
  checked++;

  let entries: PackEntry[];
  try {
    const output = execSync('npm pack --dry-run --json 2>/dev/null', {
      cwd: pkgDir,
      encoding: 'utf-8',
    });
    const parsed = JSON.parse(output) as { files: PackEntry[] }[];
    entries = parsed[0]?.files ?? [];
  } catch (err) {
    console.error(`  FAIL: npm pack failed — ${(err as Error).message}`);
    failures++;
    continue;
  }

  const paths = entries.map((e) => e.path);

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

if (checked === 0) {
  console.log('\nNo publishable packages found.');
  process.exit(0);
}

console.log(`\n${checked} package(s) checked, ${failures} failure(s).`);
process.exit(failures > 0 ? 1 : 0);
