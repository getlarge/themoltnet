import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { create as createDigest } from 'multiformats/hashes/digest';
import { sha256 } from 'multiformats/hashes/sha2';

const SHA2_256_CODE = 0x12;

/**
 * Compute a CIDv1 for immutable raw bytes.
 *
 * Use this for object-store artifacts where the CID names the exact payload
 * bytes. JSON task outputs should continue to use computeJsonCid().
 */
export async function computeBytesCid(bytes: Uint8Array): Promise<string> {
  const hash = await sha256.digest(bytes);
  return CID.createV1(raw.code, hash).toString();
}

/**
 * Build the same raw-bytes CID from an already computed sha2-256 digest.
 * Streaming upload paths use this after hashing the payload while staging it.
 */
export function computeBytesCidFromSha256(sha256Bytes: Uint8Array): string {
  if (sha256Bytes.byteLength !== 32) {
    throw new Error('sha2-256 digest must be 32 bytes');
  }
  return CID.createV1(
    raw.code,
    createDigest(SHA2_256_CODE, sha256Bytes),
  ).toString();
}

/**
 * Recover the hex sha2-256 digest embedded in a raw-bytes CID.
 *
 * Inverse of computeBytesCidFromSha256(): the multihash of a CIDv1 raw
 * CID *is* the payload digest, so no bytes are needed to derive it. Used
 * when binding staged input artifacts to a task from just their CID.
 */
export function decodeBytesCidToSha256(cid: string): string {
  const parsed = CID.parse(cid);
  if (
    parsed.code !== raw.code ||
    parsed.multihash.code !== SHA2_256_CODE ||
    parsed.multihash.digest.byteLength !== 32
  ) {
    throw new Error('CID is not a raw-bytes sha2-256 CIDv1');
  }
  return Buffer.from(parsed.multihash.digest).toString('hex');
}
