import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
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
  const response = await get(
    'https://registry.npmjs.org/@themoltnet%2fcli/latest',
  );
  if (!response.ok)
    throw new Error(`Cannot resolve published CLI (${response.status})`);
  const { version } = await response.json();
  const updated = advancePin(source, version);
  if (updated === source) return source;
  try {
    await verifyPackages(version, get);
  } catch (error) {
    if (error.status !== 404) throw error;
    process.stderr.write(
      `CLI ${version} is not available on both Linux platforms; retaining current pin\n`,
    );
    return source;
  }
  return updated;
}

export async function main() {
  const source = await readFile(pinFile, 'utf8');
  const updated = process.env.CLI_VERSION
    ? advancePin(source, process.env.CLI_VERSION.replace(/^cli-v/, ''))
    : await publishedPin(source);
  if (updated === source) return;
  if (process.env.CLI_VERSION)
    await waitForPackages(process.env.CLI_VERSION.replace(/^cli-v/, ''));
  await writeFile(pinFile, updated);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
