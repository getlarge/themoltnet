#!/usr/bin/env tsx
/**
 * Project-level pack check for the Node-RED package. Reuses the generic tarball
 * checks (no src leak, no workspace .d.ts leak) but replaces the
 * `dist/index.js` entry check with a node-red-specific assertion: every path
 * declared in `node-red.nodes` (and its sibling editor `.html`) must ship in
 * the tarball.
 */
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
const pkg = JSON.parse(
  readFileSync(join(pkgDir, 'package.json'), 'utf-8'),
) as Record<string, unknown>;

/** Assert every `node-red.nodes` runtime path + its sibling .html ships. */
function checkNodeRedNodePaths(
  pkg: Record<string, unknown>,
  paths: string[],
): string[] {
  const nodes =
    (pkg['node-red'] as { nodes?: Record<string, string> } | undefined)
      ?.nodes ?? {};
  const errors: string[] = [];
  for (const [name, rel] of Object.entries(nodes)) {
    if (!paths.includes(rel)) {
      errors.push(`node "${name}" → ${rel} missing from tarball`);
    }
    const html = rel.replace(/\.js$/, '.html');
    if (!paths.includes(html)) {
      errors.push(`node "${name}" editor html ${html} missing from tarball`);
    }
  }
  return errors;
}

const paths = getTarballEntries(pkgDir);
const errors = [
  ...checkNodeRedNodePaths(pkg, paths),
  ...checkNoSrcLeak(paths),
  ...checkNoWorkspaceDtsLeak(pkgDir, paths),
];

if (errors.length > 0) {
  console.error(`check:pack FAILED for ${pkg.name as string}:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
const nodeCount = Object.keys(
  (pkg['node-red'] as { nodes?: object }).nodes ?? {},
).length;
console.log(`check:pack OK for ${pkg.name as string} (${nodeCount} nodes)`);
