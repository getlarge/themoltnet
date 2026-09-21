// Compare every materialized release asset with GitHub's server-computed digest.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const [metadataDirectory, publishedPath, version] = process.argv.slice(2);
if (!metadataDirectory || !publishedPath || !version) {
  throw new Error(
    'Usage: verify-published-assets.mjs <metadata-directory> <release-json> <version>',
  );
}

const expected = readdirSync(metadataDirectory)
  .filter(
    (name) => name.startsWith('release-metadata-') && name.endsWith('.json'),
  )
  .flatMap((name) => {
    const metadata = JSON.parse(
      readFileSync(join(metadataDirectory, name), 'utf8'),
    );
    if (metadata.version !== version) {
      throw new Error(`Metadata version mismatch: ${name}`);
    }
    return metadata.assets ?? [];
  });
const names = new Set();
for (const asset of expected) {
  if (names.has(asset.name))
    throw new Error(`Duplicate metadata: ${asset.name}`);
  names.add(asset.name);
}

const publishedValue = JSON.parse(readFileSync(publishedPath, 'utf8'));
const published = Array.isArray(publishedValue)
  ? publishedValue
  : publishedValue.assets;
if (!Array.isArray(published)) throw new Error('Release JSON has no assets');

for (const asset of expected) {
  const remote = published.find((candidate) => candidate.name === asset.name);
  if (!remote) throw new Error(`Published asset is missing: ${asset.name}`);
  if (remote.size !== asset.size) {
    throw new Error(`Published asset size changed: ${asset.name}`);
  }
  if (remote.digest !== `sha256:${asset.sha256}`) {
    throw new Error(`Published asset digest changed: ${asset.name}`);
  }
}
