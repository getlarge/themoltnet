/**
 * Generic JSON CID — CIDv1 for arbitrary JSON-serialisable values.
 *
 * Uses the dag-json codec and sha2-256, producing a base32lower CIDv1.
 * Suitable for content-addressing task inputs, schema objects, and other
 * JSON payloads that don't need diary-entry canonical normalisation.
 */

import { CID } from 'multiformats/cid';
import * as json from 'multiformats/codecs/json';
import { sha256 } from 'multiformats/hashes/sha2';

export async function computeJsonCid(value: unknown): Promise<string> {
  const bytes = json.encode(value);
  const hash = await sha256.digest(bytes);
  return CID.create(1, json.code, hash).toString();
}
