#!/usr/bin/env tsx
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkNoSrcLeak,
  checkNoWorkspaceDtsLeak,
  getTarballEntries,
} from '../../../tools/src/check-pack.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, '..');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8')) as {
  name: string;
};

const paths = getTarballEntries(pkgDir);
const errors = [
  ...checkNoSrcLeak(paths),
  ...checkNoWorkspaceDtsLeak(pkgDir, paths),
];

for (const required of [
  'dist/index.js',
  'dist/index.d.ts',
  'dist/moltnet-node-red-theme.css',
]) {
  if (!paths.includes(required)) {
    errors.push(`${required} missing from tarball`);
  }
}

if (errors.length > 0) {
  console.error(`check:pack FAILED for ${pkg.name}:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`check:pack OK for ${pkg.name}`);
