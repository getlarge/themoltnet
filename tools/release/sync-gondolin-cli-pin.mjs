import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export const pinFiles = [
  'libs/sandbox-gondolin/src/snapshot.ts',
  '.github/workflows/issue-triage.yml',
  '.github/workflows/legreffier-security-review.yml',
  '.github/workflows/multi-lens-review.yml',
];
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
  const pattern =
    /(const MOLTNET_CLI_VERSION = |MOLTNET_CLI_VERSION: )'([^']+)'/g;
  if (!pattern.test(source)) throw new Error('CLI pin not found');
  return source.replace(pattern, (match, prefix, current) =>
    compareVersions(version, current) > 0 ? `${prefix}'${version}'` : match,
  );
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
  sleep = delay,
  // npm scans publishes before exposing them; this can take over 15 minutes.
  maxAttempts = 100,
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
      process.stderr.write(
        `npm package verification attempt ${attempt}/${maxAttempts}: ${error.message}; retrying in 15 seconds\n`,
      );
      await sleep(15_000);
    }
  }
}

// The release PR's CLI version may not be published yet. Resolve npm's
// stable dist-tag instead, and only advance after both Linux packages exist.
export async function publishedPin(source, get = globalThis.fetch) {
  return (await publishedPins([source], get))[0];
}

export async function publishedPins(sources, get = globalThis.fetch) {
  const response = await get(
    'https://registry.npmjs.org/@themoltnet%2fcli/latest',
  );
  if (!response.ok)
    throw new Error(`Cannot resolve published CLI (${response.status})`);
  const { version } = await response.json();
  const updated = sources.map((source) => advancePin(source, version));
  if (updated.every((source, index) => source === sources[index]))
    return sources;
  try {
    await verifyPackages(version, get);
  } catch (error) {
    if (error.status !== 404) throw error;
    process.stderr.write(
      `CLI ${version} is not available on both Linux platforms; retaining current pin\n`,
    );
    return sources;
  }
  return updated;
}

export async function main({
  root = '.',
  get = globalThis.fetch,
  version = process.env.CLI_VERSION?.replace(/^cli-v/, ''),
} = {}) {
  const paths = pinFiles.map((file) => join(root, file));
  const sources = await Promise.all(
    paths.map((file) => readFile(file, 'utf8')),
  );
  const updated = version
    ? sources.map((source) => advancePin(source, version))
    : await publishedPins(sources, get);
  if (updated.every((source, index) => source === sources[index])) return;
  if (version) await waitForPackages(version, get);
  for (const [index, file] of paths.entries()) {
    if (updated[index] !== sources[index])
      await writeFile(file, updated[index]);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
