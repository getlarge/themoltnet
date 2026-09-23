// Compare the local release directory with GitHub's server-computed digests.
// Exits 75 (EX_TEMPFAIL) while GitHub is still processing an upload, so the
// caller can wait for that one documented asynchronous step and nothing else.
import { readFileSync } from 'node:fs';
import process from 'node:process';

import {
  AssetsNotReadyError,
  describeAssets,
  verifyPublishedAssets,
} from './release-contract.mjs';

const [directory, version, publishedPath] = process.argv.slice(2);
if (!directory || !version || !publishedPath) {
  throw new Error(
    'Usage: verify-published-assets.mjs <assets-directory> <version> <release-assets.json>',
  );
}
const local = describeAssets(directory, version, { withManifest: true });
const published = JSON.parse(readFileSync(publishedPath, 'utf8'));
try {
  verifyPublishedAssets(local, published);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(error instanceof AssetsNotReadyError ? 75 : 1);
}
