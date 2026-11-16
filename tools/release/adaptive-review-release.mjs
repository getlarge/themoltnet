import { deepStrictEqual } from 'node:assert';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { actionEntries, github } from './action-release-state.mjs';

const assets = [
  'install.sh',
  'moltnet-agent-linux-x64.tar.gz',
  'moltnet-agent-linux-x64.tar.gz.sha256',
  'moltnet-agent-linux-x64.tar.gz.sha256.sig',
];

/** Gate a new review bundle on its exact source dependency, never on latest. */
function readReviewDependencies(root = '.') {
  const read = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
  const review = read('packages/adaptive-review-action/package.json');
  if (
    !actionEntries('adaptive-review-action', review).includes(
      'worker-action/main.js',
    )
  ) {
    // Historical bundles used independently pinned worker actions. Retrying one
    // must not silently upgrade its dependency contract or rewrite its tag.
    return undefined;
  }
  const daemon = read('apps/agent-daemon/package.json');
  const worker = read('packages/agent-daemon-action/package.json');
  if (
    daemon.name !== '@themoltnet/agent-daemon' ||
    worker.name !== '@themoltnet/agent-daemon-action' ||
    !/^\d+\.\d+\.\d+$/.test(daemon.version) ||
    !/^\d+\.\d+\.\d+$/.test(worker.version)
  )
    throw new Error('Invalid review release dependencies');
  return {
    schemaVersion: 1,
    daemonVersion: daemon.version,
    workerActionVersion: worker.version,
  };
}

export function verifyReviewBundle(root = '.') {
  const expected = readReviewDependencies(root);
  if (expected)
    deepStrictEqual(
      JSON.parse(
        readFileSync(
          join(
            root,
            'packages/adaptive-review-action/dist/release-dependencies.json',
          ),
          'utf8',
        ),
      ),
      expected,
      'Built review dependencies must match the exact source release',
    );
}

export async function verifyReviewDependencies({
  root = '.',
  api = github(),
} = {}) {
  const dependencies = readReviewDependencies(root);
  if (!dependencies) return undefined;
  const tag = `agent-daemon-v${dependencies.daemonVersion}`;
  const release = await api(`releases/tags/${tag}`, { optional: true });
  if (
    !release ||
    release.draft ||
    release.prerelease ||
    release.tag_name !== tag
  ) {
    throw new Error(
      `Review publication awaits published ${tag}; retry after daemon publication succeeds`,
    );
  }
  const missing = assets.filter(
    (name) =>
      !release.assets?.some(
        (asset) =>
          asset.name === name && asset.size > 0 && asset.state === 'uploaded',
      ),
  );
  if (missing.length)
    throw new Error(
      `${tag} lacks complete signed runner assets: ${missing.join(', ')}`,
    );
  return dependencies;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.includes('--check-bundle')) {
    verifyReviewBundle();
    process.exit(0);
  }
  const dependencies = await verifyReviewDependencies();
  if (dependencies) {
    console.log(JSON.stringify(dependencies));
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `daemon-version=${dependencies.daemonVersion}\nworker-action-version=${dependencies.workerActionVersion}\n`,
      );
  }
}
