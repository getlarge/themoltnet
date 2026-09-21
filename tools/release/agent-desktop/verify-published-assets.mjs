// Compare the complete release asset set with GitHub's server-computed digests.
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import process from 'node:process';

import { loadReleaseMetadata } from './release-contract.mjs';

const [metadataDirectory, publishedPath, version, manifestPath, manifestMode] =
  process.argv.slice(2);
if (!metadataDirectory || !publishedPath || !version) {
  throw new Error(
    'Usage: verify-published-assets.mjs <metadata-directory> <release-json> <version> [manifest-path] [optional|required]',
  );
}
if (manifestPath && !['optional', 'required'].includes(manifestMode)) {
  throw new Error('Manifest mode must be optional or required');
}

const expected = loadReleaseMetadata(metadataDirectory, version);
if (manifestPath) {
  const bytes = readFileSync(manifestPath);
  expected.push({
    name: basename(manifestPath),
    size: statSync(manifestPath).size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    optional: manifestMode === 'optional',
  });
}
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

const publishedNames = published.map(({ name }) => name).sort();
if (new Set(publishedNames).size !== publishedNames.length) {
  throw new Error('Published release contains duplicate asset names');
}
const requiredNames = expected
  .filter(({ optional }) => !optional)
  .map(({ name }) => name)
  .sort();
const allowedNames = new Set(expected.map(({ name }) => name));
const missing = requiredNames.filter((name) => !publishedNames.includes(name));
const extra = publishedNames.filter((name) => !allowedNames.has(name));
if (missing.length || extra.length) {
  throw new Error(
    `Published asset set differs: missing ${missing.join(', ') || 'none'}; extra ${extra.join(', ') || 'none'}`,
  );
}

for (const asset of expected) {
  const remote = published.find((candidate) => candidate.name === asset.name);
  if (!remote && asset.optional) continue;
  if (!remote) throw new Error(`Published asset is missing: ${asset.name}`);
  if (remote.state !== 'uploaded') {
    throw new Error(
      `Published asset is not ready: ${asset.name}; expected state uploaded, found ${remote.state ?? 'none'}. Rerun finalization after GitHub finishes processing it.`,
    );
  }
  if (remote.size !== asset.size) {
    throw new Error(
      `Published asset size changed: ${asset.name}; expected ${asset.size}, found ${remote.size ?? 'none'}`,
    );
  }
  const expectedDigest = `sha256:${asset.sha256}`;
  if (!remote.digest) {
    throw new Error(
      `Published asset digest is not ready: ${asset.name}; expected ${expectedDigest}, found none. Rerunning finalization is safe.`,
    );
  }
  if (remote.digest !== expectedDigest) {
    throw new Error(
      `Published asset digest changed: ${asset.name}; expected ${expectedDigest}, found ${remote.digest}`,
    );
  }
}
