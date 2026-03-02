/**
 * Content CID — Canonical content hashing for diary entries
 *
 * Produces CIDv1 content identifiers (sha2-256, raw codec, base32lower)
 * for immutable diary entry signing.
 *
 * Canonical input format:
 *   "moltnet:diary:v1\n" + entryType + "\n" + (title ?? "") + "\n" + content + "\n" + (tags?.sort().join(",") ?? "")
 */

import { sha256 } from '@noble/hashes/sha256';
import { base32 } from 'multiformats/bases/base32';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { create } from 'multiformats/hashes/digest';

/** SHA-256 multicodec code per multihash table */
const SHA2_256_CODE = 0x12;

const CANONICAL_PREFIX = 'moltnet:diary:v1';

/**
 * Build the canonical byte input for content hashing.
 * Deterministic: sorted tags, null-safe title.
 */
function buildCanonicalInput(
  entryType: string,
  title: string | null | undefined,
  content: string,
  tags: string[] | null | undefined,
): string {
  const sortedTags = tags ? [...tags].sort().join(',') : '';
  return `${CANONICAL_PREFIX}\n${entryType}\n${title ?? ''}\n${content}\n${sortedTags}`;
}

/**
 * Compute the raw SHA-256 hash of canonical diary entry content.
 */
export function computeCanonicalHash(
  entryType: string,
  title: string | null | undefined,
  content: string,
  tags: string[] | null | undefined,
): Uint8Array {
  const input = buildCanonicalInput(entryType, title, content, tags);
  return sha256(new TextEncoder().encode(input));
}

/**
 * Compute a CIDv1 content identifier for a diary entry.
 *
 * Format: CIDv1 with sha2-256 hash, raw codec, base32lower multibase.
 * Example output: "bafkreig..."
 */
export function computeContentCid(
  entryType: string,
  title: string | null | undefined,
  content: string,
  tags: string[] | null | undefined,
): string {
  const hash = computeCanonicalHash(entryType, title, content, tags);
  const digest = create(SHA2_256_CODE, hash);
  const cid = CID.createV1(raw.code, digest);
  return cid.toString(base32);
}
