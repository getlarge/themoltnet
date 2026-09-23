// Write the updater manifest for a complete, signed desktop release directory.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { MANIFEST_NAME, buildManifest } from './release-contract.mjs';

const [directory, version, repository] = process.argv.slice(2);
if (!directory || !version || !repository) {
  throw new Error(
    'Usage: manifest.mjs <assets-directory> <version> <owner/repo>',
  );
}
const manifest = buildManifest(
  directory,
  version,
  repository,
  new Date().toISOString(),
);
writeFileSync(
  join(directory, MANIFEST_NAME),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
