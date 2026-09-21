// Assemble only a complete release from metadata produced by verified platform jobs.
import { writeFileSync } from 'node:fs';
import process from 'node:process';

import {
  DESKTOP_PLATFORMS,
  desktopAssetName,
  loadReleaseMetadata,
} from './release-contract.mjs';

const [directory, output, version, repository = 'getlarge/themoltnet'] =
  process.argv.slice(2);
if (
  !directory ||
  !output ||
  !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? '')
) {
  throw new Error(
    'Usage: manifest.mjs <metadata-directory> <output> <version> [repository]',
  );
}
const platforms = {};
const metadata = loadReleaseMetadata(directory, version);
for (const { target, suffix } of Object.values(DESKTOP_PLATFORMS).flatMap(
  ({ updaterTargets }) => updaterTargets,
)) {
  const name = desktopAssetName(version, suffix);
  const asset = metadata.find((candidate) => candidate.name === name);
  if (!asset || asset.size <= 0 || !/^[a-f0-9]{64}$/.test(asset.sha256 ?? ''))
    throw new Error(`Missing verified metadata: ${name}`);
  if (!asset.signature) throw new Error(`Missing signature: ${name}`);
  platforms[target] = {
    signature: asset.signature,
    url: `https://github.com/${repository}/releases/download/agent-desktop-v${version}/${name}`,
  };
}
writeFileSync(
  output,
  `${JSON.stringify(
    {
      version,
      notes: 'Signed MoltNet Agent desktop update',
      pub_date: new Date().toISOString(),
      platforms,
    },
    null,
    2,
  )}\n`,
);
