// Carry verified updater signatures to finalization without re-downloading packages.
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import process from 'node:process';

import { desktopAssetName, platformContract } from './release-contract.mjs';

const [directory, version, platform, output] = process.argv.slice(2);
if (!directory || !version || !platform || !output)
  throw new Error(
    'Usage: release-metadata.mjs <assets> <version> <mac-os|linux> <output>',
  );

const { artifacts } = platformContract(platform);

const assetMetadata = (path, extra = {}) => {
  const bytes = readFileSync(path);
  return {
    name: basename(path),
    size: statSync(path).size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    ...extra,
  };
};
const assets = artifacts.flatMap(({ suffix, updater }) => {
  const name = desktopAssetName(version, suffix);
  const path = join(directory, name);
  if (!updater) return [assetMetadata(path)];
  const signaturePath = `${path}.sig`;
  const signature = readFileSync(signaturePath, 'utf8').trim();
  if (!signature) throw new Error(`Missing signature: ${name}`);
  return [assetMetadata(path, { signature }), assetMetadata(signaturePath)];
});
writeFileSync(
  output,
  `${JSON.stringify({ version, platform, assets }, null, 2)}\n`,
);
