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
      throw new Error(
        `@themoltnet/${name}@${version} unavailable (${response.status})`,
      );
    }
    const metadata = await response.json();
    if (metadata.version !== version) {
      throw new Error(`@themoltnet/${name} resolved ${metadata.version}`);
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
  await verifyPackages(version);
  await writeFile(pinFile, updated);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
