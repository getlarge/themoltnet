// Assemble only a complete release from metadata produced by verified platform jobs.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

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
const metadata = readdirSync(directory)
  .filter(
    (name) => name.startsWith('release-metadata-') && name.endsWith('.json'),
  )
  .flatMap((name) => {
    const value = JSON.parse(readFileSync(join(directory, name), 'utf8'));
    if (value.version !== version)
      throw new Error(`Metadata version mismatch: ${name}`);
    return value.assets ?? [];
  });
for (const [target, suffix] of [
  ['darwin-aarch64', 'aarch64.app.tar.gz'],
  ['linux-x86_64-deb', 'amd64.deb'],
  ['linux-x86_64-appimage', 'amd64.AppImage'],
]) {
  const name = `MoltNet-Agent_${version}_${suffix}`;
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
