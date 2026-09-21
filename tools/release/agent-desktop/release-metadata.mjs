// Carry verified updater signatures to finalization without re-downloading packages.
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import process from 'node:process';

const [directory, version, platform, output] = process.argv.slice(2);
if (!directory || !version || !platform || !output)
  throw new Error(
    'Usage: release-metadata.mjs <assets> <version> <mac-os|linux> <output>',
  );

const suffixes =
  platform === 'mac-os'
    ? ['aarch64.app.tar.gz']
    : platform === 'linux'
      ? ['amd64.deb', 'amd64.AppImage']
      : null;
if (!suffixes) throw new Error(`Unknown desktop platform: ${platform}`);

const assets = suffixes.map((suffix) => {
  const name = `MoltNet-Agent_${version}_${suffix}`;
  const path = join(directory, name);
  const bytes = readFileSync(path);
  const signature = readFileSync(`${path}.sig`, 'utf8').trim();
  if (!signature) throw new Error(`Missing signature: ${name}`);
  return {
    name: basename(path),
    size: statSync(path).size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    signature,
  };
});
writeFileSync(
  output,
  `${JSON.stringify({ version, platform, assets }, null, 2)}\n`,
);
