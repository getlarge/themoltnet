// The complete file set a desktop release publishes. It is derived from the
// packaged files themselves, so no intermediate metadata can drift from them.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const DESKTOP_PLATFORMS = Object.freeze({
  'mac-os': Object.freeze({
    artifacts: Object.freeze([
      Object.freeze({ suffix: 'aarch64.app.tar.gz', updater: true }),
      Object.freeze({ suffix: 'aarch64.app.zip', updater: false }),
      Object.freeze({ suffix: 'aarch64.dmg', updater: false }),
    ]),
    updaterTargets: Object.freeze([
      Object.freeze({ target: 'darwin-aarch64', suffix: 'aarch64.app.tar.gz' }),
    ]),
  }),
  linux: Object.freeze({
    artifacts: Object.freeze([
      Object.freeze({ suffix: 'amd64.deb', updater: true }),
      Object.freeze({ suffix: 'amd64.AppImage', updater: true }),
    ]),
    updaterTargets: Object.freeze([
      Object.freeze({ target: 'linux-x86_64-deb', suffix: 'amd64.deb' }),
      Object.freeze({
        target: 'linux-x86_64-appimage',
        suffix: 'amd64.AppImage',
      }),
    ]),
  }),
});

export const MANIFEST_NAME = 'latest.json';

export function assertVersion(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? '')) {
    throw new Error(`Desktop version is not canonical: ${version ?? 'none'}`);
  }
}

export const desktopAssetName = (version, suffix) =>
  `MoltNet-Agent_${version}_${suffix}`;

export function expectedAssetNames(version) {
  return Object.values(DESKTOP_PLATFORMS).flatMap(({ artifacts }) =>
    artifacts.flatMap(({ suffix, updater }) => {
      const name = desktopAssetName(version, suffix);
      return updater ? [name, `${name}.sig`] : [name];
    }),
  );
}

/**
 * Describe every release file in `directory`, refusing a missing, empty, or
 * unexpected file. `latest.json` is required when `withManifest` is set.
 */
export function describeAssets(
  directory,
  version,
  { withManifest = false } = {},
) {
  assertVersion(version);
  const expected = expectedAssetNames(version);
  if (withManifest) expected.push(MANIFEST_NAME);
  const actual = readdirSync(directory);
  const missing = expected.filter((name) => !actual.includes(name));
  const extra = actual.filter((name) => !expected.includes(name));
  if (missing.length || extra.length) {
    throw new Error(
      `Desktop release files differ: missing ${missing.join(', ') || 'none'}; extra ${extra.join(', ') || 'none'}`,
    );
  }
  return expected.map((name) => {
    const bytes = readFileSync(join(directory, name));
    if (bytes.length === 0) {
      throw new Error(`Desktop release file is empty: ${name}`);
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    return { name, size: bytes.length, sha256 };
  });
}

/** Build the Tauri updater manifest from the signed files in `directory`. */
export function buildManifest(directory, version, repository, pubDate) {
  describeAssets(directory, version);
  const platforms = {};
  for (const { target, suffix } of Object.values(DESKTOP_PLATFORMS).flatMap(
    ({ updaterTargets }) => updaterTargets,
  )) {
    const name = desktopAssetName(version, suffix);
    const signature = readFileSync(join(directory, `${name}.sig`), 'utf8');
    if (!signature.trim())
      throw new Error(`Missing updater signature: ${name}`);
    platforms[target] = {
      signature: signature.trim(),
      url: `https://github.com/${repository}/releases/download/agent-desktop-v${version}/${name}`,
    };
  }
  return {
    version,
    notes: 'Signed MoltNet Agent desktop update',
    pub_date: pubDate,
    platforms,
  };
}

export class AssetsNotReadyError extends Error {}

/**
 * Compare local files with a release's asset list, as returned by
 * `GET /releases/{id}/assets`. GitHub computes digests asynchronously, so an
 * asset it has not processed yet raises AssetsNotReadyError. Any other
 * difference is a hard failure.
 */
export function verifyPublishedAssets(local, published) {
  const names = published.map(({ name }) => name);
  if (new Set(names).size !== names.length) {
    throw new Error('Published release contains duplicate asset names');
  }
  const expected = local.map(({ name }) => name);
  const missing = expected.filter((name) => !names.includes(name));
  const extra = names.filter((name) => !expected.includes(name));
  if (missing.length || extra.length) {
    throw new Error(
      `Published asset set differs: missing ${missing.join(', ') || 'none'}; extra ${extra.join(', ') || 'none'}`,
    );
  }
  for (const asset of local) {
    const remote = published.find(({ name }) => name === asset.name);
    if (remote.size !== asset.size) {
      throw new Error(
        `Published asset size differs: ${asset.name}; expected ${asset.size}, found ${remote.size ?? 'none'}`,
      );
    }
    if (remote.state !== 'uploaded' || !remote.digest) {
      throw new AssetsNotReadyError(
        `Published asset is still processing: ${asset.name} (state ${remote.state ?? 'none'})`,
      );
    }
    if (remote.digest !== `sha256:${asset.sha256}`) {
      throw new Error(
        `Published asset digest differs: ${asset.name}; expected sha256:${asset.sha256}, found ${remote.digest}`,
      );
    }
  }
}
