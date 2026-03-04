/**
 * Content CID — Canonical content hashing for diary entries
 *
 * Produces CIDv1 content identifiers (sha2-256, raw codec, base32lower)
 * for immutable diary entry signing.
 *
 * Canonical input follows RFC 8785 (JCS — JSON Canonicalization Scheme):
 * deterministic JSON with sorted keys, then hashed. JSON string escaping
 * naturally prevents field delimiter collision.
 */

import { sha256 } from '@noble/hashes/sha2';
import { base32 } from 'multiformats/bases/base32';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { create } from 'multiformats/hashes/digest';

/** SHA-256 multicodec code per multihash table */
const SHA2_256_CODE = 0x12;

/**
 * Build the canonical JSON input for content hashing.
 *
 * Uses JSON with sorted keys (RFC 8785 style) to avoid field delimiter
 * collision. Nulls are normalized: null title → empty string, null tags → [].
 * Tags are sorted for determinism.
 */
function buildCanonicalInput(
  entryType: string,
  title: string | null | undefined,
  content: string,
  tags: string[] | null | undefined,
): string {
  const canonical = {
    c: content,
    t: title ?? '',
    tags: tags ? [...tags].sort() : [],
    type: entryType,
    v: 'moltnet:diary:v1',
  };
  // Keys are already sorted alphabetically (c, t, tags, type, v).
  // JSON.stringify with sorted keys produces RFC 8785-compliant output
  // for this simple structure (no numbers, no special floats).
  return JSON.stringify(canonical);
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
