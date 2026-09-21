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

export const desktopAssetName = (version, suffix) =>
  `MoltNet-Agent_${version}_${suffix}`;

export const metadataFileName = (platform) =>
  `release-metadata-${platform}.json`;

export function platformContract(platform) {
  const contract = DESKTOP_PLATFORMS[platform];
  if (!contract) throw new Error(`Unknown desktop platform: ${platform}`);
  return contract;
}

export function expectedPlatformAssetNames(platform, version) {
  return platformContract(platform).artifacts.flatMap(({ suffix, updater }) => {
    const name = desktopAssetName(version, suffix);
    return updater ? [name, `${name}.sig`] : [name];
  });
}

export function loadReleaseMetadata(directory, version) {
  const expectedFiles = Object.keys(DESKTOP_PLATFORMS).map(metadataFileName);
  const actualFiles = readdirSync(directory)
    .filter(
      (name) => name.startsWith('release-metadata-') && name.endsWith('.json'),
    )
    .sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles.sort())) {
    throw new Error(
      `Release metadata files differ: expected ${expectedFiles.join(', ')}, found ${actualFiles.join(', ') || 'none'}`,
    );
  }

  return Object.keys(DESKTOP_PLATFORMS).flatMap((platform) => {
    const name = metadataFileName(platform);
    const metadata = JSON.parse(readFileSync(join(directory, name), 'utf8'));
    if (metadata.version !== version) {
      throw new Error(
        `Metadata version mismatch in ${name}: expected ${version}, found ${metadata.version ?? 'none'}`,
      );
    }
    if (metadata.platform !== platform) {
      throw new Error(
        `Metadata platform mismatch in ${name}: expected ${platform}, found ${metadata.platform ?? 'none'}`,
      );
    }
    const expectedNames = expectedPlatformAssetNames(platform, version).sort();
    const assets = Array.isArray(metadata.assets) ? metadata.assets : [];
    const actualNames = assets.map(({ name: assetName }) => assetName).sort();
    if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
      throw new Error(
        `Metadata assets differ in ${name}: expected ${expectedNames.join(', ')}, found ${actualNames.join(', ') || 'none'}`,
      );
    }
    return assets;
  });
}
