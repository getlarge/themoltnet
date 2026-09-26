import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const pinFile = 'libs/sandbox-gondolin/src/snapshot.ts';
const packages = ['cli', 'cli-linux-x64', 'cli-linux-arm64'];

export function compareVersions(a, b) {
  const pattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  const left = pattern.exec(a);
  const right = pattern.exec(b);
  if (!left || !right) throw new Error(`Invalid CLI version: ${a}, ${b}`);
  for (let i = 1; i <= 3; i++) {
    const difference = BigInt(left[i]) - BigInt(right[i]);
    if (difference) return difference > 0 ? 1 : -1;
  }
  return 0;
}

export function advancePin(source, version) {
  const match = source.match(/const MOLTNET_CLI_VERSION = '([^']+)';/);
  if (!match) throw new Error('Gondolin CLI pin not found');
  if (compareVersions(version, match[1]) <= 0) return source;
  return source.replace(match[0], `const MOLTNET_CLI_VERSION = '${version}';`);
}

export async function verifyPackages(version, get = globalThis.fetch) {
  for (const name of packages) {
    const response = await get(
      `https://registry.npmjs.org/@themoltnet%2f${name}/${version}`,
    );
    if (!response.ok) {
      const error = new Error(
        `@themoltnet/${name}@${version} unavailable (${response.status})`,
      );
      error.status = response.status;
      throw error;
    }
    const metadata = await response.json();
    if (metadata.version !== version) {
      throw new Error(`@themoltnet/${name} resolved ${metadata.version}`);
    }
  }
}

export async function waitForPackages(
  version,
  get = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxAttempts = 20,
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await verifyPackages(version, get);
      return;
    } catch (error) {
      const status = error.status;
      const retryable =
        error instanceof TypeError ||
        status === 404 ||
        status === 429 ||
        status >= 500;
      if (!retryable || attempt === maxAttempts) throw error;
      console.warn(
        `npm package verification attempt ${attempt}/${maxAttempts}: ${error.message}; retrying in 15 seconds`,
      );
      await sleep(15_000);
    }
  }
}

export async function main() {
  const manifest = JSON.parse(
    await readFile('.release-please-manifest.json', 'utf8'),
  );
  const version = (
    process.env.CLI_VERSION || manifest['apps/moltnet-cli']
  ).replace(/^cli-v/, '');
  const source = await readFile(pinFile, 'utf8');
  // An open automation PR may already carry a newer pin than main. Keep its
  // version when an older release job is retried out of order.
  let existingSource;
  try {
    existingSource = execFileSync(
      'git',
      ['show', `refs/remotes/origin/automation/gondolin-cli-pin:${pinFile}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    // No prior automation branch.
  }
  if (
    existingSource &&
    advancePin(existingSource, version) === existingSource
  ) {
    return;
  }
  const updated = advancePin(source, version);
  if (updated === source) return;
  await waitForPackages(version);
  await writeFile(pinFile, updated);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
