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
    /(\n {6}daemon-version:\r?\n(?: {8}.*\r?\n)*? {8}default: )'([^']+)'/g;
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

const apiRoot = 'https://api.github.com/repos/getlarge/themoltnet';
const actionRoot = 'packages/agent-daemon-action';
const daemonPattern =
  /(\n {6}daemon-version:\r?\n(?: {8}.*\r?\n)*? {8}default: )'([^']+)'/g;
const actionPattern =
  /uses: getlarge\/themoltnet\/packages\/agent-daemon-action@([a-f0-9]{40}) # v(\d+\.\d+\.\d+)(?=\r?$)/gm;

/** Update the daemon and the action version recorded in its release together. */
export async function main({
  root = '.',
  get = globalThis.fetch,
  token = process.env.GH_TOKEN,
} = {}) {
  // Parse every consumer before making requests or writing any file.
  const consumers = await Promise.all(
    pinFiles.map(async (file) => {
      const source = await readFile(join(root, file), 'utf8');
      const daemons = [...source.matchAll(daemonPattern)];
      const actions = [...source.matchAll(actionPattern)];
      if (daemons.length !== 1 || actions.length !== 2) {
        throw new Error(
          `Expected one daemon default and two versioned action SHA pins in ${file}`,
        );
      }
      return { file, source, daemon: daemons[0][2], actions };
    }),
  );
  const version = latestRelease(await fetchReleases(get, token));
  if (!version) return;

  async function api(path) {
    const response = await get(`${apiRoot}/${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok)
      throw new Error(`Cannot read ${path} (${response.status})`);
    return response.json();
  }
  async function versionAt(ref) {
    const file = await api(`contents/${actionRoot}/package.json?ref=${ref}`);
    const metadata = JSON.parse(Buffer.from(file.content, 'base64').toString());
    if (metadata.name !== '@themoltnet/agent-daemon-action') {
      throw new Error(`Unexpected daemon action package at ${ref}`);
    }
    compareVersions(metadata.version, '0.0.0');
    return metadata.version;
  }

  // A source release tag has no dist/. Resolve the built major tag, then
  // require the exact action version from the daemon's source release.
  const actionVersion = await versionAt(`${TAG_PREFIX}${version}`);
  const majorTag = `v${actionVersion.split('.')[0]}`;
  const ref = await api(`git/ref/tags/${majorTag}`);
  const sha = ref.object?.sha;
  if (ref.object?.type !== 'commit' || !/^[a-f0-9]{40}$/.test(sha ?? '')) {
    throw new Error(`${majorTag} must point directly to a bundle commit`);
  }
  if ((await versionAt(sha)) !== actionVersion) {
    throw new Error(
      `Daemon ${version} requires action ${actionVersion}; ${majorTag} has a different version`,
    );
  }
  const tag = `agent-daemon-action-v${actionVersion}`;
  const release = await api(`releases/tags/${tag}`);
  if (release.draft || release.prerelease || release.tag_name !== tag) {
    throw new Error(`${tag} is not a published stable release`);
  }
  const tree = await api(`git/trees/${sha}?recursive=1`);
  if (
    tree.truncated ||
    ['action.yml', 'dist/main.js'].some(
      (file) =>
        !tree.tree?.some(
          (entry) =>
            entry.path === `${actionRoot}/${file}` &&
            entry.type === 'blob' &&
            entry.size > 0,
        ),
    )
  ) {
    throw new Error(`${sha} is missing required daemon action release files`);
  }
  for (const consumer of consumers) {
    if (compareVersions(version, consumer.daemon) < 0) {
      throw new Error(`Refusing to downgrade daemon to ${version}`);
    }
    for (const [, currentSha, commentVersion] of consumer.actions) {
      const currentVersion =
        currentSha === sha ? actionVersion : await versionAt(currentSha);
      if (currentVersion !== commentVersion) {
        throw new Error(`Action version comment disagrees with ${currentSha}`);
      }
      if (compareVersions(actionVersion, currentVersion) < 0) {
        throw new Error(
          `Refusing to downgrade daemon action to ${actionVersion}`,
        );
      }
    }
  }
  // All remote and local checks passed; neither pin can advance on its own.
  for (const { file, source } of consumers) {
    const updated = advancePin(source, version).replace(
      actionPattern,
      `uses: getlarge/themoltnet/${actionRoot}@${sha} # v${actionVersion}`,
    );
    if (updated !== source) await writeFile(join(root, file), updated);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
