#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const minimumVersions = {
  'apps/rest-api': '0.62.3',
  'apps/mcp-server': '0.25.4',
};

export function compareVersions(left, right) {
  const parse = (version) => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!match)
      throw new Error(`Expected a released semantic version: ${version}`);
    return match.slice(1).map(Number);
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return Math.sign(a[index] - b[index]);
  }
  return 0;
}

export function assertSelfHostReady(versions) {
  for (const [component, minimum] of Object.entries(minimumVersions)) {
    const actual = versions[component];
    if (!actual || compareVersions(actual, minimum) < 0) {
      throw new Error(
        `${component} must be released at ${minimum} or newer before publishing the self-host bundle (manifest: ${actual ?? 'missing'})`,
      );
    }
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const versions = JSON.parse(
    readFileSync(path.join(repoRoot, '.release-please-manifest.json'), 'utf8'),
  );
  assertSelfHostReady(versions);
  process.stdout.write('Self-host component releases are ready\n');
}
