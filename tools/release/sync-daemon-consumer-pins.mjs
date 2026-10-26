import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { compareVersions } from './sync-cli-consumer-pins.mjs';

export const pinFiles = ['.github/workflows/adaptive-review-reusable.yml'];
const TAG_PREFIX = 'agent-daemon-v';
// The agent-daemon action installs this signed bundle on ubuntu runners.
const requiredAssets = [
  'moltnet-agent-linux-x64.tar.gz',
  'moltnet-agent-linux-x64.tar.gz.sha256',
  'moltnet-agent-linux-x64.tar.gz.sha256.sig',
];

export function advancePin(source, version) {
  const pattern =
    /(\n {6}daemon-version:\n(?: {8}.*\n)*? {8}default: )'([^']+)'/g;
  if (!pattern.test(source)) throw new Error('daemon pin not found');
  return source.replace(pattern, (match, prefix, current) =>
    compareVersions(version, current) > 0 ? `${prefix}'${version}'` : match,
  );
}

/** The newest published daemon release whose runner bundle is complete. */
export function latestRelease(releases) {
  let latest;
  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    if (!release.tag_name?.startsWith(TAG_PREFIX)) continue;
    const version = release.tag_name.slice(TAG_PREFIX.length);
    if (!/^\d+\.\d+\.\d+$/.test(version)) continue;
    if (latest && compareVersions(version, latest.version) <= 0) continue;
    latest = { version, assets: new Set(release.assets.map((a) => a.name)) };
  }
  if (!latest) throw new Error('No published agent-daemon release found');
  const missing = requiredAssets.filter((name) => !latest.assets.has(name));
  if (missing.length) {
    process.stderr.write(
      `agent-daemon ${latest.version} is missing ${missing.join(', ')}; retaining current pin\n`,
    );
    return undefined;
  }
  return latest.version;
}

export async function fetchReleases(
  get = globalThis.fetch,
  token = process.env.GH_TOKEN,
) {
  const response = await get(
    'https://api.github.com/repos/getlarge/themoltnet/releases?per_page=100',
    {
      headers: {
        accept: 'application/vnd.github+json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    },
  );
  if (!response.ok)
    throw new Error(`Cannot list GitHub releases (${response.status})`);
  return response.json();
}

export async function main({ root = '.', get = globalThis.fetch } = {}) {
  const version = latestRelease(await fetchReleases(get));
  if (!version) return;
  for (const file of pinFiles.map((path) => join(root, path))) {
    const source = await readFile(file, 'utf8');
    const updated = advancePin(source, version);
    if (updated !== source) await writeFile(file, updated);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
