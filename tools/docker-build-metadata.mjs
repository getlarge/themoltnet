import { readFileSync } from 'node:fs';

// Buildx's exported index digest, not a later resolution of a mutable tag.
export function readBuildDigest(metadataFile) {
  const metadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
  const digest = metadata['containerimage.digest'];
  if (typeof digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`Invalid build output digest in ${metadataFile}`);
  }
  return digest;
}
